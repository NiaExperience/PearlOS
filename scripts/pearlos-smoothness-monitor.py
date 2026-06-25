#!/usr/bin/env python3
import warnings
warnings.filterwarnings("ignore", category=DeprecationWarning)
"""
PearlOS Smoothness Monitor - runs every 5 minutes via cron.

Watches for the failure modes that have been killing Pearl's responsiveness:
  - Session bloat (auto-trims sessions over 150KB)
  - Model timeout patterns (alerts on >3 timeouts in 5min)
  - Queue lag (alerts on tasks stuck in_progress >30min)
  - Gateway memory bloat (alerts on >1.5GB)
  - Restart loops (alerts on >3 restarts in 5min)
  - System load (alerts on load avg >25)

Alerts go to #blair-lagoon, throttled to one alert per issue per hour.
Auto-fixes the safe stuff (session trim) without asking.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from pathlib import Path

# === Config ===
SESSION_BLOAT_KB = 150
SESSION_TRIM_TO_ENTRIES = 25
GATEWAY_MEMORY_LIMIT_MB = 1500
LOAD_AVG_THRESHOLD = 25.0
TIMEOUT_THRESHOLD_5MIN = 3
RESTART_RATE_THRESHOLD_5MIN = 3
QUEUE_LAG_MINUTES = 30

AGENTS_ROOT = "/root/.openclaw/agents"
SESSIONS_DIR = "/root/.openclaw/agents/main/sessions"  # legacy, kept for compat
GATEWAY_LOG = "/root/.pm2/logs/openclaw-gateway-error.log"
STATE_FILE = "/tmp/pearlos-smoothness-state.json"
LOG_FILE = "/tmp/pearlos-smoothness.log"
LOCKFILE = "/tmp/pearlos-smoothness.lock"

DISCORD_CHANNEL = "1494906069149941921"  # #pearl-omega
ALERT_THROTTLE_SECONDS = 3600  # 1 hour per issue type

OPENCLAW_CONFIGS = (
    "/home/deploy/.openclaw/openclaw.json",
    "/home/deploy/.openclaw/relay-openclaw.json",
    "/root/.openclaw/openclaw.json",
)
TASKS_API = "http://localhost:4444/api/tasks"


def log(msg):
    ts = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_FILE, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_state():
    try:
        with open(STATE_FILE) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"last_alert": {}, "last_restart_counts": {}}


def save_state(state):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        log(f"failed to save state: {e}")


def get_discord_token():
    for path in OPENCLAW_CONFIGS:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                cfg = json.load(handle)
            token = (
                cfg.get("channels", {}).get("discord", {}).get("token")
                or cfg.get("env", {}).get("DISCORD_BOT_TOKEN")
            )
            if token:
                return token
        except Exception:
            continue
    return os.getenv("DISCORD_BOT_TOKEN") or None


def alert(state, issue_type, message):
    """Send a Discord alert, throttled to one per issue type per hour."""
    now = time.time()
    last = state.setdefault("last_alert", {}).get(issue_type, 0)
    if now - last < ALERT_THROTTLE_SECONDS:
        log(f"alert suppressed (throttled): {issue_type}: {message}")
        return False

    token = get_discord_token()
    if not token:
        log(f"no Discord token, skipping alert: {message}")
        return False

    payload = json.dumps({
        "content": f"**Smoothness Monitor Alert:** {message}"
    }).encode()

    req = urllib.request.Request(
        f"https://discord.com/api/v10/channels/{DISCORD_CHANNEL}/messages",
        data=payload,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (PearlOS, 1.0)",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            if resp.status in (200, 201):
                state["last_alert"][issue_type] = now
                log(f"alert sent: {issue_type}: {message}")
                return True
            else:
                log(f"alert failed (status {resp.status}): {message}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        log(f"alert request failed: {e}")
    return False


# === Session Bloat ===
def iter_session_files():
    """Yield (agent_name, session_path) for all sessions across all agents."""
    if not os.path.isdir(AGENTS_ROOT):
        return
    for agent_name in os.listdir(AGENTS_ROOT):
        sessions_dir = os.path.join(AGENTS_ROOT, agent_name, "sessions")
        if not os.path.isdir(sessions_dir):
            continue
        for entry in os.listdir(sessions_dir):
            if not entry.endswith(".jsonl") or ".bak." in entry or ".deleted." in entry or ".reset." in entry:
                continue
            yield agent_name, os.path.join(sessions_dir, entry)


def check_session_bloat(state):
    """Find sessions over threshold across ALL agents, trim them, alert if any were giant."""
    trimmed = []
    huge = []

    for agent_name, path in iter_session_files():
        entry = os.path.basename(path)
        try:
            size_kb = os.path.getsize(path) / 1024
        except OSError:
            continue

        if size_kb < SESSION_BLOAT_KB:
            continue

        # Trim it
        try:
            with open(path) as f:
                lines = f.readlines()
            if len(lines) <= SESSION_TRIM_TO_ENTRIES + 1:
                continue

            # Backup
            backup = f"{path}.bak.{int(time.time())}"
            shutil.copy(path, backup)

            # Keep header + last N entries
            header = [lines[0]]
            keep_from = max(1, len(lines) - SESSION_TRIM_TO_ENTRIES)
            kept = header + lines[keep_from:]

            # Strip trailing prompt-error / bootstrap-context
            while kept:
                try:
                    last = json.loads(kept[-1])
                    t = last.get("type", "")
                    ct = last.get("customType", "")
                    if t == "custom" and ("prompt-error" in ct or "bootstrap-context" in ct):
                        kept.pop()
                        continue
                except (json.JSONDecodeError, IndexError):
                    pass
                break

            with open(path, "w") as f:
                f.writelines(kept)

            new_size_kb = os.path.getsize(path) / 1024
            sid = entry.replace(".jsonl", "")[:12]
            trimmed.append(f"{agent_name}:{sid} {size_kb:.0f}KB->{new_size_kb:.0f}KB")
            if size_kb > 500:
                huge.append(f"{agent_name}:{sid} ({size_kb:.0f}KB)")
        except Exception as e:
            log(f"failed to trim {entry}: {e}")

    if trimmed:
        log(f"trimmed {len(trimmed)} bloated sessions: {', '.join(trimmed)}")
    if huge:
        alert(state, "huge_session", f"Trimmed massive sessions causing slow responses: {', '.join(huge)}")


# === Model Timeout Pattern ===
def check_model_timeouts(state):
    """Count model timeouts in the last 5 minutes."""
    if not os.path.isfile(GATEWAY_LOG):
        return

    cutoff = datetime.utcnow() - timedelta(minutes=5)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S")

    timeouts = 0
    failed_models = set()
    try:
        # Read last 1000 lines for performance
        result = subprocess.run(
            ["tail", "-1000", GATEWAY_LOG],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.splitlines():
            if "FailoverError: LLM request timed out" not in line:
                continue
            # Extract timestamp from start of line
            m = re.match(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})", line)
            if m and m.group(1) >= cutoff_str:
                timeouts += 1
                # Extract model name
                mm = re.search(r"requested=(\S+)", line)
                if mm:
                    failed_models.add(mm.group(1))
    except subprocess.TimeoutExpired:
        log("timeout scanning gateway log")
        return

    log(f"model timeouts in last 5min: {timeouts}")
    if timeouts >= TIMEOUT_THRESHOLD_5MIN:
        alert(state, "model_timeouts",
              f"{timeouts} LLM timeouts in last 5 minutes. Models affected: {', '.join(failed_models) or 'unknown'}. DeepSeek may be throttled, check fallback chain.")


# === Queue Lag ===
def check_queue_lag(state):
    """Find tasks stuck in_progress for too long."""
    try:
        with urllib.request.urlopen(TASKS_API, timeout=5) as resp:
            data = json.load(resp)
        tasks = data if isinstance(data, list) else data.get("tasks", data.get("data", []))
    except Exception as e:
        log(f"failed to fetch tasks: {e}")
        return

    cutoff = datetime.utcnow() - timedelta(minutes=QUEUE_LAG_MINUTES)
    stuck = []
    for t in tasks:
        if t.get("status") != "in_progress":
            continue
        created = t.get("timestamp_created", "")
        try:
            ct = datetime.strptime(created[:19], "%Y-%m-%dT%H:%M:%S")
            if ct < cutoff:
                stuck.append((t.get("id", "?")[:25], t.get("title", "?")[:40],
                              int((datetime.utcnow() - ct).total_seconds() / 60)))
        except ValueError:
            pass

    if stuck:
        log(f"{len(stuck)} stuck tasks: {stuck}")
        if len(stuck) >= 3:
            preview = "; ".join(f"{tid} ({mins}min): {title}" for tid, title, mins in stuck[:3])
            alert(state, "queue_lag",
                  f"{len(stuck)} tasks stuck in_progress >{QUEUE_LAG_MINUTES}min. Queue worker may be backed up. Preview: {preview}")


# === Gateway Memory ===
def check_gateway_memory(state):
    """Alert if openclaw-gateway memory exceeds threshold."""
    try:
        result = subprocess.run(
            ["pm2", "jlist"],
            capture_output=True, text=True, timeout=10
        )
        procs = json.loads(result.stdout)
    except Exception as e:
        log(f"failed to read pm2: {e}")
        return

    for p in procs:
        name = p.get("name", "")
        if name in ("openclaw-gateway", "pipecat-runner", "interface"):
            mem_mb = p.get("monit", {}).get("memory", 0) / (1024 * 1024)
            log(f"{name}: {mem_mb:.0f}MB")
            if name == "openclaw-gateway" and mem_mb > GATEWAY_MEMORY_LIMIT_MB:
                alert(state, "gateway_memory",
                      f"OpenClaw gateway at {mem_mb:.0f}MB (threshold {GATEWAY_MEMORY_LIMIT_MB}MB). Likely memory leak, may cause restart.")


# === Restart Rate ===
def check_restart_rates(state):
    """Detect when a process is in a restart loop."""
    try:
        result = subprocess.run(
            ["pm2", "jlist"],
            capture_output=True, text=True, timeout=10
        )
        procs = json.loads(result.stdout)
    except Exception as e:
        log(f"failed to read pm2: {e}")
        return

    last_counts = state.setdefault("last_restart_counts", {})
    new_counts = {}

    for p in procs:
        name = p.get("name", "")
        restarts = p.get("pm2_env", {}).get("restart_time", 0)
        new_counts[name] = restarts
        prev = last_counts.get(name, restarts)
        delta = restarts - prev
        if delta >= RESTART_RATE_THRESHOLD_5MIN:
            alert(state, f"restart_loop_{name}",
                  f"Process **{name}** restarted {delta} times in last 5min (now at {restarts} total). Crash loop detected.")

    state["last_restart_counts"] = new_counts


# === System Load ===
def check_system_load(state):
    """Alert when load average is too high."""
    try:
        with open("/proc/loadavg") as f:
            parts = f.read().split()
        load_1min = float(parts[0])
        load_5min = float(parts[1])
        log(f"load avg: 1min={load_1min} 5min={load_5min}")
        if load_5min > LOAD_AVG_THRESHOLD:
            alert(state, "high_load",
                  f"System load avg (5min) is {load_5min}. Likely I/O wait or process churn. Pearl responses may be slow.")
    except Exception as e:
        log(f"failed to read load: {e}")


# === Main ===
def main():
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
        state = load_state()

        check_session_bloat(state)
        check_model_timeouts(state)
        check_queue_lag(state)
        check_gateway_memory(state)
        check_restart_rates(state)
        check_system_load(state)

        save_state(state)
    finally:
        try:
            os.remove(LOCKFILE)
        except OSError:
            pass


if __name__ == "__main__":
    main()
