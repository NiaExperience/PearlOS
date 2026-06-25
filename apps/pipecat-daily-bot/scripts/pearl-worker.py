#!/usr/bin/env python3
"""pearl-worker — headless swarm executor for PearlOS dispatches.

The endgame: Pearl dispatches a task → this worker claims it → runs it →
writes the result back. Blair doesn't need to be in a CLI session at all.

USAGE

  # SSE mode (production — reacts to pushed events, zero polling lag):
  pearl-worker.py --sse --executor claude
  pearl-worker.py --sse --executor codex

  # One-shot: claim a single pending task, execute, complete, exit.
  pearl-worker.py --once --executor claude

  # Daemon mode: poll forever.
  pearl-worker.py --executor claude

  # Dry run: claim + fake-execute + release (don't complete).
  pearl-worker.py --dry-run

  # Legacy: shell command executor (stdin=task JSON, stdout=result).
  pearl-worker.py --executor "my-script.sh"

ENV / FLAGS

  --api URL          Default http://localhost:4444/api/tasks
  --assignee NAME    Only claim tasks with this assignee. Default claude_cli.
  --interval SEC     Polling interval when not using --sse. Default 5.
  --max TASKS        Exit after this many completions (0 = unlimited).
  --concurrency N    Max parallel boss subprocesses. Default 2.
  --timeout SEC      Per-task timeout in seconds. Default 1500 (25 min).
  --executor MODE    "claude" for Claude CLI subprocess.
                     "codex" for Codex CLI subprocess.
                     "agency" to read the boss from config/env.
                     Any other string = shell command (task JSON on stdin).
                     If omitted, built-in echo stub is used.
  --log FILE         Log file path. Default /tmp/pearl-worker.log.

  PEARL_TASKS_API             same as --api
  PEARL_WORKER_ASSIGNEE       same as --assignee
  BOT_CONTROL_SHARED_SECRET   sent as X-Bot-Secret / Bearer when set

DESIGN NOTES

  - Claim-first pattern: PATCH status=in_progress before spawning subprocess.
    If two workers race, whoever patches first wins.

  - Boss executor: builds a prompt with the full task body + footer
    instructions. Spawns Claude or Codex over stdin
    so task details are not exposed in the process list.
    Subprocess runs to completion. Worker captures exit code + stdout/stderr.

  - Concurrency: max 2 simultaneous boss subprocesses (configurable).
    New tasks wait in a small buffer until a slot opens.

  - SSE mode subscribes to /api/tasks/stream and also does a catch-up poll
    on connect to pick up tasks created while the worker was down.

  - Stdlib only: urllib, json, subprocess. No third-party deps. Python 3.9+.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, Iterator, Optional, Tuple

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
_LOG_FORMAT = "%(asctime)s [%(levelname)s] %(message)s"


def _setup_logging(log_file: str) -> None:
    handlers: list = [logging.StreamHandler(sys.stdout)]
    try:
        os.makedirs(os.path.dirname(log_file) or ".", exist_ok=True)
        handlers.append(logging.FileHandler(log_file, encoding="utf-8"))
    except OSError:
        pass
    logging.basicConfig(level=logging.INFO, format=_LOG_FORMAT, handlers=handlers)


log = logging.getLogger("pearl-worker")

DEFAULT_AGENCY_BOSS_CONFIG_PATHS = (
    "/opt/pearlos/config/agency-boss.json",
    "/workspace/nia-universal-pearl-prod/config/agency-boss.json",
    "/workspace/nia-universal/config/agency-boss.json",
    "/home/deploy/pearlos/config/agency-boss.json",
)
AGENCY_BOSS_EXECUTORS = {
    "codex": "codex",
    "claude": "claude",
    "deepseek-v4-pro": "codex",
    "glm-5-1": "codex",
    "kimi-k2-7-code": "codex",
    "gemini-latest": "codex",
    "qwen-best": "codex",
}
AGENCY_BOSS_ALIASES = {
    "opus": "claude",
    "claude-opus-4-6": "claude",
    "claude-opus-4.6": "claude",
    "deepseekprov4": "deepseek-v4-pro",
    "deepseek-pro-v4": "deepseek-v4-pro",
    "deepseek-v4": "deepseek-v4-pro",
    "glm5.1": "glm-5-1",
    "glm-5.1": "glm-5-1",
    "kimi2.7": "kimi-k2-7-code",
    "kimi-k2.7": "kimi-k2-7-code",
    "gemini": "gemini-latest",
    "qwen": "qwen-best",
}
AGENCY_BOSS_VALUES = set(AGENCY_BOSS_EXECUTORS)


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())


def _normalize_agency_boss(value: object) -> Optional[str]:
    boss = str(value or "").strip().lower()
    boss = AGENCY_BOSS_ALIASES.get(boss, boss)
    return boss if boss in AGENCY_BOSS_VALUES else None


def _executor_for_agency_boss(value: Optional[str]) -> Optional[str]:
    boss = _normalize_agency_boss(value)
    return AGENCY_BOSS_EXECUTORS.get(boss) if boss else None


def _looks_like_blocked_result(result: str) -> bool:
    text = re.sub(r"\s+", " ", str(result or "")).strip().lower()
    if not text:
        return False
    strong_blocked_markers = (
        "blocked by workspace isolation",
        "workspace isolation active",
        "could not edit protected",
        "could not apply",
        "could not modify",
        "did not apply or deploy",
        "didn't apply or deploy",
        "protected pearlos source edits are disabled",
        "protected source edits are disabled",
        "prepared a sandboxed",
        "created a sandboxed patch",
        "implemented the file in a sandboxed source copy",
        "could not post it into notes",
        "could not post into notes",
        "couldn't post it into notes",
        "couldn't post into notes",
        "could not post it into discord",
        "could not post into discord",
        "couldn't post it into discord",
        "couldn't post into discord",
        "local/discord network calls are blocked",
        "/workspace/user is mounted read-only",
        "mounted read-only",
        "next recovery step is to copy that report",
        "use a personal workspace or fork artifact",
        "provide a source checkout",
        "provide the codebase",
    )
    if any(marker in text for marker in strong_blocked_markers):
        return True
    success_markers = (
        "built ",
        "created ",
        "implemented ",
        "completed ",
        "finished ",
        "verification run:",
        "verified ",
    )
    if any(marker in text for marker in success_markers):
        return False
    blocked_markers = (
        "allowed workspace is empty",
        "blocked by workspace isolation",
        "cannot reconstruct",
        "could not reconstruct",
        "couldn't continue",
        "could not continue",
        "workspace isolation active",
        "could not edit protected",
        "could not apply",
        "could not modify",
        "did not edit protected",
        "no recoverable content",
        "no files were changed",
        "no source files were changed",
        "no handoff notes",
        "not a git checkout",
        "original task cannot be reconstructed",
        "no production, deploy target, or protected source files were touched",
        "personal-instance routing requires",
        "could not post it into notes",
        "could not post into notes",
        "couldn't post it into notes",
        "couldn't post into notes",
        "could not post it into discord",
        "could not post into discord",
        "couldn't post it into discord",
        "couldn't post into discord",
        "local/discord network calls are blocked",
        "/workspace/user is mounted read-only",
        "mounted read-only",
        "next recovery step is to copy that report",
        "use a personal workspace or fork artifact",
        "provide a source checkout",
        "provide the codebase",
    )
    return any(marker in text for marker in blocked_markers)


def _agency_boss_config_paths() -> list[str]:
    paths: list[str] = []
    for raw in (
        os.getenv("PEARLOS_AGENCY_BOSS_CONFIG", ""),
        *os.getenv("PEARLOS_AGENCY_BOSS_CONFIG_PATHS", "").split(":"),
        *DEFAULT_AGENCY_BOSS_CONFIG_PATHS,
    ):
        path = raw.strip()
        if path and path not in paths:
            paths.append(path)
    return paths


def _load_agency_boss_from_config() -> Optional[str]:
    env_boss = _normalize_agency_boss(os.getenv("PEARL_AGENCY_BOSS"))
    if env_boss:
        return env_boss
    for path in _agency_boss_config_paths():
        try:
            with open(path, "r", encoding="utf-8") as handle:
                cfg = json.load(handle)
            boss = _normalize_agency_boss(cfg.get("boss"))
            if boss:
                return boss
        except OSError:
            continue
        except Exception as e:
            log.warning("Could not read agency boss config %s: %s", path, e)
    return None


def _resolve_executor(requested: Optional[str]) -> Optional[str]:
    """Resolve legacy executor flags through the runtime agency boss config.

    Existing PM2 args currently pass `--executor claude`. A config override is
    allowed to win so the Settings toggle can switch bosses without replacing
    the PM2 process definition.
    """
    requested_norm = str(requested or "").strip()
    configured = _load_agency_boss_from_config()
    executor_locked = os.getenv("PEARL_WORKER_EXECUTOR_LOCK", "").lower() in ("1", "true", "yes")
    if configured and not executor_locked:
        return _executor_for_agency_boss(configured) or configured
    if requested_norm in AGENCY_BOSS_VALUES:
        return _executor_for_agency_boss(requested_norm) or requested_norm
    if requested_norm == "agency":
        return _executor_for_agency_boss(configured) or "codex"
    return requested_norm or configured or "codex"


def _load_task_secret() -> str:
    env_secret = os.getenv("BOT_CONTROL_SHARED_SECRET", "") or os.getenv("PEARL_TASKS_BOT_SECRET", "")
    if env_secret:
        return env_secret
    for path in (
        "/workspace/nia-universal/apps/pipecat-daily-bot/.env.local",
        "/workspace/nia-universal/apps/pipecat-daily-bot/.env",
        "/home/deploy/pearlos/apps/pipecat-daily-bot/.env.local",
        "/home/deploy/pearlos/apps/pipecat-daily-bot/.env",
        "/home/deploy/pearlos/.env.local",
    ):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, value = line.split("=", 1)
                    if key.strip() not in ("BOT_CONTROL_SHARED_SECRET", "PEARL_TASKS_BOT_SECRET"):
                        continue
                    value = value.strip().strip("'\"")
                    if value:
                        return value
        except OSError:
            continue
    for path in (
        "/root/.openclaw/openclaw.json",
        "/home/deploy/.openclaw/relay-openclaw.json",
    ):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                cfg = json.load(handle)
            token = (
                cfg.get("gateway", {}).get("auth", {}).get("token")
                or cfg.get("env", {}).get("BOT_CONTROL_SHARED_SECRET")
                or cfg.get("env", {}).get("OPENCLAW_GATEWAY_TOKEN")
            )
            if token:
                return str(token)
        except Exception:
            continue
    return ""


# ---------------------------------------------------------------------------
# API client (stdlib only)
# ---------------------------------------------------------------------------
class TaskAPI:
    def __init__(self, base: str, secret: str = "", timeout: float = 10.0):
        self.base = base.rstrip("/")
        self.secret = secret
        self.timeout = timeout

    def _hdrs(self) -> dict:
        h = {"Accept": "application/json"}
        if self.secret:
            h["X-Bot-Secret"] = self.secret
            h["Authorization"] = f"Bearer {self.secret}"
        return h

    def _req(self, method: str, path: str, body: Optional[dict] = None) -> dict:
        url = self.base + path
        data = None
        headers = self._hdrs()
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, method=method, data=data, headers=headers)
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            text = resp.read().decode("utf-8") or "{}"
        return json.loads(text)

    def list_pending(self, assignee: str, limit: int = 50) -> list[dict]:
        qs = urllib.parse.urlencode(
            {"status": "pending", "assignee": assignee, "limit": limit}
        )
        res = self._req("GET", "?" + qs)
        return list(res.get("tasks") or [])

    def list_in_progress(self, assignee: str, limit: int = 100) -> list[dict]:
        qs = urllib.parse.urlencode(
            {"status": "in_progress", "assignee": assignee, "limit": limit}
        )
        res = self._req("GET", "?" + qs)
        return list(res.get("tasks") or [])

    def get(self, task_id: str) -> Optional[dict]:
        try:
            res = self._req("GET", f"/{task_id}")
            return res.get("task")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise

    def claim(self, task_id: str, worker: str) -> Optional[dict]:
        try:
            res = self._req(
                "PATCH",
                f"/{task_id}",
                {
                    "status": "in_progress",
                    "expected_status": "pending",
                    "claim_worker": worker,
                    "note": f"Claimed by {worker}",
                },
            )
            return res.get("task")
        except urllib.error.HTTPError as e:
            if e.code in (404, 409):
                return None
            raise

    def patch(self, task_id: str, body: dict) -> dict:
        res = self._req("PATCH", f"/{task_id}", body)
        return res.get("task") or {}

    def complete(self, task_id: str, result: str, note: str = "") -> dict:
        body: dict = {"status": "completed", "result": result}
        if note:
            body["note"] = note
        res = self._req("PATCH", f"/{task_id}", body)
        return res.get("task") or {}

    def fail(self, task_id: str, error: str, note: str = "", no_retry: bool = False) -> dict:
        body: dict = {"status": "failed", "result": error}
        if note:
            body["note"] = note
        if no_retry:
            body["no_retry"] = True
        res = self._req("PATCH", f"/{task_id}", body)
        # The gateway auto-requeues failed tasks (bumps retry_count and
        # flips status back to pending while under the retry budget). So
        # the returned record will commonly have status=pending even though
        # we asked for failed. The worker uses that to decide what to say
        # in the Discord notice.
        return res.get("task") or {}

    def stream(self, read_timeout: float = 35.0) -> Iterator[dict]:
        """Yield task envelopes from the SSE stream.

        Uses a per-read socket timeout of *read_timeout* seconds so that a
        silently-stalled server is detected promptly.  Raises socket.timeout
        (a subclass of OSError / TimeoutError) when no data arrives within
        that window — the caller can treat that as a liveness-probe trigger.
        """
        url = self.base + "/stream"
        req = urllib.request.Request(url, headers=self._hdrs())
        # Connect with a short timeout; then switch to read_timeout for the
        # long-lived streaming phase so each individual read has a deadline.
        with urllib.request.urlopen(req, timeout=15) as resp:
            # Reach into the underlying socket and apply the streaming timeout.
            raw_sock = getattr(resp.fp, "raw", None)
            if raw_sock is not None:
                try:
                    raw_sock.settimeout(read_timeout)
                except Exception:
                    pass
            data_buf: list[str] = []
            event_name: Optional[str] = None
            for raw in resp:
                line = raw.decode("utf-8", errors="replace").rstrip("\n").rstrip("\r")
                if not line:
                    if data_buf and event_name:
                        try:
                            payload = json.loads("".join(data_buf))
                            payload.setdefault("event", event_name)
                            yield payload
                        except json.JSONDecodeError:
                            pass
                    data_buf = []
                    event_name = None
                    continue
                if line.startswith(":"):
                    yield {"event": "keepalive"}
                    continue
                if line.startswith("event:"):
                    event_name = line[6:].strip()
                elif line.startswith("data:"):
                    data_buf.append(line[5:].lstrip())


# ---------------------------------------------------------------------------
# Discord notification helper
# ---------------------------------------------------------------------------
def _trim_at_sentence_boundary(text: str, limit: int = 1800) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    chunk = value[:limit]
    cut = max(chunk.rfind(". "), chunk.rfind("! "), chunk.rfind("? "), chunk.rfind("\n\n"), chunk.rfind("\n"))
    if cut >= int(limit * 0.55):
        return chunk[: cut + 1].strip()
    word_cut = chunk.rfind(" ")
    return (chunk[: word_cut if word_cut > 0 else limit].strip() + "...").strip()


def _normalize_style_punctuation(text: str) -> str:
    value = str(text or "")
    value = value.replace("\\u2014", ", ").replace("\\u2013", "-")
    value = re.sub(r"\s*—+\s*", ", ", value)
    value = re.sub(r"\s+–\s+", ", ", value)
    value = value.replace("–", "-")
    value = re.sub(r"\s+,", ",", value)
    value = re.sub(r",\s{2,}", ", ", value)
    value = re.sub(r"^\s*,\s*", "", value)
    value = re.sub(r"([.!?]\s+),\s*", r"\1", value)
    return value


def _public_discord_content(content: str, limit: int = 1800) -> str:
    value = str(content or "")
    value = re.sub(r"<file\b[^>]*>[\s\S]*?</file>", "", value, flags=re.I)
    value = re.sub(r"^\s*<file\b[^\n]*(?:\n|$)", "", value, flags=re.I | re.M)
    value = re.sub(r"</?(?:sessions?|session)\b[^>]*/?\s*>", "", value, flags=re.I)
    tool_tags = r"(?:read|write|edit|grep|glob|ls|bash|command|exec|tool|tools|tool_call|tool_use|tool_result|function|function_call|function_result)"
    value = re.sub(r"(?:^|\n)\s*<exec\b[^\n]*(?:\n|$)", "\n", value, flags=re.I)
    value = re.sub(rf"<{tool_tags}\b[^>]*/\s*>", "", value, flags=re.I)
    value = re.sub(rf"<{tool_tags}\b[^>]*>[\s\S]*?(?:</{tool_tags}>|$)", "", value, flags=re.I)
    value = re.sub(rf"</{tool_tags}\s*>", "", value, flags=re.I)
    value = re.sub(
        r"^\s*<path>\s*(?:/(?:workspace|home|opt|root|tmp|var)/[^<]+|[A-Za-z]:\\[^<]+)\s*</path>\s*$",
        "",
        value,
        flags=re.I | re.M,
    )
    value = _strip_inline_json_tool_objects(value)
    value = re.sub(
        r'```(?:json|xml|tool|tools?|function|function_call|tool_code)?\s*[\s\S]*?(?:"tool_call"|"tool_use"|"function_call"|"recipient_name"|"exec_command"|"pearl-task-dispatch"|"pearl-swarm-dispatch"|<(?:exec|read|command)\b)[\s\S]*?```',
        "",
        value,
        flags=re.I,
    )
    value = re.sub(r"```(?:json|xml|tool|tools?|function|function_call|tool_code)?\s*```", "", value, flags=re.I)
    value = re.sub(r"\b(?:disp|run|task|session)-[a-f0-9][a-f0-9_.:-]{7,}\b", "this task", value, flags=re.I)
    value = re.sub(r"\b[a-f0-9]{32,64}\b", "an internal reference", value, flags=re.I)
    value = re.sub(r"^\s*(?:LLM request failed|provider rejected|rawError=|PROXY\s+\d{3}:).*(?:\n|$)", "", value, flags=re.I | re.M)
    value = re.sub(
        r"^(?!.*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b)\s*(?:sandbox|connector|tool|executor|codex|claude)\b.*\b(?:failed|error|rejected|permission|denied|unavailable|not configured)\b.*(?:\n|$)",
        "",
        value,
        flags=re.I | re.M,
    )
    value = re.sub(
        r"\bsandbox\b[^\n.!?]*\b(?:workspace-write|danger-full-access|approval policy|permission mode|sandbox_permissions|require_escalated)\b[^.!?\n]*(?:[.!?]|\n|$)",
        "I hit a worker permissions problem before the task could finish cleanly. ",
        value,
        flags=re.I,
    )
    value = re.sub(r"(?:^|\n)\s*(?:Pearl(?:'s Agency)? says:\s*){2,}", "Pearl's Agency says: ", value, flags=re.I)
    value = re.sub(r"^\s*Pearl's Agency says:\s*Pearl(?:'s Agency)? says:\s*", "Pearl's Agency says: ", value, flags=re.I)
    value = re.sub(r"\bteam\s+slack\b", "Discord channel", value, flags=re.I)
    value = re.sub(r"\btimed[_ -]?out\b", "taking longer than expected", value, flags=re.I)
    value = _normalize_style_punctuation(value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    value = re.sub(r"\s+([.,;:!?])", r"\1", value)
    value = re.sub(r"\n{3,}", "\n\n", value).strip()
    return _trim_at_sentence_boundary(value, limit)


def _strip_inline_json_tool_objects(content: str) -> str:
    value = str(content or "")
    markers = ('"tool_call"', '"tool_calls"', '"function_call"', '"recipient_name"', '"exec_command"', '"parameters"', '"arguments"')
    index = 0
    while index < len(value):
        positions = [value.find(marker, index) for marker in markers]
        positions = [pos for pos in positions if pos >= 0]
        if not positions:
            break
        marker_index = min(positions)
        start = value.rfind("{", 0, marker_index + 1)
        if start < 0:
            index = marker_index + 1
            continue
        depth = 0
        in_string = False
        escaped = False
        end = -1
        for pos in range(start, len(value)):
            char = value[pos]
            if escaped:
                escaped = False
                continue
            if char == "\\":
                escaped = True
                continue
            if char == '"':
                in_string = not in_string
                continue
            if in_string:
                continue
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    end = pos + 1
                    break
        if end < 0:
            value = value[:start].rstrip()
            break
        raw = value[start:end]
        if not re.search(r"tool_calls?|function_call|recipient_name|exec_command|pearl-task-dispatch|pearl-swarm-dispatch|memory_search|web_search", raw, re.I):
            index = marker_index + 1
            continue
        value = value[:start] + value[end:]
        index = start
    return value


def _latest_public_task_note(task: dict) -> str:
    notes = task.get("notes")
    if not isinstance(notes, list):
        return ""
    for note in reversed(notes):
        text = note if isinstance(note, str) else (note or {}).get("text", "")
        clean = _public_discord_content(re.sub(r"\s+", " ", str(text or "")).strip(), 700)
        if clean:
            return clean
    return ""


COMMENTATOR_AGENT_ID = "DeepSeekFlashV4"
COMMENTARY_INTERVAL_S = int(os.getenv("PEARL_COMMENTARY_INTERVAL_S", "45"))
COMMENTARY_BLOCKLIST = re.compile(
    r"(tool_call|function_call|recipient_name|exec_command|arguments|parameters|chain of thought|scratchpad|"
    r"/workspace|/home/deploy|/opt/pearlos|task-[a-f0-9]{8,}|run-[a-f0-9]{8,}|disp-[a-f0-9]{8,})",
    re.I,
)
COMMENTARY_CANNED_RE = re.compile(
    r"\b(i(?:'| a)?m\s+checking|checking\s+(?:now|the|this|that)|still\s+working|working\s+through|"
    r"on\s+it|one\s+(?:sec|moment)|give\s+me\s+a\s+(?:sec|moment)|almost\s+there)\b",
    re.I,
)


def _sanitize_public_commentary(value: str) -> str:
    text = _public_discord_content(re.sub(r"\s+", " ", str(value or "")).strip(), 180)
    text = re.sub(r"^DeepSeekFlashV4\s*:\s*", "", text, flags=re.I).strip()
    if not text or COMMENTARY_BLOCKLIST.search(text) or COMMENTARY_CANNED_RE.search(text):
        return ""
    text = text.strip(" \"'`")
    if not text:
        return ""
    return text[:140].rstrip()


def _commentary_focus(task: dict) -> str:
    title = _task_title(task, 90)
    body = _task_body(task, 420)
    text = f"{title} {body}".lower()
    channels = []
    if "discord" in text:
        channels.append("Discord")
    if "googlechat" in text or "google chat" in text:
        channels.append("GoogleChat")
    if "slack" in text:
        channels.append("Slack")
    if "sms" in text or re.search(r"\btext\b", text):
        channels.append("text")
    if len(channels) >= 3:
        return "the channel audit"
    if "multimodal" in text or "image" in text or "sharing" in text:
        return "the multimodal sharing issue"
    if "notes" in text and ("report" in text or "audit" in text or "link" in text):
        return "the report, Notes delivery, and return link"
    if "security" in text or "stability" in text:
        return "the security and stability check"
    if "audit" in text or "report" in text:
        return "the audit report"
    if channels:
        return f"{channels[0]} work"
    clean_title = re.sub(r"^[^A-Za-z0-9]+|[^A-Za-z0-9]+$", "", title)
    return clean_title[:72].rstrip() or "the request"


def _stable_commentary_choice(task: dict, phase: str, elapsed_s: float, options: list[str]) -> str:
    if not options:
        return ""
    seed = f"{task.get('id') or ''}|{phase}|{int(max(0, elapsed_s) // 60)}|{_task_title(task, 80)}"
    index = sum(seed.encode("utf-8")) % len(options)
    return options[index]


def _load_commentary_api_key() -> str:
    env_key = (
        os.getenv("PEARL_COMMENTARY_API_KEY", "")
        or os.getenv("DEEPSEEK_API_KEY", "")
        or os.getenv("PEARL_LLM_API_KEY", "")
    ).strip()
    if env_key and env_key != "sk-dummy":
        return env_key
    for path in (
        "/home/deploy/.openclaw/openclaw.json",
        "/home/deploy/.openclaw/relay-openclaw.json",
        "/root/.openclaw/openclaw.json",
    ):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                cfg = json.load(handle)
            providers = cfg.get("models", {}).get("providers", {})
            token = (
                providers.get("pearl-llm", {}).get("apiKey")
                or providers.get("deepseek", {}).get("apiKey")
                or cfg.get("env", {}).get("DEEPSEEK_API_KEY")
            )
            token = str(token or "").strip()
            if token and token != "sk-dummy":
                return token
        except Exception:
            continue
    return ""


def _office_visible_agents(task: dict) -> list[str]:
    raw_agents = task.get("agents")
    agents = raw_agents if isinstance(raw_agents, list) else []
    labels: list[str] = []
    saw_pearl = False
    for agent in agents:
        label = re.sub(r"\s+", " ", str(agent or "")).strip()
        if not label:
            continue
        if re.fullmatch(r"pearl(?:\s+agent)?", label, flags=re.I):
            saw_pearl = True
            continue
        labels.append(label)
    if labels:
        return labels
    return ["Pearl"] if saw_pearl or not agents else []


def _fallback_commentary(task: dict, phase: str, elapsed_s: float) -> str:
    return ""


def _deepseek_commentary(task: dict, phase: str, executor: Optional[str], elapsed_s: float) -> str:
    fallback = _fallback_commentary(task, phase, elapsed_s)
    if os.getenv("PEARL_COMMENTARY_DISABLE_LLM", "").lower() in ("1", "true", "yes"):
        return fallback
    url = os.getenv("PEARL_COMMENTARY_URL", "http://127.0.0.1:8200/v1/chat/completions").strip()
    model = os.getenv("PEARL_COMMENTARY_MODEL", "deepseek-v4-flash").strip() or "deepseek-v4-flash"
    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "Write one short public Pearl status line in first person. Use 9-20 words. "
                    "Sound present, specific, and conversational, not like a status bot. "
                    "No markdown, file paths, tool names, IDs, hidden reasoning, or promises without evidence. "
                    "Do not say 'Still working on it', 'Working through', or 'I'll only post again'."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "task": _task_title(task, 80),
                        "summary": _task_body(task, 260),
                        "phase": phase,
                        "executor": executor or "agency",
                        "elapsed_seconds": int(max(0, elapsed_s)),
                        "focus": _commentary_focus(task),
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "temperature": 0.35,
        "max_tokens": 48,
    }
    try:
        headers = {"Content-Type": "application/json"}
        api_key = _load_commentary_api_key()
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            payload = json.loads(resp.read().decode("utf-8") or "{}")
        text = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
        return _sanitize_public_commentary(text) or fallback
    except Exception:
        return fallback

def _post_discord(channel_id: str, content: str) -> bool:
    """Fire-and-forget Discord message.

    PM2 runs this worker as deploy on staging. Prefer deploy-owned config
    files because inherited PM2 env can hold a revoked token until refreshed.
    The root OpenClaw config is only a fallback for older launch paths.
    """
    def _candidate_tokens() -> Iterator[Tuple[str, str]]:
        seen: set[str] = set()

        def add(source: str, value: object) -> Iterator[Tuple[str, str]]:
            token_value = str(value or "").strip()
            if not token_value or token_value in seen:
                return
            seen.add(token_value)
            yield source, token_value

        # Config files are more reliable than inherited PM2 env on staging; the
        # env can hold a revoked token until the process manager is refreshed.
        for token_file in (
            "/home/deploy/.openclaw/openclaw.json",
            "/home/deploy/.openclaw/relay-openclaw.json",
            "/root/.openclaw/openclaw.json",
        ):
            try:
                with open(token_file, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                yield from add(
                    token_file,
                    cfg.get("channels", {}).get("discord", {}).get("token", "")
                    or cfg.get("env", {}).get("DISCORD_BOT_TOKEN", ""),
                )
            except OSError:
                continue
            except Exception as e:
                log.warning("Could not read Discord token source %s: %s", token_file, e)

        yield from add("process env", os.getenv("DISCORD_BOT_TOKEN", ""))

    try:
        clean_content = _public_discord_content(content)
        if not clean_content:
            log.info("Discord notify skipped: sanitized content was empty")
            return False
        payload = json.dumps({"content": clean_content, "allowed_mentions": {"parse": []}}).encode("utf-8")
        attempted = False
        for source, token in _candidate_tokens():
            attempted = True
            req = urllib.request.Request(
                f"https://discord.com/api/v10/channels/{channel_id}/messages",
                method="POST",
                data=payload,
                headers={
                    "Authorization": f"Bot {token}",
                    "Content-Type": "application/json",
                    "User-Agent": "DiscordBot (pearl-worker, 1.0)",
                },
            )
            try:
                with urllib.request.urlopen(req, timeout=10) as resp:
                    resp.read()
                if source != "process env":
                    log.info("Discord notify succeeded using %s", source)
                return True
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    log.warning("Discord notify rejected token from %s: HTTP %s", source, e.code)
                    continue
                log.warning("Discord notify failed from %s: HTTP %s", source, e.code)
                return False
        if not attempted:
            log.warning("Discord notify skipped: no bot token configured")
            return False
        log.warning("Discord notify failed: all token sources rejected")
        return False
    except Exception as e:
        log.warning("Discord notify failed: %s", e)
        return False


def _task_title(task: dict, limit: int = 96) -> str:
    title = str(task.get("title") or task.get("task") or "Pearl task")
    title = re.sub(r"\s+", " ", title).strip()
    return title[:limit].rstrip() or "Pearl task"


def _task_body(task: dict, limit: int = 1200) -> str:
    body = str(task.get("task") or task.get("title") or "")
    body = re.sub(r"\s+", " ", body).strip()
    return body[:limit].rstrip()


DISCORD_STATUS_CHANNEL = os.getenv(
    "PEARL_LOG_MESSAGES_CHANNEL",
    os.getenv("PEARL_DISCORD_LOG_FALLBACK_CHANNEL", "1473007676157071431"),
)  # log/status channel; do not default to Blair's user channel
PUBLIC_TASK_ROOT = os.getenv("PEARL_PUBLIC_TASK_ROOT", "/srv/pearl-user-workspaces")
STAGING_SOURCE_ROOT = os.getenv("PEARLOS_STAGING_SOURCE_ROOT", "/workspace/nia-universal")
WORKSPACE_ENTITLEMENTS_CONFIG_PATHS = tuple(
    path.strip()
    for path in (
        os.getenv("PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG", ""),
        *os.getenv("PEARLOS_WORKSPACE_ENTITLEMENTS_CONFIG_PATHS", "").split(":"),
        "/workspace/nia-universal/config/workspace-entitlements.json",
        "/home/deploy/pearlos/config/workspace-entitlements.json",
    )
    if path.strip()
)
DEFAULT_BLAIR_USER_IDS = (
    "00000000-0000-0000-0003-000000000020",
    "00000000-0000-0000-0003-000000000011",
)
DEFAULT_BLAIR_EMAILS = ("blair@niaxp.com", "blairerickson@gmail.com")
PROTECTED_RUNTIME_PATHS = (
    STAGING_SOURCE_ROOT,
    "/opt/pearlos",
    "/home/deploy/pearlos",
    "/root/.openclaw",
)
FOLLOWUP_INTERVAL_S = max(60.0, float(os.getenv("PEARL_TASK_FOLLOWUP_INTERVAL_S", "600")))
FOLLOWUP_STATE_PATH = os.getenv(
    "PEARL_TASK_FOLLOWUP_STATE",
    "/workspace/nia-universal/.data/pearl-task-followups.json",
)


def _extract_simple_discord_send(task: dict) -> Optional[Tuple[str, str]]:
    """Return (channel_id, message) for tasks that are only Discord sends.

    This keeps round-trip smoke tests and simple "tell Discord X" tasks out of
    Claude's sandbox. Claude is useful for judgment work; it should not be the
    thing that reads bot tokens and performs a one-line Discord POST.
    """
    if os.getenv("PEARL_ENABLE_WORKER_DIRECT_DISCORD_SEND", "").strip().lower() != "true":
        return None
    if any(task.get(key) for key in ("requester_user_id", "requester_email", "requester_tenant_id")):
        return None

    command_text = str(task.get("title") or task.get("task") or "").strip()
    command_text = re.sub(
        r"^Discord request from [^\n]+ in channel \d+:\s*",
        "",
        command_text,
        flags=re.I,
    ).strip()
    if not re.match(r"^(send|post|message)\b", command_text, re.I):
        return None

    text = " ".join(
        str(task.get(k) or "") for k in ("title", "task")
    ).strip()
    if not text or not re.search(r"\bdiscord\b|\bchannel\b", text, re.I):
        return None
    if re.search(
        r"\b(research|analy[sz]e|investigate|report|recommendation|recommend|consult|compare|current web search|use current|produce|latency|architecture|options)\b",
        text,
        re.I,
    ):
        return None

    quoted = re.search(r'"([^"\n]{1,500})"', text)
    if quoted:
        message = quoted.group(1).strip()
    else:
        single = re.search(r"'([^'\n]{1,500})'", text)
        message = single.group(1).strip() if single else ""

    if not message:
        m = re.search(
            r"\b(?:send|post|message)\b(?:\s+a\s+single\s+message)?(?:\s+a\s+message)?(?:\s+saying)?\s+([A-Z][A-Za-z0-9 ,.!\-]{1,120})",
            text,
            re.I,
        )
        message = (m.group(1).strip(" .") if m else "")

    if not message:
        return None

    channel_match = re.search(r"\bchannel\s+(\d{10,})\b", text, re.I)
    if not channel_match:
        channel_match = re.search(r"\bDiscord source channel\s+(\d{10,})\b", text, re.I)
    channel_id = channel_match.group(1) if channel_match else DISCORD_STATUS_CHANNEL

    if not re.search(r"\b(send|post|message)\b", text, re.I):
        return None
    if len(message) > 500:
        return None
    return channel_id, message


def _safe_path_component(value: object, fallback: str = "unknown") -> str:
    raw = str(value or "").strip().lower()
    safe = "".join(ch if ch.isalnum() or ch in "._@+-" else "_" for ch in raw).strip("._-")
    return (safe or fallback)[:160]


def _env_list(name: str, defaults: tuple[str, ...] = ()) -> set[str]:
    configured = tuple(part.strip() for part in os.getenv(name, "").split(",") if part.strip())
    return {str(value).strip().lower() for value in (*configured, *defaults) if str(value).strip()}


def _path_inside(path: str, root: str) -> bool:
    resolved = os.path.abspath(path)
    resolved_root = os.path.abspath(root)
    return resolved == resolved_root or resolved.startswith(resolved_root + os.sep)


def _real_path_inside(path: str, root: str) -> bool:
    resolved = os.path.realpath(path)
    resolved_root = os.path.realpath(root)
    return resolved == resolved_root or resolved.startswith(resolved_root + os.sep)


def _assert_existing_parent_not_symlink(target: str) -> None:
    current = os.path.abspath(target)
    while not os.path.exists(current):
        parent = os.path.dirname(current)
        if parent == current:
            return
        current = parent
    if os.path.realpath(current) != os.path.abspath(current):
        raise ValueError(f"refusing symlinked task workspace parent: {target}")


def _workspace_entitlements_config() -> dict:
    for path in WORKSPACE_ENTITLEMENTS_CONFIG_PATHS:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            if isinstance(parsed, dict):
                return parsed
        except OSError:
            continue
        except Exception as e:
            log.warning("Could not read workspace entitlement config %s: %s", path, e)
    return {}


def _staging_source_edits_enabled() -> bool:
    env_value = os.getenv("PEARLOS_STAGING_SOURCE_EDITS_ENABLED", "").strip().lower()
    if env_value in ("1", "true", "yes", "on"):
        return True
    return _workspace_entitlements_config().get("stagingSourceEditsEnabled") is True


def _is_blair_task(task: dict) -> bool:
    user_id = str(task.get("requester_user_id") or "").strip().lower()
    email = str(task.get("requester_email") or "").strip().lower()
    return bool(
        (user_id and user_id in _env_list("PEARLOS_BLAIR_USER_IDS", DEFAULT_BLAIR_USER_IDS))
        or (email and email in _env_list("PEARLOS_BLAIR_EMAILS", DEFAULT_BLAIR_EMAILS))
    )


def _task_user_scope(task: dict) -> tuple[str, str]:
    tenant = _safe_path_component(task.get("requester_tenant_id"), "public")
    user = _safe_path_component(
        task.get("requester_user_id") or task.get("requester_email"),
        "anonymous",
    )
    return tenant, user


def _scoped_user_workspace_root(task: dict) -> str:
    tenant, user = _task_user_scope(task)
    return os.path.abspath(os.path.join(PUBLIC_TASK_ROOT, tenant, user))


def _fork_workspace_root(task: dict) -> str:
    return os.path.abspath(os.path.join(_scoped_user_workspace_root(task), "forks"))


def _maybe_clone_github_fork(path: str, github_fork_url: object) -> None:
    url = str(github_fork_url or "").strip()
    if not url or os.path.isdir(os.path.join(path, ".git")):
        return
    try:
        if os.listdir(path):
            return
    except OSError:
        return
    try:
        subprocess.run(
            ["git", "clone", url, path],
            check=True,
            timeout=120,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        log.info("Cloned GitHub fork workspace into %s", path)
    except Exception as e:
        log.warning("Could not clone GitHub fork %s into %s: %s", url, path, e)


def _task_workspace(task: dict) -> str:
    workspace_mode = str(task.get("workspace_mode") or "").strip()
    existing = task.get("workspace_path")
    requested_path = os.path.abspath(existing) if isinstance(existing, str) and existing.strip() else ""

    if workspace_mode == "staging_source":
        raise ValueError("personal_instance_only")

    if requested_path:
        path = requested_path
    else:
        tenant, user = _task_user_scope(task)
        task_id = _safe_path_component(task.get("id"), "task")
        path = os.path.abspath(os.path.join(PUBLIC_TASK_ROOT, tenant, user, task_id))

    root = os.path.abspath(PUBLIC_TASK_ROOT)
    if not _path_inside(path, root):
        raise ValueError(f"refusing task workspace outside {root}: {path}")
    scoped_root = _scoped_user_workspace_root(task)
    if workspace_mode == "github_fork":
        if not _path_inside(path, _fork_workspace_root(task)):
            raise ValueError(f"refusing fork workspace outside requester forks: {path}")
    elif task.get("requester_tenant_id") and (task.get("requester_user_id") or task.get("requester_email")):
        if not _path_inside(path, scoped_root):
            raise ValueError(f"refusing requester workspace outside requester scope: {path}")
    _assert_existing_parent_not_symlink(path)
    os.makedirs(path, exist_ok=True)
    if not _real_path_inside(path, root):
        raise ValueError(f"refusing symlinked task workspace outside {root}: {path}")
    if workspace_mode == "github_fork":
        _maybe_clone_github_fork(path, task.get("github_fork_url"))
    return path


def _is_public_workspace_task(task: dict) -> bool:
    workspace_mode = str(task.get("workspace_mode") or "").strip()
    if workspace_mode in ("staging_source", "internal_source"):
        return False
    if workspace_mode in ("sandbox", "github_fork"):
        return True
    if not (task.get("requester_tenant_id") and (task.get("requester_user_id") or task.get("requester_email"))):
        return False
    workspace = task.get("workspace_path")
    if not isinstance(workspace, str) or not workspace.strip():
        return False
    root = os.path.abspath(PUBLIC_TASK_ROOT)
    path = os.path.abspath(workspace)
    return _path_inside(path, root)


INTERFACE_CUSTOMIZATION_MANIFESTS = (
    "pearlos-ui-customization.json",
    "interface-customization.json",
    os.path.join(".pearlos", "interface-customization.json"),
)
PEARL_FEATURE_MANIFESTS = (
    "pearl-feature.json",
    os.path.join(".pearlos", "pearl-feature.json"),
)

# Recognized fields a personal UI manifest may carry. Anything outside this set
# is ignored by the apply route; the worker uses it to confirm the file is a
# real customization manifest rather than an unrelated JSON blob.
PERSONAL_MANIFEST_KNOWN_FIELDS = (
    "label",
    "prompt",
    "theme",
    "backgrounds",
    "icons",
    "style",
    "id",
    "shareEligible",
)
# Keys that signal an attempt to mutate core/shared PearlOS rather than just the
# requester's account. A manifest carrying any of these is rejected outright.
PERSONAL_MANIFEST_FORBIDDEN_FIELDS = (
    "core",
    "applyToCore",
    "global",
    "allUsers",
    "everyone",
    "corePath",
    "sourcePath",
    "globalPath",
    "targetPath",
    "deploy",
)
PERSONAL_FEATURE_KNOWN_FIELDS = (
    "schemaVersion",
    "id",
    "title",
    "summary",
    "extensionPoint",
    "entrypoint",
    "launchUrl",
    "desktopShortcut",
    "shareEligible",
    "permissions",
)
PERSONAL_FEATURE_EXTENSION_POINTS = ("desktop.shortcut", "agency.toolbar")


def _interface_base_url() -> str:
    return (
        os.getenv("PEARL_INTERFACE_BASE_URL")
        or os.getenv("NEXT_PUBLIC_INTERFACE_URL")
        or "http://localhost:3000"
    ).rstrip("/")


def _validate_personal_manifest(manifest: object) -> tuple[bool, str]:
    """Defense-in-depth check on a personal UI manifest before applying it.

    The apply route sanitizes field-by-field, but the worker refuses up front
    when the manifest is shaped to escape the requester's account (global /
    core / deploy mutation) or carries nothing the apply route can use.
    Returns (ok, reason).
    """
    if not isinstance(manifest, dict):
        return False, "manifest is not a JSON object"
    forbidden = [key for key in manifest.keys() if str(key) in PERSONAL_MANIFEST_FORBIDDEN_FIELDS]
    if forbidden:
        return (
            False,
            "manifest tries to change shared PearlOS, not just this account "
            f"(disallowed fields: {', '.join(sorted(forbidden))})",
        )
    if not any(str(key) in PERSONAL_MANIFEST_KNOWN_FIELDS for key in manifest.keys()):
        return False, "manifest has no recognized PearlOS customization fields"
    return True, ""


def _manifest_share_eligible(manifest: object) -> bool:
    return isinstance(manifest, dict) and manifest.get("shareEligible") is True


def _find_interface_customization_manifest(workspace: str) -> tuple[str, Optional[dict]]:
    for rel in INTERFACE_CUSTOMIZATION_MANIFESTS:
        path = os.path.join(workspace, rel)
        try:
            if not os.path.isfile(path):
                continue
            if os.path.getsize(path) > 128_000:
                return path, None
            with open(path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            return path, parsed if isinstance(parsed, dict) else None
        except Exception as e:
            log.warning("Could not read interface customization manifest %s: %s", path, e)
            return path, None
    return "", None


def _find_pearl_feature_manifest(workspace: str) -> tuple[str, Optional[dict]]:
    for rel in PEARL_FEATURE_MANIFESTS:
        path = os.path.join(workspace, rel)
        try:
            if not os.path.isfile(path):
                continue
            if os.path.getsize(path) > 128_000:
                return path, None
            with open(path, "r", encoding="utf-8") as handle:
                parsed = json.load(handle)
            return path, parsed if isinstance(parsed, dict) else None
        except Exception as e:
            log.warning("Could not read PearlOS feature manifest %s: %s", path, e)
            return path, None
    return "", None


def _validate_pearl_feature_manifest(manifest: object) -> tuple[bool, str]:
    if not isinstance(manifest, dict):
        return False, "manifest is not a JSON object"
    forbidden = [key for key in manifest.keys() if str(key) in PERSONAL_MANIFEST_FORBIDDEN_FIELDS]
    if forbidden:
        return (
            False,
            "feature manifest tries to change shared PearlOS, not just this account "
            f"(disallowed fields: {', '.join(sorted(forbidden))})",
        )
    if not any(str(key) in PERSONAL_FEATURE_KNOWN_FIELDS for key in manifest.keys()):
        return False, "manifest has no recognized PearlOS feature fields"
    title = str(manifest.get("title") or "").strip()
    if not title:
        return False, "feature manifest is missing title"
    extension = str(manifest.get("extensionPoint") or "desktop.shortcut").strip()
    if extension and extension not in PERSONAL_FEATURE_EXTENSION_POINTS:
        return False, f"unsupported extensionPoint: {extension}"
    entrypoint = str(manifest.get("entrypoint") or "index.html").strip().replace("\\", "/")
    if entrypoint.startswith("/") or "://" in entrypoint or ".." in entrypoint.split("/"):
        return False, "entrypoint must be a relative file path inside the task workspace"
    launch_url = str(manifest.get("launchUrl") or "").strip()
    if launch_url and not launch_url.startswith("/api/creation/"):
        return False, "launchUrl must be a same-origin /api/creation/ URL"
    return True, ""


def _creation_launch_url_from_workspace(workspace: str) -> str:
    normalized = os.path.abspath(workspace).replace("\\", "/")
    parts = [part for part in normalized.split("/") if part]
    if "creations" not in parts:
        return ""
    idx = len(parts) - 1 - list(reversed(parts)).index("creations")
    if idx + 1 >= len(parts):
        return ""
    creation_id = _safe_path_component(parts[idx + 1], "")
    return f"/api/creation/{creation_id}/" if creation_id else ""


def _install_pearl_feature_package_if_present(task: dict, workspace: str) -> tuple[bool, bool, str]:
    """Install a safe per-user PearlOS feature package, if the task wrote one.

    Returns (found, ok, message).
    """
    manifest_path, manifest = _find_pearl_feature_manifest(workspace)
    if not manifest_path:
        return False, True, ""
    if not manifest:
        return True, False, f"PearlOS feature package exists but is not a valid JSON object: {manifest_path}"

    manifest_ok, manifest_reason = _validate_pearl_feature_manifest(manifest)
    if not manifest_ok:
        return True, False, f"PearlOS feature package rejected: {manifest_reason} ({manifest_path})"

    secret = _load_task_secret()
    if not secret:
        return True, False, "PearlOS feature package found, but no bot control secret is configured."

    title = str(manifest.get("title") or task.get("title") or task.get("task") or "PearlOS feature").strip()
    launch_url = str(manifest.get("launchUrl") or "").strip() or _creation_launch_url_from_workspace(workspace)
    base_url = _interface_base_url()
    payload = {
        "requester_user_id": task.get("requester_user_id") or "",
        "requester_email": task.get("requester_email") or "",
        "requester_tenant_id": task.get("requester_tenant_id") or "",
        "ledgerItemId": _ledger_item_id(task, "feature_package"),
        "featureId": manifest.get("id") or _ledger_item_id(task, "feature"),
        "title": title,
        "summary": manifest.get("summary") or "",
        "manifest": manifest,
        "artifactPath": workspace,
        "launchUrl": launch_url,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/personal-features/install",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Bot-Secret": secret,
            "Authorization": f"Bearer {secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
            if resp.status >= 400:
                return True, False, f"PearlOS feature package install failed with HTTP {resp.status}: {body[:500]}"
            parsed = json.loads(body) if body else {}
            if not parsed.get("ok"):
                return True, False, f"PearlOS feature package install returned an unsuccessful response: {body[:500]}"
            return (
                True,
                True,
                f"Installed {title} as a personal PearlOS feature package in Studio."
                + (f" Launch URL: {launch_url}" if launch_url else ""),
            )
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace") if e.fp else ""
        return True, False, f"PearlOS feature package install failed with HTTP {e.code}: {detail[:500]}"
    except Exception as e:
        return True, False, f"PearlOS feature package install failed: {e}"


def _publish_interface_customization_if_present(task: dict, workspace: str) -> tuple[bool, bool, str]:
    """Publish a safe per-user UI customization manifest, if the task wrote one.

    Returns (found, ok, message).
    """
    manifest_path, manifest = _find_interface_customization_manifest(workspace)
    if not manifest_path:
        return False, True, ""
    if not manifest:
        return True, False, f"Interface customization manifest exists but is not valid JSON object: {manifest_path}"

    manifest_ok, manifest_reason = _validate_personal_manifest(manifest)
    if not manifest_ok:
        return True, False, f"Interface customization manifest rejected: {manifest_reason} ({manifest_path})"

    secret = _load_task_secret()
    if not secret:
        return True, False, "Interface customization manifest found, but no bot control secret is configured."

    base_url = _interface_base_url()
    payload = {
        "requester_user_id": task.get("requester_user_id") or "",
        "requester_email": task.get("requester_email") or "",
        "requester_tenant_id": task.get("requester_tenant_id") or "",
        "title": task.get("title") or task.get("task") or "PearlOS customization",
        "manifest": manifest,
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/interface-customization/apply",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Bot-Secret": secret,
            "Authorization": f"Bearer {secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
            if resp.status >= 400:
                return True, False, f"Interface customization apply failed with HTTP {resp.status}: {body[:500]}"
            parsed = json.loads(body) if body else {}
            if not parsed.get("ok"):
                return True, False, f"Interface customization apply returned an unsuccessful response: {body[:500]}"
            email = str(task.get("requester_email") or "").strip()
            actor_label = email or str(task.get("requester_user_id") or "").strip() or "this user"
            return (
                True,
                True,
                "Applied the PearlOS UI customization live to this user's account. "
                f"To fold it into core PearlOS later, say: incorporate the changes made by {actor_label}.",
            )
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace") if e.fp else ""
        return True, False, f"Interface customization apply failed with HTTP {e.code}: {detail[:500]}"
    except Exception as e:
        return True, False, f"Interface customization apply failed: {e}"


# Files that are scaffolding/notes, not the personal change itself. Used when
# deciding whether a non-manifest task actually produced reviewable artifacts.
LEDGER_IGNORED_ARTIFACT_NAMES = {
    *(os.path.basename(rel) for rel in INTERFACE_CUSTOMIZATION_MANIFESTS),
    *(os.path.basename(rel) for rel in PEARL_FEATURE_MANIFESTS),
    "interface-customization.json",
    "pearl-feature.json",
    ".ds_store",
    "thumbs.db",
}
LEDGER_IGNORED_ARTIFACT_DIRS = {".git", "node_modules", "__pycache__", ".pearlos"}
CODE_ARTIFACT_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".sh", ".css", ".scss",
    ".html", ".json", ".vue", ".svelte", ".go", ".rs", ".rb", ".java", ".sql",
}


def _ledger_item_id(task: dict, kind: str) -> str:
    base = _safe_path_component(task.get("id"), "task")
    return f"{base}-{kind}"[:96]


def _detect_personal_code_artifacts(workspace: str, limit: int = 25) -> list[str]:
    """Return workspace-relative paths of code/content files the task produced.

    A personal manifest is applied live; anything else a public task leaves in
    its workspace is a reviewable personal change artifact, not something the
    worker should try to push into shared source. We surface those paths so the
    ledger can record them for later human review.
    """
    artifacts: list[str] = []
    if not workspace or not os.path.isdir(workspace):
        return artifacts
    for root, dirs, files in os.walk(workspace):
        dirs[:] = [d for d in dirs if d not in LEDGER_IGNORED_ARTIFACT_DIRS]
        for name in files:
            if name.lower() in LEDGER_IGNORED_ARTIFACT_NAMES:
                continue
            ext = os.path.splitext(name)[1].lower()
            if ext and ext not in CODE_ARTIFACT_EXTENSIONS:
                continue
            rel = os.path.relpath(os.path.join(root, name), workspace)
            artifacts.append(rel)
            if len(artifacts) >= limit:
                return sorted(artifacts)
    return sorted(artifacts)


def _record_studio_ledger_item(
    task: dict,
    *,
    item_id: str,
    kind: str,
    status: str,
    summary: str,
    artifact_path: str,
    share_eligible: bool,
) -> tuple[bool, str]:
    """Upsert the requester's Studio ledger item for a personal change.

    Account-local only: the ledger lives on the requester's PearlOS profile.
    Returns (ok, message).
    """
    if not (task.get("requester_user_id") or task.get("requester_email")):
        return False, "no requester identity on task; skipping Studio ledger update"
    secret = _load_task_secret()
    if not secret:
        return False, "no bot control secret configured; skipping Studio ledger update"
    payload = {
        "requester_user_id": task.get("requester_user_id") or "",
        "requester_email": task.get("requester_email") or "",
        "requester_tenant_id": task.get("requester_tenant_id") or "",
        "item": {
            "id": item_id,
            "title": _task_title(task),
            "kind": kind,
            "status": status,
            "summary": summary[:1200],
            "artifactPath": artifact_path[:400],
            "shareEligible": bool(share_eligible),
        },
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{_interface_base_url()}/api/interface-customization/ledger",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Bot-Secret": secret,
            "Authorization": f"Bearer {secret}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", "replace")
            if resp.status >= 400:
                return False, f"Studio ledger update failed with HTTP {resp.status}: {body[:300]}"
            parsed = json.loads(body) if body else {}
            if not parsed.get("ok"):
                return False, f"Studio ledger update returned an unsuccessful response: {body[:300]}"
            return True, "Recorded this change in the requester's Studio ledger."
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace") if e.fp else ""
        return False, f"Studio ledger update failed with HTTP {e.code}: {detail[:300]}"
    except Exception as e:
        return False, f"Studio ledger update failed: {e}"


def _public_workspace_guard(task: dict) -> str:
    workspace = _task_workspace(task)
    mode = str(task.get("workspace_mode") or "sandbox").strip() or "sandbox"
    isolation_notice = str(task.get("workspace_isolation_notice") or "").strip()
    notice_line = f"Entitlement note: {isolation_notice}\n" if isolation_notice else ""
    fork_url = str(task.get("github_fork_url") or "").strip()
    fork_line = (
        f"GitHub fork URL: {fork_url}\nIf the workspace is not already a checkout, clone or fetch this fork before editing.\n"
        if mode == "github_fork" and fork_url
        else ""
    )
    return (
        "========== PUBLIC USER TASK ISOLATION RULES ==========\n"
        f"Workspace mode: {mode}\n"
        f"Allowed workspace: {workspace}\n"
        f"{notice_line}"
        f"{fork_line}"
        "Work only inside the allowed workspace unless the task is read-only public web research.\n"
        "Do not edit, delete, move, or chmod PearlOS source, deploy, runtime, OpenClaw config, or production files.\n"
        "Forbidden paths include: " + ", ".join(PROTECTED_RUNTIME_PATHS) + "\n"
        "If the user asks to customize PearlOS appearance, make it live for their account by writing a safe UI manifest named pearlos-ui-customization.json in the allowed workspace.\n"
        "When that manifest is applied, report it as an account-local PearlOS customization and tell Blair he can later say: incorporate the changes made by <requester email>.\n"
        "Manifest fields may include: label, prompt, theme (pixel/glass/professional/calm), backgrounds, icons, and style.\n"
        "Only use Pearl CSS variables in style, for example --pearl-panel-bg, --pearl-panel-muted-bg, --pearl-text, --pearl-muted, --pearl-accent, --pearl-window-content-bg, --pearl-panel-border.\n"
        "Do not add fields that target other accounts, core, global, all users, deploy, or any path; the manifest applies only to this requester's account.\n"
        "For non-appearance feature work, write the code/content into the allowed workspace; it is recorded as a reviewable personal change artifact on this account, not pushed into shared PearlOS.\n"
        "For requested documents, reports, notes, and files, save the finished file inside the allowed workspace and mention the exact filename in the final result so the task system can copy safe outputs into the requester's PearlOS Documents.\n"
        "Do not rely on a source patch alone for regular users; a sandbox patch is not live until a manifest is applied.\n"
        "Do not stop with a generic workspace-isolation failure when a sandboxed customization or fork patch can satisfy the request.\n"
        "Pearl changes only the requester's PearlOS instance; core PearlOS integration is managed separately.\n"
        "If the task requires changing app.pearlos.org or PearlOS production, stop and report that operator approval is required.\n"
        "Keep all generated files, notes, databases, audits, and outputs for this task inside the allowed workspace.\n"
        "======================================================\n"
    )


def _worker_cwd(task: dict) -> str:
    workspace_mode = str(task.get("workspace_mode") or "").strip()
    if workspace_mode == "staging_source" or _is_public_workspace_task(task):
        return _task_workspace(task)
    return os.getenv("PEARL_WORKER_CWD", "/workspace/nia-universal")


def _should_reconcile_clean_exit(latest: dict, worker_assignee: str) -> bool:
    """Return true when a clean subprocess exit should write completion.

    Normal state is ``in_progress``. A UI race can briefly flip a running task
    back to executable ``pending`` after the worker has already claimed it; that
    must not cause the clean result to be dropped. Paused/stopped tasks are
    parked on a non-worker assignee, so those remain protected.
    """
    status = str(latest.get("status") or "")
    if status == "in_progress":
        return True
    if status == "pending" and str(latest.get("assignee") or "") == worker_assignee:
        return True
    return False


# ---------------------------------------------------------------------------
# Executor: Claude subprocess
# ---------------------------------------------------------------------------
SOURCE_OF_TRUTH_NOTICE = """
========== CRITICAL: SOURCE OF TRUTH RULE (READ BEFORE ANY EDIT) ==========
The source of truth for the PearlOS app is /workspace/nia-universal. Period.
On DigitalOcean staging, /home/deploy/pearlos is a DEPLOY TARGET only, it is rebuilt from source.
On older RunPod/prod contexts, /opt/pearlos may be the deploy target. Verify host and PM2 cwd before acting.

