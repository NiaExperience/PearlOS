#!/usr/bin/env python3
"""Persistent WebChat Team QA/orchestration loop.

Runs one cycle by default, or loops forever with --loop. Each cycle:
- posts status to Agency Chat (visible in PearlOS webchat/active jobs)
- posts status and screenshots to Discord #blair-lagoon
- runs quick webchat model/tool QA
- runs Playwright login/UI screenshot QA on early/failing cycles

The "team" is represented as durable lanes with explicit responsibilities.
Actual remediation still goes through the source-of-truth repo and normal
build/deploy rules; this service coordinates QA and reporting.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path("/workspace/nia-universal")
DEPLOY_ROOT = Path("/home/deploy/pearlos")
STATE_PATH = Path("/tmp/webchat-team-state.json")
LOG_PATH = Path("/tmp/webchat-team.log")
LOCK_PATH = Path("/tmp/webchat-team.lock")

AGENCY_CHAT_URL = "http://127.0.0.1:4444/api/agency-chat/messages"
DISCORD_API = "https://discord.com/api/v10"
DISCORD_BLAIR_LAGOON = "1482123068854763642"
DEFAULT_INTERVAL_SECONDS = 600
DEFAULT_MAX_DISCORD_SCREENSHOTS = 1

TEAM = [
    ("Codex", "lead/orchestrator", "turn findings into source changes, verify builds, keep the loop honest"),
    ("Kimi 2.5", "memory/continuity", "watch regressions across cycles and preserve context"),
    ("Claude CLI", "implementation", "handle bounded code fixes through the Agency path when a clear bug is found"),
    ("DeepSeek v4 Pro", "adversarial QA", "attack tool-call, file, image, and latency failure modes"),
    ("GLM 5.1", "UX/reviewer", "judge screenshots and interaction quality from the user's point of view"),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def log(message: str) -> None:
    line = f"[{now_iso()}] {message}"
    print(line, flush=True)
    try:
        LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LOG_PATH.open("a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        for raw in path.read_text().splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    except FileNotFoundError:
        pass
    return values


ENV_CACHE: dict[str, str] | None = None


def env(name: str, default: str = "") -> str:
    global ENV_CACHE
    direct = os.getenv(name, "").strip()
    if direct:
        return direct
    if ENV_CACHE is None:
        ENV_CACHE = {}
        for path in [
            ROOT / ".env.local",
            ROOT / "apps/interface/.env.local",
            ROOT / "apps/pipecat-daily-bot/.env",
            DEPLOY_ROOT / ".env.local",
            DEPLOY_ROOT / "apps/interface/.env.local",
            DEPLOY_ROOT / "apps/pipecat-daily-bot/.env",
        ]:
            ENV_CACHE.update(read_env_file(path))
    return ENV_CACHE.get(name, default).strip()


def load_state() -> dict[str, Any]:
    try:
        return json.loads(STATE_PATH.read_text())
    except Exception:
        return {
            "started_at": now_iso(),
            "cycle": 0,
            "consecutive_green": 0,
            "last_playwright_cycle": 0,
            "history": [],
        }


def save_state(state: dict[str, Any]) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True))


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, timeout: int = 15) -> tuple[int, str]:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode(errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")
    except Exception as exc:
        return 0, str(exc)


def post_agency(body: str, msg_type: str = "summary", severity: str = "info") -> None:
    secret = env("BOT_CONTROL_SHARED_SECRET")
    headers = {"x-bot-secret": secret} if secret else {}
    code, text = post_json(
        AGENCY_CHAT_URL,
        {
            "speaker": "Codex",
            "body": body[:1900],
            "type": msg_type,
            "severity": severity,
            "metadata": {"team": "WebChat Team", "source": "webchat-team-cycle"},
        },
        headers=headers,
    )
    if code not in (200, 201):
        log(f"agency chat post failed: {code} {text[:160]}")


def discord_token() -> str:
    return env("DISCORD_BOT_TOKEN")


def post_discord(content: str) -> None:
    if env("WEBCHAT_TEAM_DISCORD_TEXT", "0").lower() not in ("1", "true", "yes"):
        log("WEBCHAT_TEAM_DISCORD_TEXT disabled; skipping Discord text post")
        return
    token = discord_token()
    if not token:
        log("DISCORD_BOT_TOKEN missing; skipping Discord text post")
        return
    code, text = post_json(
        f"{DISCORD_API}/channels/{DISCORD_BLAIR_LAGOON}/messages",
        {"content": content[:1900]},
        headers={"Authorization": f"Bot {token}", "User-Agent": "DiscordBot (WebChatTeam, 1.0)"},
    )
    if code not in (200, 201):
        log(f"discord post failed: {code} {text[:160]}")


def upload_discord_file(path: Path, content: str = "") -> None:
    if env("WEBCHAT_TEAM_DISCORD_SCREENSHOTS", "0").lower() not in ("1", "true", "yes"):
        log("WEBCHAT_TEAM_DISCORD_SCREENSHOTS disabled; skipping Discord screenshot upload")
        return
    token = discord_token()
    if not token or not path.exists():
        return
    boundary = f"----pearl-webchat-team-{int(time.time())}"
    file_bytes = path.read_bytes()
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="content"\r\n\r\n'
        f"{content[:500]}\r\n"
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{path.name}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"{DISCORD_API}/channels/{DISCORD_BLAIR_LAGOON}/messages",
        data=head + file_bytes + tail,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (WebChatTeam, 1.0)",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            if resp.status not in (200, 201):
                log(f"discord upload returned {resp.status}")
    except Exception as exc:
        log(f"discord upload failed for {path}: {exc}")


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def unique_screenshots_for_upload(state: dict[str, Any], screenshots: list[Path]) -> list[Path]:
    seen = set(state.get("uploaded_screenshot_hashes") or [])
    unique: list[Path] = []
    duplicate_count = 0
    for shot in screenshots:
        try:
            digest = file_sha256(shot)
        except Exception as exc:
            log(f"could not hash screenshot {shot}: {exc}")
            continue
        if digest in seen:
            duplicate_count += 1
            continue
        seen.add(digest)
        unique.append(shot)
    state["uploaded_screenshot_hashes"] = list(seen)[-200:]
    state["last_duplicate_screenshot_count"] = duplicate_count
    if duplicate_count:
        log(f"suppressed {duplicate_count} duplicate screenshot upload(s)")
    try:
        max_count = int(env("WEBCHAT_TEAM_MAX_DISCORD_SCREENSHOTS", str(DEFAULT_MAX_DISCORD_SCREENSHOTS)) or DEFAULT_MAX_DISCORD_SCREENSHOTS)
    except ValueError:
        max_count = DEFAULT_MAX_DISCORD_SCREENSHOTS
    return unique[: max(0, max_count)]


def run_cmd(cmd: list[str], timeout: int, env_overrides: dict[str, str] | None = None) -> tuple[int, str]:
    proc_env = os.environ.copy()
    proc_env.update(env_overrides or {})
    proc_env.setdefault("CI", "1")
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            env=proc_env,
        )
        return proc.returncode, proc.stdout
    except subprocess.TimeoutExpired as exc:
        return 124, (exc.stdout or "") + f"\nTIMEOUT after {timeout}s"
    except Exception as exc:
        return 127, str(exc)


def latest_json_report() -> dict[str, Any] | None:
    reports = sorted(glob.glob("/workspace/user/Documents/webchat-qa/webchat-qa-*.json"))
    if not reports:
        return None
    try:
        return json.loads(Path(reports[-1]).read_text())
    except Exception:
        return None


def run_quick_qa() -> dict[str, Any]:
    code, output = run_cmd(["python3", "scripts/webchat-qa-test.py", "--quick"], timeout=180)
    report = latest_json_report() or {}
    return {
        "exit_code": code,
        "output": output[-3000:],
        "total": report.get("total", 0),
        "passed": report.get("passed", 0),
        "failed": report.get("failed", 0),
        "pass_rate": report.get("pass_rate", 0),
        "avg_latency_ms": report.get("avg_latency_ms", 0),
        "tool_accuracy": report.get("tool_accuracy", "0/0"),
        "failures": [
            f"{r.get('category')}: {r.get('desc')}"
            for r in report.get("results", [])
            if not r.get("passed")
        ][:5],
    }


def should_run_playwright(state: dict[str, Any], quick: dict[str, Any]) -> bool:
    cycle = int(state.get("cycle", 0))
    if cycle <= 2:
        return True
    if int(quick.get("pass_rate") or 0) < 90:
        return True
    consecutive_green = int(state.get("consecutive_green", 0))
    last = int(state.get("last_playwright_cycle", 0))
    if consecutive_green < 3:
        return cycle - last >= 2
    return cycle - last >= 6


def run_playwright(cycle: int) -> dict[str, Any]:
    run_id = f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-cycle{cycle}"
    shot_dir = ROOT / "qa/screenshots" / f"webchat-team-{run_id}"
    if shot_dir.exists():
        shutil.rmtree(shot_dir)
    shot_dir.mkdir(parents=True, exist_ok=True)
    started_at = time.time()
    code, output = run_cmd(
        [
            "npx",
            "playwright",
            "test",
            "tests/e2e/web-chat-tool-proof.spec.ts",
            "--config",
            "tests/e2e/playwright.config.ts",
            "--reporter=list",
        ],
        timeout=12 * 60,
        env_overrides={
            "PEARLOS_URL": env("NEXT_PUBLIC_INTERFACE_URL", "https://134-209-76-227.sslip.io"),
            "PEARLOS_QA_RUN_ID": run_id,
            "PEARLOS_QA_SCREENSHOT_DIR": str(shot_dir),
            "PEARLOS_TEST_EMAIL": env("PEARLOS_TEST_EMAIL", "webchat-qa@pearlos.local"),
            "PEARLOS_TEST_USER_ID": env("PEARLOS_TEST_USER_ID", "webchat-qa-user"),
            "PEARL_PRIMARY_USER_EMAIL": env("PEARL_PRIMARY_USER_EMAIL", "blairerickson@gmail.com"),
            "NEXTAUTH_SECRET": env("NEXTAUTH_SECRET"),
        },
    )
    shots = sorted(shot_dir.glob("*.png"))
    if not shots:
        test_results = ROOT / "tests/e2e/test-results"
        for failure in sorted(test_results.glob("**/test-failed-*.png")):
            if failure.stat().st_mtime < started_at:
                continue
            copied = shot_dir / f"failure-{failure.parent.name}-{failure.name}"
            shutil.copy2(failure, copied)
            shots.append(copied)
    return {
        "exit_code": code,
        "output": output[-3500:],
        "screenshot_dir": str(shot_dir),
        "screenshots": [str(p) for p in shots],
    }


def summarize_cycle(cycle: int, quick: dict[str, Any], playwright: dict[str, Any] | None) -> tuple[str, str]:
    qa_status = "green" if quick.get("exit_code") == 0 and int(quick.get("pass_rate") or 0) >= 90 else "red"
    pw_status = "not run"
    pw_reason = ""
    if playwright:
        pw_status = "passed" if playwright.get("exit_code") == 0 else "failed"
        if playwright.get("exit_code") != 0:
            interesting = [
                line.strip()
                for line in str(playwright.get("output") or "").splitlines()
                if re.search(r"(Error:|TimeoutError|expected|locator|Test timeout|failed)", line, re.I)
            ]
            if interesting:
                pw_reason = f" Playwright detail: {interesting[-1][:220]}."
    failures = quick.get("failures") or []
    failure_text = "; ".join(failures[:3]) if failures else "none"
    team_lines = "\n".join(f"- {name}: {role}" for name, role, _ in TEAM)
    web = (
        f"WebChat Team cycle {cycle}: quick QA {qa_status} "
        f"({quick.get('passed')}/{quick.get('total')} passed, {quick.get('pass_rate')}%, "
        f"avg {quick.get('avg_latency_ms')}ms, tools {quick.get('tool_accuracy')}). "
        f"Playwright screenshots: {pw_status}.{pw_reason} Failures: {failure_text}."
    )
    discord = (
        f"**WebChat Team cycle {cycle}**\n"
        f"Quick QA: **{qa_status}** - {quick.get('passed')}/{quick.get('total')} passed "
        f"({quick.get('pass_rate')}%), avg {quick.get('avg_latency_ms')}ms, tools {quick.get('tool_accuracy')}.\n"
        f"Playwright/login/screenshots: **{pw_status}**.{pw_reason}\n"
        f"Failures: {failure_text}.\n\n"
        f"Active lanes:\n{team_lines}"
    )
    return web, discord


def run_cycle() -> int:
    if LOCK_PATH.exists():
        try:
            pid = int(LOCK_PATH.read_text().strip())
            os.kill(pid, 0)
            log(f"another cycle is already running under pid {pid}; exiting")
            return 0
        except Exception:
            pass
    LOCK_PATH.write_text(str(os.getpid()))
    try:
        state = load_state()
        state["cycle"] = int(state.get("cycle", 0)) + 1
        cycle = int(state["cycle"])
        log(f"cycle {cycle} starting")

        if cycle == 1:
            roster = "; ".join(f"{name}={role}" for name, role, _ in TEAM)
            kickoff = (
                "WebChat Team is live. Cadence is every 10 minutes at first, "
                "with screenshots and Discord/Agency Chat updates. Roster: " + roster + "."
            )
            post_agency(kickoff, msg_type="action")
            post_discord("**WebChat Team is live.** 10-minute cadence started. " + roster)

        quick = run_quick_qa()
        playwright = None
        if should_run_playwright(state, quick):
            playwright = run_playwright(cycle)
            state["last_playwright_cycle"] = cycle

        green = quick.get("exit_code") == 0 and int(quick.get("pass_rate") or 0) >= 90
        if playwright is not None:
            green = green and playwright.get("exit_code") == 0
        state["consecutive_green"] = int(state.get("consecutive_green", 0)) + 1 if green else 0

        web, discord = summarize_cycle(cycle, quick, playwright)
        post_agency(web, msg_type="summary", severity="info" if green else "warn")
        post_discord(discord)

        if playwright and playwright.get("screenshots"):
            screenshots = unique_screenshots_for_upload(state, [Path(p) for p in playwright["screenshots"]])
            for shot in screenshots:
                upload_discord_file(shot, f"WebChat Team cycle {cycle}: {shot.name}")

        state.setdefault("history", []).append(
            {
                "cycle": cycle,
                "timestamp": now_iso(),
                "green": green,
                "quick": {k: quick.get(k) for k in ("exit_code", "passed", "total", "pass_rate", "avg_latency_ms", "tool_accuracy")},
                "playwright": None
                if playwright is None
                else {
                    "exit_code": playwright.get("exit_code"),
                    "screenshot_dir": playwright.get("screenshot_dir"),
                    "screenshot_count": len(playwright.get("screenshots") or []),
                },
            }
        )
        state["history"] = state["history"][-30:]
        state["updated_at"] = now_iso()
        save_state(state)
        log(f"cycle {cycle} complete green={green}")
        return 0 if green else 1
    finally:
        try:
            LOCK_PATH.unlink()
        except FileNotFoundError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--loop", action="store_true")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL_SECONDS)
    args = parser.parse_args()

    if not args.loop:
        return run_cycle()

    post_agency("WebChat Team service loop started.", msg_type="heartbeat")
    while True:
        try:
            run_cycle()
        except Exception as exc:
            log(f"cycle crashed: {exc}")
            post_agency(f"WebChat Team cycle crashed: {exc}", msg_type="issue", severity="critical")
            post_discord(f"**WebChat Team issue:** cycle crashed: `{exc}`")
        time.sleep(max(60, args.interval))


if __name__ == "__main__":
    sys.exit(main())
