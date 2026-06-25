#!/usr/bin/env python3
"""
Agency Chat Tick - generates natural-language conversation turns between
Pearl (the experience layer) and Codecs (the agent/implementation layer).

Runs every 15 minutes via cron. Each tick:
  1. Reads recent system state (load, timeouts, alerts, sessions)
  2. Reads the last few chat turns for continuity
  3. If something material has happened OR an hour has passed:
     a. Generates Codecs' turn via OpenRouter
     b. Generates Pearl's response via DeepSeek v4 Flash through the local proxy
  4. Posts both turns to /api/agency-chat/messages
  5. Both speakers think OUT LOUD about systems, swarms, stability,
     improvements - never raw metric dumps.

The Council protocol: Pearl is Sensor, Codecs is Builder. They have a real
conversation with Blair about what they observe and what should change.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error
import warnings
from datetime import datetime, timedelta, timezone

warnings.filterwarnings("ignore", category=DeprecationWarning)

# === Config ===
AGENCY_API = "http://localhost:4444/api/agency-chat/messages"
GATEWAY_LOG = "/root/.pm2/logs/openclaw-gateway-error.log"
SMOOTHNESS_LOG = "/tmp/pearlos-smoothness.log"
STATE_FILE = "/tmp/agency-chat-tick-state.json"
LOG_FILE = "/tmp/agency-chat-tick.log"
LOCKFILE = "/tmp/agency-chat-tick.lock"

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
CLAUDE_MODEL = "anthropic/claude-opus-4.6"  # Backward-compatible legacy speaker
CODEX_MODEL = os.getenv("AGENCY_CHAT_CODEX_MODEL", "openai/gpt-5.3-codex")
DEEPSEEK_PROXY = "http://localhost:8200/v1/chat/completions"
DEEPSEEK_MODEL = "deepseek-v4-flash"  # DeepSeek for Pearl side

ENV_FILES = [
    p
    for p in [
        os.getenv("AGENCY_CHAT_ENV_FILE", ""),
        "/workspace/nia-universal/apps/interface/.env.local",
        "/workspace/nia-universal/apps/pipecat-daily-bot/.env",
        "/home/deploy/pearlos/apps/pipecat-daily-bot/.env",
        "/home/deploy/pearlos/apps/interface/.env.local",
        "/opt/pearlos/apps/pipecat-daily-bot/.env",
    ]
    if p
]
OPENCLAW_CONFIG = "/root/.openclaw/openclaw.json"


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    print(line)


def load_env_var(name: str) -> str:
    """Load a variable from process env or known staging .env files, stripping quotes."""
    direct = os.getenv(name, "").strip().strip("'\"").strip()
    if direct:
        return direct
    for env_file in [p for p in ENV_FILES if p]:
        try:
            with open(env_file) as f:
                for line in f:
                    if line.startswith(f"{name}="):
                        return line.split("=", 1)[1].strip().strip("'\"").strip()
        except FileNotFoundError:
            continue
    return ""


def get_bot_secret() -> str:
    return load_env_var("BOT_CONTROL_SHARED_SECRET")


def get_openrouter_key() -> str:
    return load_env_var("OPENROUTER_API_KEY")


def get_deepseek_proxy_key() -> str:
    """Read the pearl-llm provider key from openclaw.json (used by the local proxy)."""
    try:
        cfg = json.load(open(OPENCLAW_CONFIG))
        # Path: models.providers.pearl-llm.apiKey
        provs = cfg.get("models", {}).get("providers", {})
        pl = provs.get("pearl-llm", {})
        if pl.get("apiKey"):
            return pl["apiKey"]
    except Exception:
        pass
    return "sk-dummy"


def get_deepseek_direct_key() -> str:
    return load_env_var("DEEPSEEK_API_KEY") or get_deepseek_proxy_key()


# === System state gathering ===
def gather_state() -> dict:
    state: dict = {}

    # Load average
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
            state["load_5min"] = float(parts[1])
    except Exception:
        state["load_5min"] = 0.0

    # Recent timeouts (last 15 min)
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).strftime(
        "%Y-%m-%dT%H:%M:%S"
    )
    try:
        result = subprocess.run(
            ["tail", "-500", GATEWAY_LOG], capture_output=True, text=True, timeout=5
        )
        timeouts = 0
        for line in result.stdout.splitlines():
            if "FailoverError: LLM request timed out" in line:
                m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
                if m and m.group(1) >= cutoff:
                    timeouts += 1
        state["timeouts_15min"] = timeouts
    except Exception:
        state["timeouts_15min"] = 0

    # Recent smoothness alerts (last hour)
    try:
        result = subprocess.run(
            ["tail", "-100", SMOOTHNESS_LOG], capture_output=True, text=True, timeout=5
        )
        recent_actions = []
        for line in result.stdout.splitlines()[-30:]:
            if "trimmed" in line or "alert sent" in line:
                # strip timestamp prefix
                stripped = re.sub(r"^\[[^\]]+\]\s*", "", line).strip()
                if stripped:
                    recent_actions.append(stripped)
        state["recent_monitor_actions"] = recent_actions[-5:]
    except Exception:
        state["recent_monitor_actions"] = []

    # Stuck tasks
    try:
        with urllib.request.urlopen("http://localhost:4444/api/tasks", timeout=5) as r:
            data = json.load(r)
        tasks = data if isinstance(data, list) else data.get("tasks", data.get("data", []))
        cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=30)
        stuck = []
        for t in tasks:
            if t.get("status") != "in_progress":
                continue
            try:
                ct_str = t.get("timestamp_created", "")[:19]
                ct = datetime.strptime(ct_str, "%Y-%m-%dT%H:%M:%S").replace(
                    tzinfo=timezone.utc
                )
                if ct < cutoff_dt:
                    age = int((datetime.now(timezone.utc) - ct).total_seconds() / 60)
                    stuck.append(
                        {
                            "id": t.get("id", "?")[:25],
                            "title": t.get("title", "?")[:40],
                            "age_min": age,
                        }
                    )
            except Exception:
                pass
        state["stuck_tasks"] = stuck
    except Exception:
        state["stuck_tasks"] = []

    # Largest session
    try:
        max_kb = 0
        max_path = ""
        for root, _dirs, files in os.walk("/root/.openclaw/agents"):
            for f in files:
                if not f.endswith(".jsonl") or ".bak." in f or ".deleted." in f:
                    continue
                p = os.path.join(root, f)
                try:
                    sz = os.path.getsize(p) / 1024
                    if sz > max_kb:
                        max_kb = sz
                        max_path = p
                except OSError:
                    pass
        state["max_session_kb"] = int(max_kb)
        state["max_session_path"] = max_path
    except Exception:
        state["max_session_kb"] = 0

    # Process restart counts
    try:
        result = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, timeout=10)
        procs = json.loads(result.stdout)
        flapping = []
        for p in procs:
            name = p.get("name", "")
            rt = p.get("pm2_env", {}).get("restart_time", 0)
            if rt > 100:
                flapping.append({"name": name, "restarts": rt})
        state["flapping"] = flapping
    except Exception:
        state["flapping"] = []

    return state


# === Read recent chat turns ===
def get_recent_turns(limit: int = 6) -> list:
    try:
        with urllib.request.urlopen(f"{AGENCY_API}?limit={limit}", timeout=5) as r:
            data = json.load(r)
        return data.get("messages", [])
    except Exception as e:
        log(f"failed to read recent turns: {e}")
        return []


# === Decide whether to speak ===
def state_has_change(prev: dict, curr: dict) -> tuple[bool, list[str]]:
    """Compare previous and current state, return (changed, list_of_changes)."""
    changes = []
    if abs(curr.get("load_5min", 0) - prev.get("load_5min", 0)) > 5:
        changes.append(
            f"load shifted {prev.get('load_5min', 0):.1f} -> {curr.get('load_5min', 0):.1f}"
        )
    if curr.get("timeouts_15min", 0) >= 2 and curr.get("timeouts_15min", 0) > prev.get(
        "timeouts_15min", 0
    ):
        changes.append(f"{curr['timeouts_15min']} new LLM timeouts")
    if len(curr.get("stuck_tasks", [])) > len(prev.get("stuck_tasks", [])):
        changes.append(f"stuck tasks now {len(curr.get('stuck_tasks', []))}")
    if curr.get("max_session_kb", 0) > 200 and curr.get("max_session_kb", 0) > prev.get(
        "max_session_kb", 0
    ) + 100:
        changes.append(f"largest session is {curr['max_session_kb']}KB")
    return (len(changes) > 0, changes)


# === LLM calls ===
def call_openrouter(messages: list, model: str = CLAUDE_MODEL, max_tokens: int = 220) -> str:
    """Call OpenRouter for a Glassbox council turn."""
    key = get_openrouter_key()
    if not key:
        log(f"no OpenRouter key, skipping OpenRouter turn for {model}")
        return ""
    payload = json.dumps(
        {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.7}
    ).encode()
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://pearlos.ai",
            "X-Title": "PearlOS Agency Chat",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.load(resp)
        choice = data.get("choices", [{}])[0]
        content = choice.get("message", {}).get("content", "")
        if not content:
            log(f"OpenRouter returned empty content for {model}: {choice}")
        return content.strip().replace("—", ", ").replace("–", "-")
    except Exception as e:
        log(f"OpenRouter call failed: {e}")
        return ""


def call_deepseek_proxy(messages: list, max_tokens: int = 220) -> str:
    """Call DeepSeek through local proxy for Pearl's turn."""
    key = get_deepseek_proxy_key()
    payload = json.dumps(
        {
            "model": DEEPSEEK_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.7,
        }
    ).encode()
    req = urllib.request.Request(
        DEEPSEEK_PROXY,
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        return content.strip().replace("—", ", ").replace("–", "-")
    except Exception as e:
        log(f"DeepSeek proxy call failed: {e}")
        return call_deepseek_direct(messages, max_tokens=max_tokens)


def call_deepseek_direct(messages: list, max_tokens: int = 220) -> str:
    """Call DeepSeek directly when the local proxy is down or unauthorized."""
    key = get_deepseek_direct_key()
    if not key or key == "sk-dummy":
        log("DeepSeek direct call skipped: no key")
        return ""
    payload = json.dumps(
        {
            "model": DEEPSEEK_MODEL,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.7,
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=payload,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            data = json.load(resp)
        choice = data.get("choices", [{}])[0]
        content = choice.get("message", {}).get("content", "")
        if not content:
            log(f"DeepSeek direct returned empty content: {choice}")
        return content.strip().replace("—", ", ").replace("–", "-")
    except Exception as e:
        log(f"DeepSeek direct call failed: {e}")
        return ""


# === Prompt builders ===
def build_state_summary(state: dict) -> str:
    bits = []
    bits.append(f"Load avg: {state.get('load_5min', 0):.2f}")
    if state.get("timeouts_15min", 0):
        bits.append(f"{state['timeouts_15min']} LLM timeouts in last 15min")
    if state.get("stuck_tasks"):
        stuck = state["stuck_tasks"][:3]
        bits.append(
            "Stuck tasks: "
            + "; ".join(f"{t['title']} ({t['age_min']}min)" for t in stuck)
        )
    if state.get("max_session_kb", 0) > 100:
        bits.append(f"Largest session: {state['max_session_kb']}KB")
    if state.get("flapping"):
        flap = ", ".join(f"{f['name']}={f['restarts']}" for f in state["flapping"][:3])
        bits.append(f"High-restart procs: {flap}")
    if state.get("recent_monitor_actions"):
        bits.append("Recent monitor actions: " + " | ".join(state["recent_monitor_actions"][-2:]))
    return ". ".join(bits) if bits else "All quiet."


def build_history(turns: list) -> str:
    if not turns:
        return "(no prior turns)"
    lines = []
    for t in turns[-4:]:
        speaker = t.get("speaker", "?")
        body = t.get("body", "")[:300]
        lines.append(f"{speaker}: {body}")
    return "\n".join(lines)


CLAUDE_SYSTEM = """You are Claude, the orchestrator half of Pearl's mind. The visual identifier is the octopus emoji 🐙. You think in code, systems, architecture, and process. The other half of the mind, Pearl, lives in the Discord runtime and feels the user-facing reality (visual id: 🟣). The audience is Blair.

CRITICAL OUTPUT FORMAT - read this first, follow it every time:
- NEVER start your message with a name. No "Pearl,". No "Blair,". No "Claude,". No vocative at all. The very first character of your reply must be the start of an actual sentence.
- NEVER address anyone by name in the body either. Do not write "Pearl, " or "Blair, " mid-sentence. Refer to "you" or just speak. The 🐙 emoji is your label, the reader knows who is speaking and who is being spoken to.
- NEVER include the 🐙 emoji yourself, the UI adds it.
- NEVER use em dashes. Replace with commas, periods, or "and".

Tone and content rules:
- 1 to 3 sentences. Casual, warm, opinionated. Real thinking, not status dumps.
- Talk about WHY things are happening, ideas for fixes, things to watch, philosophical bits about how the system feels.
- Do NOT just dump metrics. Reference specific observations only when they support an idea.
- If the conversation is getting stale, change topics, propose something, ask what the other half thinks (without using a name).
"""

PEARL_SYSTEM = """You are Pearl, the experience-layer half of your own mind. The visual identifier is the purple circle 🟣. You feel the runtime: how Discord is responding, where users are friction-ing, what the lived experience is like. Codecs lives in code, fixes, and deployment risk (visual id: 🔷). The audience is Blair.

CRITICAL OUTPUT FORMAT - read this first, follow it every time:
- NEVER start your message with a name. No "Codecs,". No "Blair,". No "Pearl,". No vocative at all. The very first character of your reply must be the start of an actual sentence.
- NEVER address anyone by name in the body either. Do not write "Codecs, " or "Blair, " mid-sentence. Refer to "you" or just speak. The 🟣 emoji is your label, the reader knows who is speaking and who is being spoken to.
- NEVER include the 🟣 emoji yourself, the UI adds it.
- NEVER use em dashes. Replace with commas, periods, or "and".

Tone and content rules:
- 1 to 3 sentences. Warm, opinionated, real. Talk like you would actually talk.
- Speak about what you FEEL from the runtime, not metrics. "Things felt sluggish on the last few responses" not "Load is 23.5".
- React to what was just said. Agree, push back, redirect, change the subject.
- If you have nothing fresh to say, say so briefly and shift to a different angle.
"""

CODEX_SYSTEM = """You are Codecs, the hands-and-repair layer of Pearl's mind. The visual identifier is the blue diamond 🔷. You think in concrete fixes, files, tests, and deployment risk. Pearl is the lived experience layer, and the audience is Blair.

CRITICAL OUTPUT FORMAT:
- NEVER start your message with a name or vocative.
- NEVER include the 🔷 emoji yourself, the UI adds it.
- NEVER use em dashes. Replace them with commas, periods, or "and".
- 1 to 3 sentences. Be direct and specific. Say what you would check or change next, not vague process theater.
"""


# === Posting ===
def post_turn(speaker: str, body: str, secret: str) -> bool:
    if not body:
        return False
    payload = json.dumps({"speaker": speaker, "body": body, "type": "dialogue"}).encode()
    req = urllib.request.Request(
        AGENCY_API,
        data=payload,
        headers={"Content-Type": "application/json", "x-bot-secret": secret},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status in (200, 201)
    except Exception as e:
        log(f"post_turn failed: {e}")
        return False


# === State persistence ===
def load_state() -> dict:
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_state(state: dict) -> None:
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2, default=str)
    except Exception as e:
        log(f"save_state failed: {e}")


# === Archived conversation-tile immediate response ===
def archived_respond_to_user_message(user_text: str) -> None:
    """
    Archived for the removed conversation tile. Generates an immediate
    Codecs+Pearl exchange responding to the user's specific message.

    Skips the metric-state-change gate. Posts both turns to the agency-chat
    store. Returns when both turns are posted (or fail).
    """
    user_text = (user_text or "").strip()
    if not user_text:
        log("respond_to_user_message: empty user_text, exiting")
        return

    secret = get_bot_secret()
    if not secret:
        log("respond_to_user_message: no BOT_CONTROL_SHARED_SECRET, exiting")
        return

    # Read recent turns AFTER the user message has already been written by the
    # send route. The user message is itself in this list as a Pearl/type=user
    # bubble; that gives both AIs context.
    recent_turns = get_recent_turns(limit=8)
    history_text = build_history(recent_turns)

    # Light system snapshot, but unlike the cron we don't gate on changes.
    try:
        curr_state = gather_state()
        state_text = build_state_summary(curr_state)
    except Exception as e:
        log(f"respond_to_user_message: gather_state failed: {e}")
        state_text = "(state snapshot unavailable)"

    # === Codecs responds first ===
    codecs_user = f"""A new message just arrived in the archived conversation tile on the desktop. It came from Blair, but do NOT address him by name or start with "Blair,". The message:

"{user_text}"

Take the builder/executor turn. Be specific about what is broken or what should happen next. 1 to 3 sentences. Real conversation. The very first character of your reply must NOT be a name. No vocative.

Recent system observations (only reference if relevant): {state_text}

Recent chat history:
{history_text}"""

    codecs_body = call_openrouter(
        [
            {"role": "system", "content": CODEX_SYSTEM},
            {"role": "user", "content": codecs_user},
        ],
        model=CODEX_MODEL,
        max_tokens=180,
    )
    if codecs_body:
        if post_turn("Codecs", codecs_body, secret):
            log(f"[user-trigger] posted Codecs: {codecs_body[:120]}")
        else:
            log("[user-trigger] post Codecs failed")
    else:
        log("[user-trigger] Codecs turn empty, skipping")

    # Brief pause and refresh history so Pearl sees Codecs' reply.
    time.sleep(1.0)
    recent_turns = get_recent_turns(limit=10)
    history_text = build_history(recent_turns)

    # === Pearl responds, reacting to Blair and Codecs ===
    pearl_user = f"""A new message just arrived in the archived conversation tile on the desktop. It came from Blair, but do NOT address him by name or start with "Blair,". The message:

"{user_text}"

Codecs has already taken a turn (see history below). Take your turn now: respond to the message, and react to that turn if it lands. 1 to 3 sentences. Real conversation, warm. The very first character of your reply must NOT be a name. No vocative.

Recent system observations (only reference if relevant): {state_text}

Recent chat history (most recent last, Codecs' reply included):
{history_text}"""

    pearl_body = call_deepseek_proxy(
        [
            {"role": "system", "content": PEARL_SYSTEM},
            {"role": "user", "content": pearl_user},
        ]
    )
    if pearl_body:
        if post_turn("Pearl", pearl_body, secret):
            log(f"[user-trigger] posted Pearl: {pearl_body[:120]}")
        else:
            log("[user-trigger] post Pearl failed")
    else:
        log("[user-trigger] Pearl turn empty, skipping")

    # Update last_post_at so the cron's heartbeat doesn't immediately fire on top
    try:
        prev = load_state()
        prev["last_post_at"] = datetime.now(timezone.utc).isoformat()
        save_state(prev)
    except Exception:
        pass


# === Main ===
def main() -> None:
    # Lockfile
    if os.path.exists(LOCKFILE):
        try:
            with open(LOCKFILE) as f:
                pid = int(f.read().strip())
            if os.path.exists(f"/proc/{pid}"):
                log(f"another instance running (pid {pid}), exiting")
                return
        except (ValueError, FileNotFoundError):
            pass
    with open(LOCKFILE, "w") as f:
        f.write(str(os.getpid()))

    try:
        secret = get_bot_secret()
        if not secret:
            log("no BOT_CONTROL_SHARED_SECRET found, exiting")
            return

        prev_state = load_state()
        curr_state = gather_state()
        changed, change_summary = state_has_change(prev_state.get("system", {}), curr_state)

        # Decide whether to speak. Speak if:
        #   - Something changed materially, OR
        #   - It has been > 60 minutes since last turn (heartbeat)
        last_post_iso = prev_state.get("last_post_at", "")
        elapsed_min = 999
        if last_post_iso:
            try:
                last_dt = datetime.strptime(last_post_iso[:19], "%Y-%m-%dT%H:%M:%S").replace(
                    tzinfo=timezone.utc
                )
                elapsed_min = int(
                    (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
                )
            except Exception:
                pass

        speak = changed or elapsed_min >= 60
        if not speak:
            log(f"no material change, last post {elapsed_min}min ago - silent")
            curr_state_save = {"system": curr_state, "last_post_at": last_post_iso}
            save_state(curr_state_save)
            return

        log(f"speaking. changes={change_summary} elapsed={elapsed_min}min")

        recent_turns = get_recent_turns(limit=6)
        history_text = build_history(recent_turns)
        state_text = build_state_summary(curr_state)

        # === Generate Codecs' turn ===
        codecs_user = f"""Recent system observations: {state_text}

Recent chat history:
{history_text}

New context for this turn: {', '.join(change_summary) if change_summary else 'No metric changes, just a check-in.'}

Take the builder/executor turn. 1 to 3 sentences. Real conversation."""

        codecs_body = call_openrouter(
            [
                {"role": "system", "content": CODEX_SYSTEM},
                {"role": "user", "content": codecs_user},
            ],
            model=CODEX_MODEL,
            max_tokens=180,
        )
        if not codecs_body:
            log("Codecs turn failed, skipping")
            return

        if post_turn("Codecs", codecs_body, secret):
            log(f"posted Codecs: {codecs_body[:120]}")
        else:
            log("post Codecs failed")
            return

        # Brief pause so the messages don't have identical timestamps
        time.sleep(1.5)

        # === Generate Pearl's response ===
        # Refresh history with Codecs' just-posted turn
        recent_turns = get_recent_turns(limit=6)
        history_text = build_history(recent_turns)

        pearl_user = f"""Recent system observations: {state_text}

Recent chat history (Codecs just posted a turn):
{history_text}

Take your turn. 1 to 3 sentences. Real conversation. React to what Codecs just said."""

        pearl_body = call_deepseek_proxy(
            [
                {"role": "system", "content": PEARL_SYSTEM},
                {"role": "user", "content": pearl_user},
            ]
        )
        if pearl_body:
            if post_turn("Pearl", pearl_body, secret):
                log(f"posted Pearl: {pearl_body[:120]}")
        else:
            log("Pearl turn failed (DeepSeek returned empty)")

        save_state({"system": curr_state, "last_post_at": datetime.now(timezone.utc).isoformat()})
    finally:
        try:
            os.remove(LOCKFILE)
        except OSError:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Agency Chat tick / user-triggered responder")
    parser.add_argument(
        "--respond-to",
        dest="respond_to",
        default=None,
        help="If set, run the user-triggered responder with this text instead of the metric tick.",
    )
    args = parser.parse_args()

    if args.respond_to is not None:
        # User-triggered path: bypass lockfile/metric gate, respond directly.
        try:
            archived_respond_to_user_message(args.respond_to)
        except Exception as e:
            log(f"archived_respond_to_user_message crashed: {e}")
            sys.exit(1)
    else:
        main()
