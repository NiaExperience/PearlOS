#!/usr/bin/env python3
"""
Smoke test for the bot → frontend tool fire pipeline.

Subscribes to the gateway WebSocket at ws://localhost:4444/ws/events,
invokes a configurable set of view / desktop / window tools via
POST /api/tools/invoke, and asserts that an `nia.event` envelope arrives
on the WS within a short timeout. Used to catch silent regressions where
a tool runs but no event reaches the browser.

Usage:
    python tool-fire-smoketest.py                  # run the default suite
    python tool-fire-smoketest.py --tool open_terminal
    python tool-fire-smoketest.py --gateway http://localhost:4444 --timeout 5

Exit code is non-zero if any tool fails to broadcast.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import urllib.request
import urllib.error

try:
    import websockets  # type: ignore
except ImportError:
    print("ERROR: requires the `websockets` package. Install with:")
    print("  pip install websockets")
    sys.exit(2)


@dataclass
class ToolCase:
    """One tool to invoke + the event names we expect to see emitted."""
    label: str
    tool_name: str
    params: dict[str, Any] = field(default_factory=dict)
    expected_events: tuple[str, ...] = ()


# ── Default suite ────────────────────────────────────────────────────────
# Each case fires a real bot tool and lists the event types we expect to
# see broadcast. Add new cases as new tools land. Acceptance is "at least
# one of expected_events arrived within --timeout seconds".
DEFAULT_SUITE: list[ToolCase] = [
    ToolCase(
        label="open terminal",
        tool_name="bot_open_terminal",
        expected_events=("app.open",),
    ),
    ToolCase(
        label="close terminal",
        tool_name="bot_close_terminal",
        expected_events=("apps.close",),
    ),
    ToolCase(
        label="open notes",
        tool_name="bot_open_notes",
        expected_events=("app.open",),
    ),
    ToolCase(
        label="close notes",
        tool_name="bot_close_notes",
        expected_events=("apps.close",),
    ),
    ToolCase(
        label="switch desktop mode → desktop",
        tool_name="bot_switch_desktop_mode",
        params={"mode": "desktop"},
        expected_events=("desktop.mode.switch",),
    ),
    ToolCase(
        label="switch desktop mode → home",
        tool_name="bot_switch_desktop_mode",
        params={"mode": "home"},
        expected_events=("desktop.mode.switch",),
    ),
    ToolCase(
        label="open news",
        tool_name="bot_open_news",
        expected_events=("wonder.scene",),
    ),
    ToolCase(
        label="open creation engine",
        tool_name="bot_open_creation_engine",
        expected_events=("app.open",),
    ),
    ToolCase(
        label="close browser window (no apps → safe fallback)",
        tool_name="bot_close_browser_window",
        params={},
        expected_events=("apps.close", "wonder.clear"),
    ),
    ToolCase(
        label="close browser window (apps=['terminal'])",
        tool_name="bot_close_browser_window",
        params={"apps": ["terminal"]},
        expected_events=("apps.close",),
    ),
]


def _post_invoke(gateway: str, case: ToolCase, timeout: float) -> tuple[bool, str]:
    """POST /api/tools/invoke and return (ok, detail)."""
    url = f"{gateway.rstrip('/')}/api/tools/invoke"
    body = json.dumps({"tool_name": case.tool_name, "params": case.params}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8", errors="replace")
            return True, f"HTTP {resp.status}: {payload[:200]}"
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace") if e.fp else ""
        return False, f"HTTP {e.code}: {detail[:200]}"
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


async def _collect_events(ws_url: str, duration: float) -> list[dict]:
    """Subscribe to the gateway WS and collect every parsed message
    until `duration` seconds elapses or the socket closes."""
    events: list[dict] = []
    deadline = asyncio.get_event_loop().time() + duration
    try:
        async with websockets.connect(ws_url, open_timeout=5, close_timeout=2) as ws:
            while True:
                remaining = deadline - asyncio.get_event_loop().time()
                if remaining <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
                except asyncio.TimeoutError:
                    break
                try:
                    events.append(json.loads(raw))
                except (json.JSONDecodeError, TypeError):
                    continue
    except Exception as e:
        print(f"  [ws] subscribe error: {e}", file=sys.stderr)
    return events


def _matched(events: list[dict], expected: tuple[str, ...]) -> list[str]:
    """Return the list of expected event names actually seen in the stream."""
    if not expected:
        return []
    seen_event_names: set[str] = set()
    for e in events:
        kind = e.get("kind")
        ev = e.get("event")
        if isinstance(ev, str):
            seen_event_names.add(ev)
        if kind == "nia.tool_result":
            seen_event_names.add("nia.tool_result")
    return [name for name in expected if name in seen_event_names]


async def _run_case(gateway: str, ws_url: str, case: ToolCase, timeout: float) -> bool:
    """Run a single tool case. Returns True on pass."""
    print(f"\n● {case.label}  [tool={case.tool_name}]")
    collector = asyncio.create_task(_collect_events(ws_url, timeout))
    # Give the WS a beat to actually connect before we fire.
    await asyncio.sleep(0.3)

    invoke_ok, invoke_detail = await asyncio.get_event_loop().run_in_executor(
        None, _post_invoke, gateway, case, timeout
    )
    print(f"  invoke: {'ok' if invoke_ok else 'FAIL'} — {invoke_detail}")
    if not invoke_ok:
        collector.cancel()
        return False

    events = await collector
    matches = _matched(events, case.expected_events)
    expected_str = ", ".join(case.expected_events) if case.expected_events else "(no event check)"

    if not case.expected_events:
        print(f"  events: {len(events)} envelope(s) seen — no expectation to check")
        return True

    if matches:
        print(f"  events: {len(events)} envelope(s); matched expected → {matches}")
        return True

    print(
        f"  events: {len(events)} envelope(s); expected one of [{expected_str}] — none arrived"
    )
    if events:
        sample = [e.get("event") or e.get("kind") for e in events[:5]]
        print(f"    seen events sample: {sample}")
    return False


async def main_async(args: argparse.Namespace) -> int:
    ws_url = args.gateway.rstrip("/").replace("http", "ws", 1) + "/ws/events"

    suite = DEFAULT_SUITE
    if args.tool:
        suite = [c for c in DEFAULT_SUITE if c.tool_name.endswith(args.tool) or c.label == args.tool]
        if not suite:
            print(f"No matching tool case for --tool {args.tool!r}", file=sys.stderr)
            return 2

    print(f"Gateway:    {args.gateway}")
    print(f"WebSocket:  {ws_url}")
    print(f"Cases:      {len(suite)}")
    print(f"Timeout/case: {args.timeout}s")

    started = time.monotonic()
    results: list[tuple[str, bool]] = []
    for case in suite:
        ok = await _run_case(args.gateway, ws_url, case, args.timeout)
        results.append((case.label, ok))

    elapsed = time.monotonic() - started
    passed = sum(1 for _, ok in results if ok)
    failed = [label for label, ok in results if not ok]
    print(f"\n──────────────────────────────────────────────")
    print(f"Total: {len(results)}  Passed: {passed}  Failed: {len(failed)}  ({elapsed:.1f}s)")
    if failed:
        print("Failures:")
        for label in failed:
            print(f"  ✗ {label}")
        return 1
    print("All cases passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--gateway",
        default="http://localhost:4444",
        help="Bot gateway base URL (default: http://localhost:4444)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=4.0,
        help="Seconds to wait per tool for events to arrive (default: 4)",
    )
    parser.add_argument(
        "--tool",
        default=None,
        help="Only run cases for the given tool name (suffix match) or label",
    )
    args = parser.parse_args()
    try:
        return asyncio.run(main_async(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