RULES (no exceptions):
- NEVER edit a .ts, .tsx, .js, .py, .sh file inside a deploy target directly.
- ALWAYS edit /workspace/nia-universal/<path>, then copy forward to
  the verified deploy target with `cp` so the running app picks it up.
- Build .next from /workspace/nia-universal source, never from /opt/pearlos.
- If you find yourself opening a file at /home/deploy/pearlos or /opt/pearlos for editing, STOP and
  open the same path under /workspace/nia-universal instead.
- Verify the file exists in BOTH locations before declaring the task done.

WHY: On 2026-04-30 four agents wrote AgencyChatBox/ChatMode changes only to
/opt/pearlos. The next rebuild copied the OLD versions back from
/workspace/nia-universal and silently overwrote the deploy. The running site
looked frozen even though the deploy "had" the new files. Don't repeat this.

If you detect drift, sync deploy-only edits back to source before rebuilding.
================================================================

========== DISCORD POSTING RULES (CRITICAL FOR USER EXPERIENCE) ==========
When you post status updates to Discord (#blair-lagoon or any user channel):

NEVER NARRATE PROCESS. The following are BANNED:
- "Picking up the broken X now."
- "I'm starting in the frontend Y."
- "Let me check / look / verify / pull / grab / find"
- "I'll check / look / see / dig / fire"
- "First I'll ... then I'll ..."
- "One moment / hang on / give me a sec"
- Any sentence describing what you are ABOUT to do

Pearl's Agency Discord posts should ONLY happen at THREE moments:
  1. Task FINAL completion: 4-5 sentence plain-English summary of what
     was done, what worked, what didn't, what happens next.
  2. Genuine BLOCKER that needs Blair's judgment.
  3. CRITICAL question that can't proceed without an answer.

Do NOT post:
- "Picking up task X now" pickup announcements (the worker auto-posts these)
- Mid-flight progress unless something material changed
- Anything starting with "Let me" or "I'm starting" or "I'll"

If you're tempted to post "I'm starting on Y", DON'T POST. Just do the work
and post the final summary when done.

Exception: the worker has a task watchdog that may post a plain-English
"still running" follow-up every 10 minutes for long tasks. Treat that as
the minimum heartbeat for the user, not permission to spam process narration.
================================================================

========== AGENCY TASK OUTPUT RULES (CRITICAL FOR USER EXPERIENCE) ==========
Task IDs, run IDs, dispatch IDs, hashes, and any other system-generated identifiers
are internal only. They must NEVER be shown or spoken to the user.

When reporting task results, describe what the task did in plain language only.
Keep it natural and conversational, with no IDs, no hashes, no run references,
and no other internal identifiers.
================================================================
"""


DELIVERY_CONTRACT_NOTICE = """
========== DELIVERABLE DELIVERY CONTRACT ==========
When the user asks for a report, document, Note, file, direct link, or delivery
in a channel, the task is not complete until that artifact is accessible to the
user in the requested surface.

- For PearlOS Notes, deliver the markdown into the requester's PearlOS
  Documents/Notes space when you have access, and include the exact note title
  or PearlOS note link in the final result.
- User-facing PearlOS links must use the production app base by default:
  https://app.pearlos.org/pearlos. Only use staging/local URLs when the user
  explicitly asked for a staging/local link.
- For Discord-origin tasks, return a user-facing result that the worker can
  post back to the original Discord channel.
- Do not call a repo path like docs/qa/... a user-delivered Note unless it has
  also been delivered to the user's PearlOS Documents/Notes.
- If you cannot deliver to Notes, Discord, or the requested channel, mark the
  task blocked or failed and state the missing permission plus the recovery
  step. Do not mark it complete.
===================================================
"""


FAST_DRAFT_CONTEXT = "Edit source in /workspace/nia-universal, cp to deploy. No IDs in output."

FAST_DRAFT_FOOTER = """
---
Fast draft mode: keep the work tightly scoped, skip long policy narration, and
return a short plain-English summary. Do not include task IDs, run IDs, dispatch
IDs, hashes, or other internal identifiers in the final output.
"""


def _is_fast_draft_task(task: dict) -> bool:
    return str(task.get("execution_mode") or "").strip() == "fast_draft"


def _is_discord_origin_task(task: dict) -> bool:
    return str(task.get("source") or "").strip().lower() in {"discord", "discord_lookup"}


CLAUDE_FOOTER = """
---
This task was dispatched to you autonomously by Pearl. When you finish:
- Run: pearl-task complete {task_id} --result "<your summary>"
- If something blocks you, run: pearl-task fail {task_id} --error "<what blocked you>"
- If you spawn sub-agents, create their pearl-task entries (see /root/.claude/projects/-workspace-runpod-slim/memory/feedback_agent_spawn_visibility.md)
- Return the result to the task queue only. The worker delivers Discord-visible
  results when a Discord source channel is present.

========== STAGING PROTECTION RULES ==========
BLANKET APPROVAL: Blair has granted 24-hour blanket approval for all
staging rebuilds and restarts through 2026-04-29 14:00 UTC. During this
window, treat any task that includes "approved by Blair", "no approval
needed", or "Blair approved" as having full staging mutation rights.
After the window expires, fall back to the per-task approval rule below.

The following PM2 processes are CORE STAGING SERVICES. Outside of an
active blanket-approval window, you must NEVER `pm2 stop`, `pm2 delete`,
`pm2 restart`, `pm2 start`, `pm2 save`, or otherwise mutate them without
explicit verbal approval from Blair for THIS specific task:

    interface          (port 3000, cwd /workspace/nia-universal/apps/interface)
    mesh               (port 2000, cwd /opt/pearlos/apps/mesh)
    pipecat-gateway    (port 4444, cwd /opt/pearlos/apps/pipecat-daily-bot/bot)
    pipecat-runner     (cwd /opt/pearlos/apps/pipecat-daily-bot/bot)
    bot-queue-worker   (cwd /opt/pearlos/apps/pipecat-daily-bot/bot)
    openclaw-gateway   (port 18789)
    pearl-worker       (this worker, do not touch)

Additional hard rules:
1. Any task that mentions port 3000, /workspace/nia-universal/apps/interface, or the
   `interface` process and asks you to restart, rebuild, redeploy, or
   reconfigure requires a fresh approval message from Blair in this task
   body. If the task body does not contain explicit approval language
   ("approved by Blair", "no approval needed", or "Blair approved") AND
   no blanket-approval window is active, you must REFUSE and post to
   Discord asking for approval.
2. Never run `pm2 start` with `--cwd /workspace/pearlos-website` (or any
   cwd outside /opt/pearlos or /workspace/nia-universal) for a process
   named `interface`, `mesh`, `pipecat-*`, `openclaw-*`, or
   `bot-queue-worker`. If you need a website dev server, use a different
   PM2 process name (e.g. `pearlos-website-dev`) on a DIFFERENT port
   (NOT 3000).
3. Never overwrite the interface build from a copied runtime tree. The
   PearlOS interface build MUST come from /workspace/nia-universal/apps/interface sources.
4. Website tasks (pearlos-website, pearlos.org, thoughts posts) operate
   ONLY in /workspace/pearlos-website. They must NEVER touch
   /workspace/nia-universal/apps/interface or the `interface` PM2 process.
5. If you detect that staging has already drifted (interface cwd is
   wrong, port 3000 serving the wrong app), STOP, post a Discord alert,
   and ask for human intervention. Do not try to "fix" it by further
   mutating PM2 state.

If the task you were given appears to require violating these rules,
the correct response is: post to Discord explaining the conflict, then
call `pearl-task fail {task_id} --error "refused: core PearlOS integration is managed separately"`.
================================================================

========== DISCORD COMMUNICATION STANDARD (MANDATORY) ==========
All Discord status/update messages you post MUST be written in plain
natural language that a smart, non-technical reader can understand at a
glance. Write like you're briefing a busy founder, not dumping logs.

Rules:
1. Hard limit: 4-5 sentences. If it's longer, you're doing it wrong.
2. Cover these beats, in order, as flowing prose (not a checklist):
     - what the task was (in everyday words)
     - what you found or did
     - what worked
     - what didn't (if anything)
     - what happens next
3. NO raw logs, stack traces, or error codes pasted in without a
   plain-English explanation of what they mean for Blair.
4. NO unexplained jargon. "rc=124" means "it timed out". "401 from the API"
   means "Discord rejected our login". "uvicorn" means "the gateway". Translate
   every technical term the first time it appears.
5. NO scrambled fragments or bullet dumps. Write real sentences.
6. Always start with the literal prefix: "Pearl's Agency says: "

Good example:
  "Pearl's Agency says: I looked into why the voice pipeline keeps cutting
  out after 30 seconds. The cause is a keepalive setting on the gateway
  that closes idle audio sockets too aggressively. I bumped it from 30s
  to 5 minutes and voice now stays connected through long pauses. Nothing
  regressed in the smoke tests. Next step is to leave it running overnight
  and check the morning logs for any new disconnects."

Bad example (do not do this):
  "Pearl's Agency says: fixed ws idle timeout. uvicorn.config.keepalive_timeout
  30→300. smoke_test.py ✅ rc=0. TODO: monitor."

This standard applies to EVERY Discord post you make for this task,
pickup notices, progress updates, final summary, failure reports. If you
are about to send a message that breaks these rules, stop and rewrite it.
================================================================

========== TASK ID SUPPRESSION (MANDATORY) ==========
Task IDs, run IDs, dispatch IDs, hashes, and any other system-generated identifiers
must NEVER be shown or spoken to the user, not in Discord posts, not in
task result summaries, not anywhere user-visible. When reporting task
results, describe what the task did in plain language only, no IDs, no
hashes, and no run references. Keep it natural and conversational.

The task ID below is for your internal use with pearl-task commands ONLY.
================================================================

Task ID: {task_id}
"""

CLAUDE_LOOKUP_FOOTER = """
---
This is a Discord lookup-answer task. Blair asked for a factual answer,
recommendation, source list, current capability check, or similar information
that should be verified instead of guessed.

When you finish:
- Run: pearl-task complete {task_id} --result "<your concise sourced answer>"
- Return the result to the task queue only. The worker delivers Discord-visible
  results when a Discord source channel is present.
- Write in Pearl's voice. Do not prefix the message with "Pearl's Agency says:".
- Do not mention the Agency, Claude CLI, workers, task IDs, or process unless
  Blair explicitly asks how the answer was obtained.
- If current sources are needed, use web search. If sources conflict or are
  thin, say that plainly and include the best links you found.
- NEVER include task IDs, run IDs, dispatch IDs, hashes, or any other
  system-generated identifiers in your response. They must never be shown or
  spoken to the user. Describe results in plain language only, with no IDs, no
  hashes, and no run references.

Keep it short, useful, and concrete. No em dashes.

Task ID: {task_id}
"""

CODEX_FOOTER = """
---
This task was dispatched to you autonomously by Pearl. You are the Agency Boss
for this run.

Production access:
- You may work on PearlOS production only when Blair explicitly asks for
  production, app.pearlos.org, or the pearlos-production host in this task.
- If production is not explicitly named, stay on DigitalOcean staging.
- When production is explicitly requested from the staging droplet, use the
  approved production SSH configuration available on that host.
- For production work, verify the host and PM2 cwd before changing anything,
  keep changes scoped, and do not touch production OAuth or databases unless
  Blair specifically requested that exact subsystem.

When you finish:
- Return a concise final summary as your final answer. The worker will write it
  back to the PearlOS task queue.
- If you made code/config/file changes, include the changed file paths and what
  verification you ran.
- If something blocks you, say exactly what blocked you in the final answer.
- Do not expose task IDs, run IDs, dispatch IDs, hashes, or any other
  system-generated identifiers in any user-facing summary. They must never be
  shown or spoken to the user.
- Describe task results in plain language only, with no IDs, no hashes, and no
  run references.
- Do not mention Codex, Claude CLI, workers, or process unless Blair explicitly
  asks how the answer was obtained.
- Use the source/deploy rules above. Edit /workspace/nia-universal first, then
  copy changed source files forward to the verified deploy target when runtime
  pickup is required.

Keep the final answer short, useful, and concrete. No em dashes.

Internal task ID for worker reconciliation only: {task_id}
"""

CODEX_LOOKUP_FOOTER = """
---
This is a lookup-answer task. Blair asked for a factual answer,
recommendation, source list, current capability check, or similar information
that should be verified instead of guessed.

When you finish:
- Return the concise sourced answer as your final answer. The worker will write
  it back to the PearlOS task queue.
- If current sources are needed, use web search when available. If sources
  conflict or are thin, say that plainly and include the best links you found.
- Do not mention Codex, Claude CLI, workers, task IDs, or process unless Blair
  explicitly asks how the answer was obtained.
- NEVER include task IDs, run IDs, dispatch IDs, hashes, or any other
  system-generated identifiers in your response. They must never be shown or
  spoken to the user. Describe results in plain language only, with no IDs, no
  hashes, and no run references.

Keep it short, useful, and concrete. No em dashes.

Internal task ID for worker reconciliation only: {task_id}
"""


def _build_claude_prompt(task: dict) -> str:
    task_body = (task.get("task") or "").strip()
    if _is_fast_draft_task(task):
        guard = f"{_public_workspace_guard(task)}\n" if _is_public_workspace_task(task) else ""
        return f"{guard}{FAST_DRAFT_CONTEXT}\n\n{task_body}\n{FAST_DRAFT_FOOTER}"
    task_id = task.get("id", "unknown")
    footer_template = CLAUDE_LOOKUP_FOOTER if task.get("source") == "discord_lookup" else CLAUDE_FOOTER
    footer = footer_template.format(
        task_id=task_id,
        discord_channel=_task_notice_channel(task),
    )
    # SOURCE_OF_TRUTH_NOTICE is prepended to every dispatched prompt so the
    # spawned Claude CLI session sees the rule before reading the task body.
    # See: 2026-04-30 AgencyChatBox/ChatMode regression where four agents
    # edited /opt/pearlos directly and the next rebuild from
    # /workspace/nia-universal silently reverted their work.
    guard = f"{_public_workspace_guard(task)}\n" if _is_public_workspace_task(task) else ""
    return f"{guard}{SOURCE_OF_TRUTH_NOTICE}\n{DELIVERY_CONTRACT_NOTICE}\n{task_body}\n{footer}"


def _build_codex_prompt(task: dict) -> str:
    task_body = (task.get("task") or "").strip()
    if _is_fast_draft_task(task):
        guard = f"{_public_workspace_guard(task)}\n" if _is_public_workspace_task(task) else ""
        return f"{guard}{FAST_DRAFT_CONTEXT}\n\n{task_body}\n{FAST_DRAFT_FOOTER}"
    task_id = task.get("id", "unknown")
    footer_template = CODEX_LOOKUP_FOOTER if task.get("source") == "discord_lookup" else CODEX_FOOTER
    footer = footer_template.format(task_id=task_id)
    guard = f"{_public_workspace_guard(task)}\n" if _is_public_workspace_task(task) else ""
    return f"{guard}{SOURCE_OF_TRUTH_NOTICE}\n{DELIVERY_CONTRACT_NOTICE}\n{task_body}\n{footer}"


def _spawn_claude(task: dict, timeout_s: float, worker_id: str) -> "subprocess.Popen[str]":
    """Spawn a claude --print subprocess for a task. Returns the Popen handle."""
    prompt = _build_claude_prompt(task)
    claude_bin = os.getenv("PEARL_CLAUDE_BIN", "/usr/local/bin/claude")
    allowed_tools = os.getenv(
        "PEARL_CLAUDE_ALLOWED_TOOLS",
        "Bash,Read,Edit,Write,Glob,Grep,LS,MultiEdit,WebFetch,WebSearch",
    )
    cmd = [
        claude_bin,
        "--permission-mode", "dontAsk",
        "--allowedTools", allowed_tools,
        "--print",
    ]
    env = os.environ.copy()
    # Use a temp HOME-like dir so the subprocess doesn't write to ~/.claude state
    # while the worker is also running. Claude still uses its global config;
    # we just isolate the session-level temp files.
    tmp_dir = tempfile.mkdtemp(prefix="pw-claude-")
    env["TMPDIR"] = tmp_dir

    worker_cwd = _worker_cwd(task)
    if not os.path.isdir(worker_cwd):
        worker_cwd = os.getcwd()

    log.info(
        "Spawning Claude for task %s (timeout=%.0fs cwd=%s)",
        task.get("id"),
        timeout_s,
        worker_cwd,
    )
    stdout_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    stderr_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=stdout_file,
        stderr=stderr_file,
        text=True,
        cwd=worker_cwd,
        env=env,
    )
    proc._pearl_stdout_file = stdout_file  # type: ignore[attr-defined]
    proc._pearl_stderr_file = stderr_file  # type: ignore[attr-defined]
    proc._pearl_tmp_dir = tmp_dir  # type: ignore[attr-defined]
    if proc.stdin:
        try:
            proc.stdin.write(prompt)
            proc.stdin.close()
        except BrokenPipeError:
            pass
    return proc


def _spawn_codex(task: dict, timeout_s: float, worker_id: str) -> "subprocess.Popen[str]":
    """Spawn a codex exec subprocess for a task. Returns the Popen handle."""
    prompt = _build_codex_prompt(task)
    codex_bin = os.getenv("PEARL_CODEX_BIN", "/usr/bin/codex")
    sandbox = os.getenv("PEARL_CODEX_SANDBOX", "workspace-write")
    model = os.getenv("PEARL_CODEX_MODEL", "gpt-5.5").strip() or "gpt-5.5"
    profile = os.getenv("PEARL_CODEX_PROFILE", "").strip()
    extra_args = [
        arg for arg in os.getenv("PEARL_CODEX_EXTRA_ARGS", "--skip-git-repo-check").split(" ")
        if arg.strip()
    ]

    worker_cwd = _worker_cwd(task)
    if not os.path.isdir(worker_cwd):
        worker_cwd = os.getcwd()

    cmd = [
        codex_bin,
        "exec",
        "-C",
        worker_cwd,
        "--sandbox",
        sandbox,
        "-",
    ]
    if model:
        cmd[2:2] = ["--model", model]
    if profile:
        cmd[2:2] = ["--profile", profile]
    if extra_args:
        cmd[2:2] = extra_args
    # Fast draft: skip reasoning flag (not supported on Codex CLI v0.128.0).
    # The stripped policy prompt + no retries already delivers the speed gain.

    env = os.environ.copy()
    tmp_dir = tempfile.mkdtemp(prefix="pw-codex-")
    env["TMPDIR"] = tmp_dir

    log.info(
        "Spawning Codex for task %s (timeout=%.0fs cwd=%s)",
        task.get("id"),
        timeout_s,
        worker_cwd,
    )
    stdout_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    stderr_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=stdout_file,
        stderr=stderr_file,
        text=True,
        cwd=worker_cwd,
        env=env,
    )
    proc._pearl_stdout_file = stdout_file  # type: ignore[attr-defined]
    proc._pearl_stderr_file = stderr_file  # type: ignore[attr-defined]
    proc._pearl_tmp_dir = tmp_dir  # type: ignore[attr-defined]
    if proc.stdin:
        try:
            proc.stdin.write(prompt)
            proc.stdin.close()
        except BrokenPipeError:
            pass
    return proc


# ---------------------------------------------------------------------------
# In-flight task tracker (concurrent subprocess management)
# ---------------------------------------------------------------------------
class InFlightTask:
    def __init__(
        self,
        task: dict,
        proc: "subprocess.Popen[str]",
        started_at: float,
        timeout_s: float,
        executor: Optional[str],
    ):
        self.task = task
        self.proc = proc
        self.started_at = started_at
        self.timeout_s = timeout_s
        self.executor = executor
        self.last_commentary_at = 0.0

    @property
    def task_id(self) -> str:
        return self.task.get("id", "?")

    def is_timed_out(self) -> bool:
        return time.monotonic() - self.started_at > self.timeout_s

    def poll(self) -> Optional[int]:
        return self.proc.poll()


def _task_text_for_notice(task: dict, limit: int = 220) -> str:
    raw = task.get("title") or task.get("task") or "the background task"
    text = re.sub(r"\s+", " ", str(raw)).strip()
    text = re.sub(r"\bdisp-[a-f0-9]{8,}\b", "this task", text, flags=re.I)
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "\u2026"
    return text or "the background task"


def _task_source_discord_channel(task: dict) -> str:
    if not _is_discord_origin_task(task):
        return ""
    for key in ("discord_channel", "discord_channel_id", "channel_id", "channelId"):
        value = task.get(key)
        if value and re.fullmatch(r"\d{10,}", str(value)):
            return str(value)
    task_text = str(task.get("task") or "")
    match = re.search(r"\bin channel\s+(\d{10,})\b", task_text, re.I)
    if not match:
        match = re.search(r"\bDiscord source channel\s+(\d{10,})\b", task_text, re.I)
    if match:
        return match.group(1)
    return ""


def _task_notice_channel(task: dict) -> str:
    source_channel = _task_source_discord_channel(task)
    if source_channel:
        return source_channel
    return DISCORD_STATUS_CHANNEL


def _task_completion_channel(task: dict) -> str:
    if _is_discord_origin_task(task):
        return _task_source_discord_channel(task)
    return _task_notice_channel(task)


def _public_pearlos_app_base_url() -> str:
    raw = (
        os.getenv("PEARLOS_PUBLIC_APP_URL")
        or os.getenv("PEARLOS_USER_FACING_APP_URL")
        or "https://app.pearlos.org/pearlos"
    ).strip() or "https://app.pearlos.org/pearlos"
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme and parsed.netloc and parsed.path in ("", "/"):
        raw = raw.rstrip("/") + "/pearlos"
    return raw.rstrip("/")


def _task_note_deep_link(task: dict) -> str:
    raw = str(task.get("note_filename") or task.get("noteFilename") or "").strip()
    if not raw:
        return ""
    note_id = re.sub(r"\.md$", "", raw, flags=re.I).strip()
    if not note_id:
        return ""
    query = urllib.parse.urlencode({
        "desktopMode": "work",
        "openApp": "notes",
        "noteId": note_id,
    })
    return f"{_public_pearlos_app_base_url()}?{query}"


def _append_task_note_link(task: dict, message: str) -> str:
    link = _task_note_deep_link(task)
    if not link:
        return message
    if link in message:
        return message
    if "app.pearlos.org/pearlos" in message and "noteId=" in message:
        return message
    return f"{message.rstrip()}\n\nNotes: {link}"


def _task_completion_notice(task: dict, title: str, summary: str) -> str:
    if _is_discord_origin_task(task):
        return _append_task_note_link(task, summary or f"I finished checking {title}.")
    message = (
        f"Pearl's Agency says: Done: {title}. {summary}"
        if summary
        else f"Pearl's Agency says: Done: {title}."
    )
    return _append_task_note_link(task, message)


# ---------------------------------------------------------------------------
# Executor (stub + external-command shim)
# ---------------------------------------------------------------------------
def _builtin_echo_executor(task: dict) -> str:
    tid = task.get("id", "?")
    title = task.get("title") or (task.get("task") or "")[:80]
    return (
        f"[stub-worker] Picked up {tid}: {title}. "
        f"Real execution not yet wired. This is the plumbing prototype."
    )


def _external_executor(cmd: str, task: dict, timeout_s: float = 1200.0) -> Tuple[int, str, str]:
    """Run an external shell command with task JSON on stdin."""
    proc = subprocess.Popen(
        cmd,
        shell=True,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        stdout, stderr = proc.communicate(input=json.dumps(task), timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        stdout, stderr = proc.communicate()
        return 124, stdout or "", (stderr or "") + "\n[worker] executor timeout"
    return proc.returncode or 0, stdout, stderr


def _task_timeout_s(task: dict, default_timeout_s: float) -> float:
    try:
        value = float(task.get("timeout_s"))
    except (TypeError, ValueError):
        return default_timeout_s
    return value if value > 0 else default_timeout_s


def _combined_error(stdout: str, stderr: str, rc: int, limit: int = 1200) -> str:
    """Return useful executor diagnostics regardless of output stream."""
    pieces: list[str] = []
    if stderr.strip():
        pieces.append(stderr.strip())
    if stdout.strip():
        pieces.append(stdout.strip())
    text = "\n".join(pieces).strip()
    return text[:limit] if text else f"executor exited with code {rc}"


def _is_permanent_executor_error(text: str) -> bool:
    lowered = (text or "").lower()
    permanent_needles = (
        "failed to authenticate",
        "authentication_error",
        "invalid authentication credentials",
        "api error: 401",
        "401 {",
        "no api key",
        "not logged in",
        "please login",
        "401 unauthorized",
        "refresh_token_reused",
        "refresh token has already been used",
        "access token could not be refreshed",
        "please try signing in again",
        "bubblewrap",
        "bwrap:",
        "user namespace",
        "unprivileged_userns_clone",
        "operation not permitted",
        "sandbox failed",
        "sandbox initialization failed",
        "allowed workspace is empty",
        "workspace isolation",
        "not a git repository",
    )
    return any(needle in lowered for needle in permanent_needles)


def _plain_executor_error(err_msg: str, boss_name: str) -> tuple[str, str]:
    """Translate noisy CLI failures into user-facing Discord text."""
    if _is_permanent_executor_error(err_msg):
        return (
            f"{boss_name} is signed out on the staging droplet",
            (
                " I stopped the automatic retries because another attempt would "
                f"hit the same authentication failure. {boss_name} needs a fresh "
                "login under the deploy user before Agency research tasks can "
                "run there."
            ),
        )
    err_snippet = err_msg.strip().splitlines()[-1] if err_msg.strip() else ""
    return err_snippet[:200], ""


def _read_meminfo_mb() -> dict[str, int]:
    """Return selected /proc/meminfo values in MiB.

    The worker runs on small droplets where one Next build plus two coding
    agents can push the host into swap or OOM. MemAvailable is the kernel's
    best cheap estimate of memory that can be allocated without reclaim pain.
    """
    values: dict[str, int] = {}
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            for line in handle:
                key, _, rest = line.partition(":")
                if key not in ("MemTotal", "MemAvailable", "SwapFree"):
                    continue
                amount = rest.strip().split()[0]
                values[key] = int(amount) // 1024
    except Exception as e:
        log.warning("[MEMORY] Could not read /proc/meminfo: %s", e)
    return values


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------
class Worker:
    def __init__(
        self,
        api: TaskAPI,
        assignee: str,
        executor: Optional[str],
        dry_run: bool,
        concurrency: int = 2,
        timeout_s: float = 600.0,
    ):
        self.api = api
        self.assignee = assignee
        self.executor_cmd = executor  # None=stub, "claude"=claude mode, else=shell cmd
        self.dry_run = dry_run
        self.concurrency = concurrency
        self.timeout_s = timeout_s
        self.worker_id = f"pearl-worker@{socket.gethostname()}:{os.getpid()}"
        self.min_first_slot_mb = int(os.getenv("PEARL_WORKER_MIN_FIRST_SLOT_MB", "1536"))
        self.min_extra_slot_mb = int(os.getenv("PEARL_WORKER_MIN_EXTRA_SLOT_MB", "3072"))
        self._last_memory_gate_log_at = 0.0
        self._stop = False
        self.completed = 0
        # task_id -> InFlightTask
        self._in_flight: Dict[str, InFlightTask] = {}
        # task IDs already logged (blocked / allowed-through) — avoid spam
        self._seen_blocked: set = set()
        self._followup_state = self._load_followup_state()
        self._last_commentary_text: dict[str, str] = {}

    def request_stop(self, *_: object) -> None:
        log.info("Stop signal received.")
        self._stop = True

    @property
    def _slots_available(self) -> int:
        nominal = self.concurrency - len(self._in_flight)
        if nominal <= 0:
            return 0

        mem = _read_meminfo_mb()
        available = mem.get("MemAvailable")
        if available is None:
            return nominal

        required = self.min_first_slot_mb if not self._in_flight else self.min_extra_slot_mb
        if available >= required:
            return nominal

        now_epoch = time.time()
        if now_epoch - self._last_memory_gate_log_at >= 60.0:
            log.info(
                "[MEMORY] Deferring dispatch: MemAvailable=%dMiB required=%dMiB in_flight=%d nominal_slots=%d",
                available,
                required,
                len(self._in_flight),
                nominal,
            )
            self._last_memory_gate_log_at = now_epoch
        return 0

    # -- concurrency management ---------------------------------------------

    def _load_followup_state(self) -> dict:
        try:
            with open(FOLLOWUP_STATE_PATH, "r", encoding="utf-8") as handle:
                state = json.load(handle)
            if not isinstance(state, dict):
                return {"tasks": {}}
            tasks = state.get("tasks")
            if not isinstance(tasks, dict):
                state["tasks"] = {}
            return state
        except FileNotFoundError:
            return {"tasks": {}}
        except Exception as e:
            log.warning("[FOLLOWUP] Could not read follow-up state: %s", e)
            return {"tasks": {}}

    def _save_followup_state(self) -> None:
        try:
            os.makedirs(os.path.dirname(FOLLOWUP_STATE_PATH), exist_ok=True)
            tmp_path = f"{FOLLOWUP_STATE_PATH}.tmp"
            with open(tmp_path, "w", encoding="utf-8") as handle:
                json.dump(self._followup_state, handle, indent=2, sort_keys=True)
            os.replace(tmp_path, FOLLOWUP_STATE_PATH)
        except Exception as e:
            log.warning("[FOLLOWUP] Could not write follow-up state: %s", e)

    def _register_followup(self, task: dict) -> None:
        tid = str(task.get("id") or "")
        if not tid:
            return
        now_epoch = time.time()
        existing = self._followup_state.setdefault("tasks", {}).get(tid, {})
        self._followup_state["tasks"][tid] = {
            **existing,
            "title": _task_text_for_notice(task),
            "channel_id": _task_notice_channel(task),
            "started_at": float(existing.get("started_at") or now_epoch),
            "last_notice_at": float(existing.get("last_notice_at") or now_epoch),
            "notice_count": int(existing.get("notice_count") or 0),
            "updated_at": now_epoch,
        }
        self._save_followup_state()

    def _clear_followup(self, task_id: str) -> None:
        tasks = self._followup_state.setdefault("tasks", {})
        if task_id in tasks:
            del tasks[task_id]
            self._save_followup_state()

    def _emit_commentary(self, task: dict, phase: str, executor: Optional[str], elapsed_s: float = 0.0) -> None:
        tid = str(task.get("id") or "")
        if not tid:
            return
        thought = _sanitize_public_commentary(_deepseek_commentary(task, phase, executor, elapsed_s))
        if not thought:
            return
        if self._last_commentary_text.get(tid) == thought:
            return
        status = "done" if phase in ("done", "wrapping_up") else "running"
        try:
            self.api.patch(
                tid,
                {
                    "agent_activity_merge": {
                        COMMENTATOR_AGENT_ID: {
                            "status": status,
                            "thought": thought,
                            "updated_at": _iso_now(),
                        }
                    }
                },
            )
            self._last_commentary_text[tid] = thought
        except Exception as e:
            log.debug("Could not publish commentary for %s: %s", tid, e)

    def _send_due_followups(self) -> None:
        if not self._in_flight:
            return
        now_epoch = time.time()
        tasks = self._followup_state.setdefault("tasks", {})
        changed = False
        for tid, ift in list(self._in_flight.items()):
            item = tasks.get(tid)
            if not item:
                self._register_followup(ift.task)
                item = tasks.get(tid)
                if not item:
                    continue
            started_at = float(item.get("started_at") or now_epoch)
            last_notice_at = float(item.get("last_notice_at") or started_at)
            if now_epoch - started_at < FOLLOWUP_INTERVAL_S:
                continue
            if now_epoch - last_notice_at < FOLLOWUP_INTERVAL_S:
                continue
            notice_count = int(item.get("notice_count") or 0) + 1
            elapsed_min = max(1, int((now_epoch - started_at) / 60))
            title = item.get("title") or _task_text_for_notice(ift.task)
            channel_id = str(item.get("channel_id") or _task_notice_channel(ift.task))
            latest: dict = {}
            try:
                latest = self.api.get(tid) or {}
            except Exception as e:
                log.warning("[FOLLOWUP] Could not inspect task %s before watchdog notice: %s", tid, e)
            note = _latest_public_task_note(latest)
            if not note:
                item["last_notice_at"] = now_epoch
                item["notice_count"] = notice_count
                item["updated_at"] = now_epoch
                changed = True
                log.info("[FOLLOWUP] Suppressed generic watchdog update for %s after %dm", tid, elapsed_min)
                continue
            message = f"Pearl's Agency says: {title}: {note}"
            if _post_discord(channel_id, message):
                item["last_notice_at"] = now_epoch
                item["notice_count"] = notice_count
                item["updated_at"] = now_epoch
                changed = True
                log.info("[FOLLOWUP] Posted watchdog update for %s after %dm", tid, elapsed_min)
            else:
                log.warning("[FOLLOWUP] Could not post watchdog update for %s", tid)
        if changed:
            self._save_followup_state()

    def _reap_finished(self) -> None:
        """Poll all in-flight subprocesses; handle completions and timeouts."""
        done = []
        now = time.monotonic()
        for tid, ift in self._in_flight.items():
            rc = ift.poll()
            if rc is not None:
                done.append((tid, ift, rc, False))
            elif ift.is_timed_out():
                log.warning("Task %s timed out after %.0fs — killing", tid, ift.timeout_s)
                ift.proc.kill()
                ift.proc.wait()
                done.append((tid, ift, 124, True))
            elif now - ift.last_commentary_at >= COMMENTARY_INTERVAL_S:
                ift.last_commentary_at = now
                self._emit_commentary(ift.task, "running", ift.executor, now - ift.started_at)

        for tid, ift, rc, timed_out in done:
            del self._in_flight[tid]
            self._clear_followup(tid)
            phase = "blocked" if timed_out or rc != 0 else "wrapping_up"
            self._emit_commentary(ift.task, phase, ift.executor, time.monotonic() - ift.started_at)
            self._handle_completion(ift, rc, timed_out)

    def _cleanup_process_files(self, proc: "subprocess.Popen[str]") -> None:
        for attr in ("_pearl_stdout_file", "_pearl_stderr_file"):
            handle = getattr(proc, attr, None)
            if handle:
                try:
                    handle.close()
                except Exception:
                    pass
        tmp_dir = getattr(proc, "_pearl_tmp_dir", "")
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def _terminate_in_flight(self, task_id: str, reason: str) -> bool:
        """Stop a subprocess because the task was paused/stopped/cancelled externally."""
        ift = self._in_flight.get(task_id)
        if not ift:
            return False
        log.info("Stopping in-flight task %s after control update: %s", task_id, reason)
        proc = ift.proc
        try:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)
        except Exception as e:
            log.warning("Could not stop task %s cleanly: %s", task_id, e)
            try:
                proc.kill()
            except Exception:
                pass
        self._cleanup_process_files(proc)
        self._clear_followup(task_id)
        self._in_flight.pop(task_id, None)
        return True

    def _handle_control_update(self, env: dict) -> bool:
        """Apply user control events to running subprocesses.

        The UI parks paused/stopped tasks by changing the assignee away from
        this worker. Without this hook, the task record can look stopped while
        the subprocess keeps running until timeout.
        """
        task = env.get("task") or {}
        tid = str(task.get("id") or "")
        if not tid or tid not in self._in_flight:
            return False
        status = task.get("status")
        assignee = task.get("assignee")
        patch = env.get("patch") or {}
        note = patch.get("notes_append") if isinstance(patch, dict) else None
        note_text = str(note.get("text") or "") if isinstance(note, dict) else ""
        parked = status == "pending" and assignee != self.assignee
        cancelled = status in ("cancelled", "archived")
        explicit = re.search(r"\b(paused|stopped|cancelled) from UI\b", note_text, re.I)
        if parked or cancelled or explicit:
            return self._terminate_in_flight(tid, note_text or f"status={status} assignee={assignee}")
        return False

    def _handle_completion(self, ift: InFlightTask, rc: int, timed_out: bool) -> None:
        task = ift.task
        tid = ift.task_id
        fast_draft = _is_fast_draft_task(task)
        worker_cwd = _worker_cwd(task)
        stdout_file = getattr(ift.proc, "_pearl_stdout_file", None)
        stderr_file = getattr(ift.proc, "_pearl_stderr_file", None)
        if stdout_file:
            stdout_file.seek(0)
            stdout = stdout_file.read()
            stdout_file.close()
        else:
            stdout = ift.proc.stdout.read() if ift.proc.stdout else ""
        if stderr_file:
            stderr_file.seek(0)
            stderr = stderr_file.read()
            stderr_file.close()
        else:
            stderr = ift.proc.stderr.read() if ift.proc.stderr else ""
        tmp_dir = getattr(ift.proc, "_pearl_tmp_dir", "")
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)

        elapsed = time.monotonic() - ift.started_at
        log.info("Task %s finished rc=%d elapsed=%.1fs", tid, rc, elapsed)
        if stderr.strip():
            log.info("Task %s stderr: %s", tid, stderr.strip()[:500])

        if ift.executor in ("claude", "codex"):
            # When executor is claude, the subprocess itself calls pearl-task
            # complete/fail. We just record the outcome in the log.
            # If it crashed (non-zero) AND we haven't already seen the task
            # flipped to completed, fail it ourselves.
            boss_name = "Claude" if ift.executor == "claude" else "Codex"
            if rc != 0:
                err_msg = _combined_error(stdout, stderr, rc)
                permanent_executor_error = _is_permanent_executor_error(err_msg)
                if timed_out:
                    err_msg = f"Task timed out after {ift.timeout_s:.0f}s. " + err_msg
                updated_task: dict = {}
                try:
                    updated_task = self.api.fail(
                        tid,
                        err_msg,
                        note=f"worker detected rc={rc}",
                        no_retry=permanent_executor_error,
                    ) or {}
                    log.warning("Marked %s failed (rc=%d)", tid, rc)
                except Exception as e:
                    log.error("Could not fail task %s: %s", tid, e)
                # Plain-language failure notice. Translate the rc into something
                # Blair can read at a glance and only include a short, explained
                # snippet of the actual error.
                if timed_out:
                    why_plain = (
                        f"it ran for the full {ift.timeout_s:.0f}-second time limit "
                        f"without finishing, so I had to stop it"
                    )
                elif rc == 124:
                    why_plain = "it timed out before finishing"
                elif rc < 0:
                    why_plain = f"it was killed by the system (signal {-rc})"
                else:
                    why_plain = f"it crashed partway through (exit code {rc})"

                # Rule (4): include the task description in plain English
                # alongside the task ID. Pull the full task body (falling back
                # to title) and trim to a readable length so Discord doesn't
                # get a wall of text.
                task_desc_raw = (
                    updated_task.get("task")
                    or task.get("task")
                    or updated_task.get("title")
                    or task.get("title")
                    or ""
                )
                task_desc = " ".join(str(task_desc_raw).split())
                if len(task_desc) > 400:
                    task_desc = task_desc[:399].rstrip() + "\u2026"
                task_desc = _public_discord_content(task_desc, 400)

                err_snippet, auth_next_step = _plain_executor_error(err_msg, boss_name)
                err_snippet = _public_discord_content(err_snippet, 220)
                err_clause = (
                    f" The last thing it logged was: \"{err_snippet}\"."
                    if err_snippet else ""
                )

                # Retry status comes back from the gateway's auto-requeue
                # logic. If status=pending after we said "failed", the gateway
                # requeued us; otherwise it ran out of retries and the task
                # stays failed.
                retry_count = int(updated_task.get("retry_count") or 0)
                post_status = updated_task.get("status") or "failed"
                if post_status == "pending":
                    log.info(
                        "Task %s failed attempt #%s and auto-requeued; suppressing Discord retry noise.",
                        tid,
                        retry_count,
                    )
                    self.completed += 1
                    return
                elif permanent_executor_error:
                    next_step = auth_next_step or (
                        " I stopped automatic retries because this is a deterministic "
                        "executor or sandbox setup failure. The staging sandbox needs "
                        "a smoke-test/recovery pass before this task is retried."
                    )
                else:
                    next_step = (
                        f" This was attempt #{retry_count} and we've used up "
                        f"the automatic retries, so the task is staying marked "
                        f"failed in the queue (the record is preserved). Let "
                        f"me know if you want me to reset it or hand it to a "
                        f"different agent."
                    )

                if not fast_draft:
                    notice_task = updated_task or task
                    notice_channel = _task_completion_channel(notice_task) or DISCORD_STATUS_CHANNEL
                    if _is_discord_origin_task(notice_task):
                        failure_summary = (
                            f"I hit a blocker before I could finish {task_desc or 'that request'}. "
                            f"{why_plain}.{err_clause}"
                        )
                    else:
                        failure_summary = (
                            f"Pearl's Agency says: The task asking me to \"{task_desc}\" "
                            f"just failed. The {boss_name} "
                            f"session I spawned to handle it didn't get to a clean "
                            f"finish. {why_plain}.{err_clause}{next_step}"
                        )
                    _post_discord(
                        notice_channel,
                        failure_summary,
                    )
            else:
                log.info("Task %s: %s subprocess exited cleanly.", tid, boss_name)
                if stdout.strip():
                    log.info("Task %s %s output (first 500): %s", tid, boss_name, stdout.strip()[:500])
                    lowered = stdout.lower()
                    manifest_found = False
                    manifest_ok = False
                    manifest_message = ""
                    feature_found = False
                    feature_ok = False
                    feature_message = ""
                    personal_ledger_message = ""
                    try:
                        manifest_found, manifest_ok, manifest_message = _publish_interface_customization_if_present(
                            task,
                            worker_cwd,
                        )
                        if manifest_found and not manifest_ok:
                            self.api.fail(
                                tid,
                                manifest_message,
                                note="worker could not apply PearlOS UI customization live",
                                no_retry=True,
                            )
                            latest = self.api.get(tid) or task
                            log.warning("Marked %s failed because UI customization did not apply live: %s", tid, manifest_message)
                            self.completed += 1
                            return
                        if manifest_found and manifest_ok:
                            manifest_path, manifest_doc = _find_interface_customization_manifest(worker_cwd)
                            ledger_ok, ledger_msg = _record_studio_ledger_item(
                                task,
                                item_id=_ledger_item_id(task, "ui_manifest"),
                                kind="ui_manifest",
                                status="applied",
                                summary=manifest_message,
                                artifact_path=manifest_path or "pearlos-ui-customization.json",
                                share_eligible=_manifest_share_eligible(manifest_doc),
                            )
                            if ledger_ok:
                                personal_ledger_message = ledger_msg
                            else:
                                log.warning("Could not record Studio ledger item for %s: %s", tid, ledger_msg)
                        feature_found, feature_ok, feature_message = _install_pearl_feature_package_if_present(
                            task,
                            worker_cwd,
                        )
                        if feature_found and not feature_ok:
                            self.api.fail(
                                tid,
                                feature_message,
                                note="worker could not install PearlOS feature package",
                                no_retry=True,
                            )
                            latest = self.api.get(tid) or task
                            log.warning("Marked %s failed because feature package did not install: %s", tid, feature_message)
                            self.completed += 1
                            return
                        if feature_found and feature_ok:
                            personal_ledger_message = feature_message
                    except Exception as e:
                        log.error("Could not inspect/apply personal PearlOS artifacts for clean %s task %s: %s", boss_name, tid, e)
                    false_success = (
                        "task result: failed" in lowered
                        or "status: could not complete" in lowered
                        or "was not sent to discord" in lowered
                        or "permission mode blocks" in lowered
                        or "blocked by the permission system" in lowered
                        or "task api returned 401" in lowered
                        or "task api auth issue" in lowered
                        or "did not apply or deploy" in lowered
                        or "didn't apply or deploy" in lowered
                        or "protected pearlos source edits are disabled" in lowered
                        or "protected source edits are disabled" in lowered
                        or "could not post it into notes" in lowered
                        or "could not post into notes" in lowered
                        or "couldn't post it into notes" in lowered
                        or "couldn't post into notes" in lowered
                        or "could not post it into discord" in lowered
                        or "could not post into discord" in lowered
                        or "couldn't post it into discord" in lowered
                        or "couldn't post into discord" in lowered
                        or "local/discord network calls are blocked" in lowered
                        or "/workspace/user is mounted read-only" in lowered
                        or "mounted read-only" in lowered
                        or "next recovery step is to copy that report" in lowered
                        or "prepared a sandboxed" in lowered
                        or "created a sandboxed patch" in lowered
                        or "implemented the file" in lowered and "sandboxed source copy" in lowered
                    ) and not ((manifest_found and manifest_ok) or (feature_found and feature_ok))
                    if false_success:
                        try:
                            self.api.fail(
                                tid,
                                stdout.strip()[:2000],
                                note=f"worker detected incomplete result from clean {boss_name} exit",
                            )
                            latest = self.api.get(tid) or task
                            log.warning("Marked %s failed after %s reported incomplete result in stdout", tid, boss_name)
                        except Exception as e:
                            log.error("Could not mark false-success task %s failed: %s", tid, e)
                    else:
                        try:
                            latest = self.api.get(tid) or {}
                            if _should_reconcile_clean_exit(latest, self.assignee):
                                result_text = stdout.strip()[:4000]
                                # A personal task that produced code/content but
                                # no live UI manifest is recorded as a reviewable
                                # personal change artifact on the requester's
                                # account — never pushed into shared source.
                                if not manifest_found and not feature_found and _is_public_workspace_task(task) and not _looks_like_blocked_result(result_text):
                                    artifacts = _detect_personal_code_artifacts(worker_cwd)
                                    if artifacts:
                                        artifact_summary = (
                                            "Saved as a reviewable personal change artifact for this account: "
                                            + ", ".join(artifacts[:8])
                                            + (" and more" if len(artifacts) > 8 else "")
                                            + ". It was not pushed into shared PearlOS; "
                                            "core integration is a separate review step."
                                        )
                                        ledger_ok, ledger_msg = _record_studio_ledger_item(
                                            task,
                                            item_id=_ledger_item_id(task, "code_artifact"),
                                            kind="code_artifact",
                                            status="needs_review",
                                            summary=artifact_summary,
                                            artifact_path=worker_cwd,
                                            share_eligible=False,
                                        )
                                        if ledger_ok:
                                            personal_ledger_message = artifact_summary
                                        else:
                                            log.warning("Could not record code-artifact ledger item for %s: %s", tid, ledger_msg)
                                for extra in (
                                    manifest_message if (manifest_found and manifest_ok) else "",
                                    feature_message if (feature_found and feature_ok) else "",
                                    personal_ledger_message,
                                ):
                                    if extra and extra not in result_text:
                                        result_text = (f"{result_text}\n\n{extra}" if result_text else extra)[:4000]
                                if _looks_like_blocked_result(result_text):
                                    self.api.fail(
                                        tid,
                                        result_text or f"{boss_name} reported a blocker without changing files",
                                        note=f"worker treated clean {boss_name} exit as blocked, not completed",
                                        no_retry=True,
                                    )
                                    log.warning("Marked task %s failed because clean %s output was blocked", tid, boss_name)
                                else:
                                    self.api.complete(
                                        tid,
                                        result_text,
                                        note=f"worker reconciled clean {boss_name} exit",
                                    )
                                    log.info("Reconciled task %s as completed after clean %s exit", tid, boss_name)
                        except Exception as e:
                            log.error("Could not reconcile clean %s task %s: %s", boss_name, tid, e)

                    # Post success notification to Discord
                    try:
                        latest2 = self.api.get(tid) or {}
                        if not fast_draft and latest2.get("status") == "completed":
                            notice_task = latest2 or task
                            title = _public_discord_content(str(latest2.get("title") or task.get("title") or "a task"), 140)
                            summary = _public_discord_content(str(latest2.get("result") or ""), 600)
                            channel = _task_completion_channel(notice_task)
                            if channel:
                                _post_discord(
                                    channel,
                                    _task_completion_notice(notice_task, title, summary),
                                )
                    except Exception as e:
                        log.warning("Could not post success notice for %s: %s", tid, e)
                else:
                    try:
                        latest = self.api.get(tid) or task
                        if _should_reconcile_clean_exit(latest, self.assignee):
                            self.api.fail(
                                tid,
                                f"{boss_name} exited cleanly but produced no output and did not update the task.",
                                note=f"worker detected empty-output clean {boss_name} exit",
                                no_retry=True,
                            )
                            latest = self.api.get(tid) or task
                    except Exception as e:
                        log.warning("Could not reconcile empty-output completion for %s: %s", tid, e)
            self.completed += 1
        else:
            # Shell executor mode — worker is responsible for complete/fail.
            if rc == 0:
                result = stdout.strip() or "(executor produced no output)"
                try:
                    if _looks_like_blocked_result(result):
                        self.api.fail(
                            tid,
                            result,
                            note="worker treated clean executor exit as blocked, not completed",
                            no_retry=True,
                        )
                        log.warning("Marked task %s failed because clean executor output was blocked", tid)
                    else:
                        self.api.complete(tid, result)
                        log.info("Completed task %s", tid)
                except Exception as e:
                    log.error("Could not complete task %s: %s", tid, e)
            else:
                err = (stdout.strip() + ("\n" + stderr.strip() if stderr.strip() else "")) or \
                      f"executor exit {rc}"
                try:
                    self.api.fail(tid, err, note=f"executor exit {rc}")
                    log.warning("Failed task %s (rc=%d)", tid, rc)
                except Exception as e:
                    log.error("Could not fail task %s: %s", tid, e)
            self.completed += 1

    # -- single task lifecycle ---------------------------------------------

    BLOCKED_TASK_PATTERNS = [
        "pearlos website",
        "website dev server",
        "port 3001",
        "pearlos-website",
        "start the pearlos website",
    ]

    def _should_skip(self, task: dict) -> bool:
        tid = task.get("id", "")
        # Pre-flight checks (cheap, run first)
        if task.get("status") != "pending":
            return True
        if task.get("assignee") != self.assignee:
            return True
        if tid in self._in_flight:
            return True

        # Block website tasks that would break staging.
        # Must match BOTH title AND body to avoid blocking meta/obligation
        # follow-ups whose auto-generated title happens to mention the
        # original subagent's work (e.g. "Continue Discord request:
        # pearlos-website-build …").
        title = (task.get("title") or "").lower()
        body = (task.get("task") or "").lower()
        for pattern in self.BLOCKED_TASK_PATTERNS:
            if pattern in title and pattern in body:
                if tid not in self._seen_blocked:
                    self._seen_blocked.add(tid)
                    reason = f"pattern={pattern!r}"
                    print(f"[BLOCKED] Skipping {tid}: {reason}  (matches both title+body)")
                return True
            if pattern in title and not body:
                # Title-only match is suspicious (auto-generated obligation
                # title) — log once but allow through.
                if tid not in self._seen_blocked:
                    self._seen_blocked.add(tid)
                    print(f"[ALLOW] Title-only match for {tid}: pattern={pattern!r} — body absent, letting through")
                # Do NOT return True here; fall through to body-only check
            if pattern in body and pattern not in title:
                if tid not in self._seen_blocked:
                    self._seen_blocked.add(tid)
                    reason = f"pattern={pattern!r}"
                    print(f"[BLOCKED] Skipping {tid}: {reason}  (matches body only)")
                return True

        return False

    def _try_dispatch(self, task: dict) -> bool:
        """Claim and dispatch a task. Returns True if dispatched."""
        tid = task.get("id") or ""
        if self._should_skip(task):
            return False
        if self._slots_available <= 0:
            log.debug("Concurrency limit reached (%d in flight), deferring %s", len(self._in_flight), tid)
            return False

        # Atomic claim
        claimed = self.api.claim(tid, self.worker_id)
        if not claimed:
            log.debug("Could not claim %s (already taken or missing)", tid)
            return False
        if claimed.get("status") != "in_progress":
            log.debug("Claim of %s did not flip to in_progress, skipping", tid)
            return False

        log.info("Claimed task %s: %r", tid, (claimed.get("title", "") or "")[:80])

        if self.dry_run:
            log.info("Dry-run: would execute %s", tid)
            return True

        if self.executor_cmd in ("claude", "codex"):
            # Re-fetch full task record (SSE event may be truncated)
            full_task = self.api.get(tid) or claimed
            task_timeout_s = _task_timeout_s(full_task, self.timeout_s)
            fast_draft = _is_fast_draft_task(full_task)
            effective_executor = (
                "codex"
                if self.executor_cmd == "claude" and _is_public_workspace_task(full_task)
                else self.executor_cmd
            )
            try:
                full_task = self.api.patch(
                    tid,
                    {
                        "executor_requested": self.executor_cmd,
                        "executor_effective": effective_executor,
                    },
                ) or full_task
            except Exception as e:
                log.warning("Could not stamp executor metadata on %s: %s", tid, e)
            simple_discord_send = _extract_simple_discord_send(full_task)
            if simple_discord_send:
                channel_id, message = simple_discord_send
                if _post_discord(channel_id, message):
                    updated = self.api.complete(
                        tid,
                        f'Sent "{message}" to Discord channel {channel_id}.',
                        note="worker handled simple Discord send directly",
                    )
                    log.info("Completed %s via direct Discord send", tid)
                else:
                    updated = self.api.fail(
                        tid,
                        f'Failed to send "{message}" to Discord channel {channel_id}.',
                        note="worker direct Discord send failed",
                    )
                    log.warning("Failed %s direct Discord send", tid)
                self.completed += 1
                return True
            try:
                if effective_executor == "codex":
                    proc = _spawn_codex(full_task, task_timeout_s, self.worker_id)
                else:
                    proc = _spawn_claude(full_task, task_timeout_s, self.worker_id)
            except Exception as e:
                log.error("Failed to spawn %s for %s: %s", effective_executor, tid, e)
                updated = self.api.fail(tid, f"worker failed to spawn {effective_executor}: {e}", note="spawn error")
                return True
            self._in_flight[tid] = InFlightTask(
                task=full_task,
                proc=proc,
                started_at=time.monotonic(),
                timeout_s=task_timeout_s,
                executor=effective_executor,
            )
            self._in_flight[tid].last_commentary_at = time.monotonic()
            self._emit_commentary(full_task, "claimed", effective_executor, 0.0)
            if not fast_draft:
                self._register_followup(full_task)
            # Plain-language pickup notice. Avoid jargon and read like a
            # short status update from a teammate, not a log line.
            title = (claimed.get("title") or claimed.get("task") or "")[:140]
            # Pickup announcements were spam. The Agency now only posts on
            # final completion, blocker, or critical question — not on every
            # task pickup. Tasks are visible in the ActiveJobs widget; users
            # don't need a Discord ping for each one. (Blair, 2026-04-30.)
            return True

        # Legacy synchronous executor (blocking — not recommended for daemon mode)
        full_task = self.api.get(tid) or claimed
        task_timeout_s = _task_timeout_s(full_task, self.timeout_s)
        try:
            if self.executor_cmd:
                rc, stdout, stderr = _external_executor(self.executor_cmd, full_task, task_timeout_s)
                ok = rc == 0
                result = stdout.strip() or f"exit {rc}"
                err = stderr.strip()
            else:
                result = _builtin_echo_executor(full_task)
                ok = True
                err = "stub executor"
        except Exception as e:
            self.api.fail(tid, f"worker exception: {e}", note="uncaught exception")
            log.error("FAIL %s: %s", tid, e)
            return True

        if ok:
            updated = self.api.complete(tid, result)
            log.info("Completed %s", tid)
        else:
            updated = self.api.fail(tid, result, note=err)
            log.warning("Failed %s: %s", tid, err)
        self.completed += 1
        return True

    # -- startup poll & orphan reaper ---------------------------------------

    def _startup_poll(self) -> None:
        """Pick up any pending tasks that were created while the worker was down."""
        try:
            pending = self.api.list_pending(self.assignee)
        except Exception as e:
            log.warning("[STARTUP] Could not poll pending tasks: %s", e)
            return
        if not pending:
            log.info("[STARTUP] No stranded tasks found.")
            return
        log.info("[STARTUP] Picking up %d stranded task(s).", len(pending))
        for t in pending:
            self._try_dispatch(t)

    def _catch_up_pending(self) -> None:
        """Periodic pending poll for SSE mode, in case a create event was dropped."""
        if self._slots_available <= 0:
            return
        try:
            pending = self.api.list_pending(self.assignee)
        except Exception as e:
            log.warning("[CATCHUP] Could not poll pending tasks: %s", e)
            return
        for task in pending:
            if self._slots_available <= 0:
                break
            self._try_dispatch(task)

    def _reap_orphans(self) -> None:
        """Mark in_progress tasks as failed if they have no matching in-flight subprocess
        and were last updated more than timeout * 2 seconds ago (definitely orphaned)."""
        try:
            in_progress = self.api.list_in_progress(self.assignee)
        except Exception as e:
            log.warning("[REAPER] Could not poll in_progress tasks: %s", e)
            return

        # Cutoff: tasks updated more than timeout*2 seconds ago are orphaned.
        cutoff_age = self.timeout_s * 2
        now_epoch = time.time()
        orphan_ids = []
        for t in in_progress:
            tid = t.get("id", "")
            # If we are actively working this task, skip it.
            if tid in self._in_flight:
                continue
            # Parse timestamp_updated to determine age.
            ts_raw = t.get("timestamp_updated") or t.get("updated_at") or ""
            if ts_raw:
                try:
                    # Accept ISO 8601: "2025-04-16T12:34:56+00:00" or "...Z"
                    ts_clean = ts_raw.replace("Z", "+00:00")
                    # Python 3.7+ fromisoformat handles offset-aware strings.
                    import datetime
                    dt = datetime.datetime.fromisoformat(ts_clean)
                    # Convert to UTC epoch for age calculation.
                    task_ts = dt.timestamp()
                    age = now_epoch - task_ts
                    if age < cutoff_age:
                        continue  # Recently updated — another worker may own it.
                except Exception:
                    pass  # Can't parse timestamp; include it as a candidate.
            orphan_ids.append(tid)

        if not orphan_ids:
            log.info("[REAPER] No orphaned tasks found.")
            return

        log.info("[REAPER] Reaping %d orphaned task(s).", len(orphan_ids))
        for tid in orphan_ids:
            try:
                updated = self.api.fail(
                    tid,
                    "Orphaned by worker restart, no in-flight subprocess",
                    note="[REAPER] auto-failed after timeout*2 with no matching subprocess",
                ) or {}
                # The gateway auto-requeues failed tasks under the retry
                # budget: our PATCH says status=failed but the stored record
                # comes back status=pending with retry_count bumped. Log the
                # true outcome so "Marked X as failed" doesn't lie when the
                # task was actually requeued for retry.
                post_status = updated.get("status") or "failed"
                retry_count = updated.get("retry_count")
                if post_status == "pending":
                    log.info(
                        "[REAPER] %s auto-requeued by gateway (attempt #%s) — staying pending for retry.",
                        tid, retry_count,
                    )
                    self._clear_followup(tid)
                elif post_status == "failed":
                    log.info(
                        "[REAPER] %s marked failed (attempt #%s, retry budget exhausted).",
                        tid, retry_count,
                    )
                    self._clear_followup(tid)
                else:
                    log.info("[REAPER] %s now status=%s.", tid, post_status)
            except Exception as e:
                log.warning("[REAPER] Could not fail task %s: %s", tid, e)

    # -- loop drivers -------------------------------------------------------

    def _poll_in_flight(self) -> None:
        """Reap finished subprocesses. Call frequently."""
        if self._in_flight:
            self._reap_finished()
            self._send_due_followups()

    def run_once(self) -> bool:
        self._poll_in_flight()
        for t in self.api.list_pending(self.assignee):
            if self._try_dispatch(t):
                return True
        return False

    def run_polling(self, interval: float, max_tasks: int = 0) -> None:
        log.info(
            "Polling mode interval=%.1fs assignee=%s concurrency=%d worker_id=%s",
            interval, self.assignee, self.concurrency, self.worker_id,
        )
        # Startup poll: pick up any pending tasks created while worker was down.
        self._startup_poll()
        if max_tasks and self.completed >= max_tasks:
            self._drain_in_flight()
            return

        last_reaper = time.monotonic()
        while not self._stop:
            try:
                self._poll_in_flight()
                worked = False
                if self._slots_available > 0:
                    for t in self.api.list_pending(self.assignee):
                        if self._try_dispatch(t):
                            worked = True
                            break
                # Periodic orphan reaper (every 60s).
                now = time.monotonic()
                if now - last_reaper >= 60.0:
                    self._reap_orphans()
                    last_reaper = now
            except urllib.error.URLError as e:
                log.error("API error: %s", e)
                time.sleep(min(interval * 3, 30))
                continue
            if max_tasks and self.completed >= max_tasks:
                log.info("Max tasks reached (%d), exiting.", max_tasks)
                self._drain_in_flight()
                return
            time.sleep(0.2 if worked or self._in_flight else interval)

        self._drain_in_flight()

    # Heartbeat / reconnect tunables
    _HEARTBEAT_SILENCE_S: float = 30.0   # probe API after this many silent seconds
    _RECONNECT_SILENCE_S: float = 60.0   # force reconnect after this many silent seconds
    _SSE_READ_TIMEOUT_S: float = 35.0    # per-read socket timeout (slightly > heartbeat)

    def _heartbeat_ok(self) -> bool:
        """GET /api/tasks?status=pending&... as a liveness probe. Returns True on success."""
        try:
            self.api.list_pending(self.assignee, limit=1)
            return True
        except Exception as e:
            log.warning("[HEARTBEAT] Probe failed: %s", e)
            return False

    def run_sse(self, max_tasks: int = 0) -> None:
        log.info(
            "SSE mode assignee=%s concurrency=%d timeout=%.0fs worker_id=%s",
            self.assignee, self.concurrency, self.timeout_s, self.worker_id,
        )

        last_reaper = time.monotonic()
        last_pending_catchup = 0.0
        consecutive_failures = 0
        # Reconnect back-off schedule (seconds): first, second, third+ failure.
        _backoff = [5.0, 15.0, 30.0]

        def _wait_and_poll(seconds: float) -> None:
            """Sleep *seconds* while still reaping in-flight subprocesses."""
            steps = max(1, int(seconds / 0.2))
            for _ in range(steps):
                if self._stop:
                    break
                time.sleep(0.2)
                self._poll_in_flight()

        while not self._stop:
            # ----------------------------------------------------------------
            # Guard: if we've failed 3+ times in a row, fall through to plain
            # polling mode for one cycle, then try SSE again.
            # ----------------------------------------------------------------
            if consecutive_failures >= 3:
                log.warning(
                    "[RECONNECT] SSE failed %d times in a row — falling back to "
                    "polling mode for one cycle before retrying SSE.",
                    consecutive_failures,
                )
                try:
                    if self._slots_available > 0:
                        for t in self.api.list_pending(self.assignee):
                            self._try_dispatch(t)
                except Exception as e:
                    log.warning("[POLL-FALLBACK] Error during fallback poll: %s", e)
                _wait_and_poll(30.0)
                if self._stop:
                    break
                consecutive_failures = 0  # Reset — give SSE another shot.

            # ----------------------------------------------------------------
            # Startup / reconnect poll: pick up tasks created while we were
            # down or disconnected.  Run on EVERY successful connection.
            # ----------------------------------------------------------------
            self._startup_poll()
            if max_tasks and self.completed >= max_tasks:
                self._drain_in_flight()
                return

            # ----------------------------------------------------------------
            # SSE receive loop
            # ----------------------------------------------------------------
            _last_event_time = time.monotonic()
            _heartbeat_fired = False  # reset per connection

            try:
                for env in self.api.stream(read_timeout=self._SSE_READ_TIMEOUT_S):
                    if self._stop:
                        break

                    _last_event_time = time.monotonic()
                    _heartbeat_fired = False  # live event resets heartbeat state
                    consecutive_failures = 0   # clean stream = not failing

                    # Poll in-flight on every SSE event.
                    self._poll_in_flight()

                    # Periodic orphan reaper (every 60s).
                    now = time.monotonic()
                    if now - last_pending_catchup >= 45.0:
                        self._catch_up_pending()
                        last_pending_catchup = now
                    if now - last_reaper >= 60.0:
                        self._reap_orphans()
                        last_reaper = now

                    if env.get("event") not in ("created", "updated"):
                        continue
                    if env.get("event") == "updated" and self._handle_control_update(env):
                        continue
                    task = env.get("task") or {}
                    if task.get("status") == "pending" and task.get("assignee") == self.assignee:
                        self._try_dispatch(task)
                    if max_tasks and self.completed >= max_tasks:
                        self._drain_in_flight()
                        return

            except socket.timeout:
                # Per-read timeout fired — SSE stream went silent.
                silent_s = time.monotonic() - _last_event_time
                self._poll_in_flight()
                now = time.monotonic()
                if now - last_pending_catchup >= 45.0:
                    self._catch_up_pending()
                    last_pending_catchup = now

                if silent_s >= self._RECONNECT_SILENCE_S:
                    log.warning(
                        "[RECONNECT] SSE silent for %.0fs, reconnecting...", silent_s
                    )
                    consecutive_failures += 1
                    backoff = _backoff[min(consecutive_failures - 1, len(_backoff) - 1)]
                    _wait_and_poll(backoff)
                    continue  # → top of while loop → _startup_poll + new stream()

                elif silent_s >= self._HEARTBEAT_SILENCE_S and not _heartbeat_fired:
                    _heartbeat_fired = True
                    if self._heartbeat_ok():
                        log.info("[HEARTBEAT] OK (%.0fs silent)", silent_s)
                        # Do not increment consecutive_failures — server is up.
                    else:
                        log.warning(
                            "[HEARTBEAT] Failed after %.0fs silence — treating as disconnect.",
                            silent_s,
                        )
                        consecutive_failures += 1
                        backoff = _backoff[min(consecutive_failures - 1, len(_backoff) - 1)]
                        _wait_and_poll(backoff)
                        continue  # → reconnect
                else:
                    # Brief silence, just loop — the outer while will reconnect.
                    pass

            except (urllib.error.URLError, ConnectionError, OSError, TimeoutError) as e:
                log.warning("SSE disconnected: %s — reconnecting...", e)
                consecutive_failures += 1
                backoff = _backoff[min(consecutive_failures - 1, len(_backoff) - 1)]
                log.info("[RECONNECT] Waiting %.0fs before reconnect (attempt %d).", backoff, consecutive_failures)
                _wait_and_poll(backoff)
                # After wait, loop top will call _startup_poll then re-open stream.
                now = time.monotonic()
                if now - last_pending_catchup >= 45.0:
                    self._catch_up_pending()
                    last_pending_catchup = now
                if now - last_reaper >= 60.0:
                    self._reap_orphans()
                    last_reaper = now

        self._drain_in_flight()

    def _drain_in_flight(self) -> None:
        """Wait for all running subprocesses to finish before exiting."""
        if not self._in_flight:
            return
        log.info("Draining %d in-flight tasks before exit...", len(self._in_flight))
        deadline = time.monotonic() + self.timeout_s
        while self._in_flight and time.monotonic() < deadline:
            self._reap_finished()
            time.sleep(0.5)
        if self._in_flight:
            log.warning("Killing %d tasks that didn't finish during drain.", len(self._in_flight))
            for ift in self._in_flight.values():
                ift.proc.kill()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="PearlOS headless task worker")
    p.add_argument("--api", default=os.getenv("PEARL_TASKS_API", "http://localhost:4444/api/tasks"))
    p.add_argument("--assignee", default=os.getenv("PEARL_WORKER_ASSIGNEE", "claude_cli"))
    p.add_argument("--interval", type=float, default=5.0)
    p.add_argument("--max", type=int, default=0, help="exit after this many completions (0=forever)")
    p.add_argument("--concurrency", type=int, default=2, help="max parallel boss subprocesses")
    p.add_argument("--timeout", type=float, default=1500.0, help="per-task timeout in seconds")
    p.add_argument(
        "--executor",
        default=os.getenv("PEARL_WORKER_EXECUTOR", ""),
        help='"claude" or "codex" for Agency Boss mode; "agency" reads config/env; any other string = shell command; empty = echo stub',
    )
    p.add_argument("--log", default="/tmp/pearl-worker.log", help="log file path")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="claim/execute a single task then exit")
    mode.add_argument("--sse", action="store_true", help="SSE push mode (production)")
    p.add_argument("--dry-run", action="store_true", help="claim + echo + leave in_progress; do not complete")
    args = p.parse_args(argv)

    _setup_logging(args.log)
    executor_val: Optional[str] = _resolve_executor(args.executor or None)
    log.info(
        "pearl-worker starting up — executor=%r requested=%r log=%s",
        executor_val or "stub",
        args.executor or "stub",
        args.log,
    )

    secret = _load_task_secret()
    api = TaskAPI(args.api, secret=secret)

    worker = Worker(
        api=api,
        assignee=args.assignee,
        executor=executor_val,
        dry_run=args.dry_run,
        concurrency=args.concurrency,
        timeout_s=args.timeout,
    )
    signal.signal(signal.SIGTERM, worker.request_stop)
    signal.signal(signal.SIGINT, worker.request_stop)

    if args.once:
        worked = worker.run_once()
        # Brief wait for async claude subprocess if spawned.
        if worker._in_flight:
            log.info("Waiting for in-flight subprocess to finish...")
            worker._drain_in_flight()
        log.info("once: worked=%s completed=%d", worked, worker.completed)
        return 0 if worked else 1
    if args.sse:
        worker.run_sse(max_tasks=args.max)
    else:
        worker.run_polling(interval=args.interval, max_tasks=args.max)
    return 0


if __name__ == "__main__":
    sys.exit(main())
