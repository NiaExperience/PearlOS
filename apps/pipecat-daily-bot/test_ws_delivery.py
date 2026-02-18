#!/usr/bin/env python3
"""
test_ws_delivery.py — Automated WebSocket event delivery test for:
  - bot_wonder_canvas_scene
  - bot_end_call

Tests that REST API tool invocations actually produce WebSocket events.

Usage:
    python test_ws_delivery.py [--gateway http://localhost:4444]

Requirements:
    pip install websockets httpx

Headless — no browser required.
"""

import asyncio
import json
import sys
import time
import argparse
import httpx
import websockets


GATEWAY_URL = "http://localhost:4444"
TIMEOUT_SECS = 5.0  # How long to wait for a WS event after REST call


def _derive_ws_url(gateway_url: str) -> str:
    """Derive WebSocket URL from gateway HTTP URL."""
    ws_url = gateway_url.replace("https://", "wss://").replace("http://", "ws://")
    return f"{ws_url}/ws/events"


async def collect_ws_events(ws_url: str, expected_events: list[str], timeout: float = TIMEOUT_SECS) -> dict:
    """
    Connect to WebSocket and collect events until all expected events are seen or timeout.
    
    Returns: {"received": [...events...], "missing": [...expected not seen...]}
    """
    received = []
    seen_event_types = set()
    remaining = set(expected_events)
    deadline = asyncio.get_event_loop().time() + timeout

    try:
        async with websockets.connect(ws_url, open_timeout=3) as ws:
            while remaining and asyncio.get_event_loop().time() < deadline:
                wait_for = max(0.1, deadline - asyncio.get_event_loop().time())
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=wait_for)
                    data = json.loads(msg)
                    received.append(data)
                    kind = data.get("kind", "")
                    event = data.get("event", "")
                    tool = data.get("tool_name", "")

                    # Check for nia.event matches
                    if kind == "nia.event" and event in remaining:
                        remaining.discard(event)
                        seen_event_types.add(event)

                    # Check for nia.tool_result matches (keyed by tool name)
                    if kind == "nia.tool_result" and tool in remaining:
                        remaining.discard(tool)
                        seen_event_types.add(tool)

                except asyncio.TimeoutError:
                    break
                except websockets.exceptions.ConnectionClosed:
                    break

    except Exception as e:
        return {
            "received": received,
            "missing": list(remaining),
            "error": str(e),
            "connected": False,
        }

    return {
        "received": received,
        "missing": list(remaining),
        "seen": list(seen_event_types),
        "connected": True,
    }


async def test_wonder_canvas_scene(gateway_url: str, ws_url: str) -> bool:
    """
    Test: POST /api/tools/invoke bot_wonder_canvas_scene
    Expected: nia.event wonder.scene arrives on WebSocket
    """
    print("\n" + "="*60)
    print("TEST: bot_wonder_canvas_scene → nia.event wonder.scene")
    print("="*60)

    # Start WS listener BEFORE sending REST request
    ws_task = asyncio.create_task(
        collect_ws_events(ws_url, ["wonder.scene"], timeout=TIMEOUT_SECS)
    )
    await asyncio.sleep(0.2)  # Let WS connect first

    # Send REST invocation
    payload = {
        "tool_name": "bot_wonder_canvas_scene",
        "params": {
            "html": "<div style='background:#1a0e2e;width:100%;height:100%;display:flex;align-items:center;justify-content:center'><h1 style='color:#FFD233;font-family:Georgia'>Test Scene</h1></div>",
            "transition": "fade",
            "layer": "main"
        }
    }

    print(f"  → POST {gateway_url}/api/tools/invoke")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{gateway_url}/api/tools/invoke", json=payload)
            resp_data = resp.json()
            print(f"  ← Status: {resp.status_code}, Response: {json.dumps(resp_data, indent=2)}")

            if resp.status_code != 200 or not resp_data.get("ok"):
                print("  ❌ REST API call failed")
                ws_task.cancel()
                return False

    except Exception as e:
        print(f"  ❌ REST call error: {e}")
        ws_task.cancel()
        return False

    # Wait for WS result
    ws_result = await ws_task
    print(f"\n  WS connection: {'✅ connected' if ws_result.get('connected') else '❌ FAILED'}")
    print(f"  Events received: {len(ws_result.get('received', []))}")

    if not ws_result.get("connected"):
        print(f"  ❌ WebSocket connection error: {ws_result.get('error')}")
        return False

    for ev in ws_result.get("received", []):
        print(f"    → kind={ev.get('kind')}, event={ev.get('event', ev.get('tool_name', 'N/A'))}")

    missing = ws_result.get("missing", [])
    if not missing:
        print("  ✅ PASS: wonder.scene arrived on WebSocket")
        return True
    else:
        print(f"  ❌ FAIL: Expected events NOT received: {missing}")
        print("  Diagnosis: nia.event wonder.scene is only broadcast via WebSocket in")
        print("  _broadcast_tool_event_best_effort. If WS bridge is stopped (during Daily call),")
        print("  or gateway has no WS clients, the event is silently dropped.")
        return False


async def test_bot_end_call(gateway_url: str, ws_url: str) -> bool:
    """
    Test: POST /api/tools/invoke bot_end_call
    Expected: nia.event bot.session.end (or similar) arrives on WebSocket
    """
    print("\n" + "="*60)
    print("TEST: bot_end_call → nia.event bot.session.end")
    print("="*60)

    # Start WS listener BEFORE sending REST request
    ws_task = asyncio.create_task(
        collect_ws_events(ws_url, ["bot.session.end", "bot_end_call"], timeout=TIMEOUT_SECS)
    )
    await asyncio.sleep(0.2)

    payload = {
        "tool_name": "bot_end_call",
        "params": {"reason": "test-automated"}
    }

    print(f"  → POST {gateway_url}/api/tools/invoke")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(f"{gateway_url}/api/tools/invoke", json=payload)
            resp_data = resp.json()
            print(f"  ← Status: {resp.status_code}, Response: {json.dumps(resp_data, indent=2)}")

            if resp.status_code != 200 or not resp_data.get("ok"):
                print("  ❌ REST API call failed")
                ws_task.cancel()
                return False

    except Exception as e:
        print(f"  ❌ REST call error: {e}")
        ws_task.cancel()
        return False

    ws_result = await ws_task
    print(f"\n  WS connection: {'✅ connected' if ws_result.get('connected') else '❌ FAILED'}")
    print(f"  Events received: {len(ws_result.get('received', []))}")

    if not ws_result.get("connected"):
        print(f"  ❌ WebSocket connection error: {ws_result.get('error')}")
        return False

    for ev in ws_result.get("received", []):
        print(f"    → kind={ev.get('kind')}, event={ev.get('event', ev.get('tool_name', 'N/A'))}")

    missing = ws_result.get("missing", [])
    if not missing:
        print("  ✅ PASS: bot.session.end arrived on WebSocket")
        return True
    else:
        print(f"  ❌ FAIL: Expected events NOT received: {missing}")
        print("  Diagnosis: bot_end_call has no direct handler and is not in _PASSTHROUGH_UI_EVENTS.")
        print("  The relay path sends nia.tool_invoke (not nia.event), which the frontend ignores.")
        print("  FIX: Add 'bot_end_call': 'bot.session.end' to _PASSTHROUGH_UI_EVENTS in bot_gateway.py")
        return False


async def test_ws_connectivity(ws_url: str) -> bool:
    """Test basic WebSocket connectivity to gateway."""
    print("\n" + "="*60)
    print("TEST: WebSocket connectivity")
    print("="*60)
    print(f"  Connecting to: {ws_url}")

    try:
        async with websockets.connect(ws_url, open_timeout=5) as ws:
            print("  ✅ Connected")
            # Send a ping-like message
            await ws.send(json.dumps({"type": "ping"}))
            print("  ✅ Sent test message")
            return True
    except Exception as e:
        print(f"  ❌ Connection failed: {e}")
        print("  Check: Is the bot gateway running? (curl http://localhost:4444/health)")
        return False


async def test_gateway_health(gateway_url: str) -> bool:
    """Test gateway health endpoint."""
    print("\n" + "="*60)
    print("TEST: Gateway health check")
    print("="*60)
    print(f"  GET {gateway_url}/health")

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{gateway_url}/health")
            data = resp.json()
            print(f"  ← Status: {resp.status_code}, Response: {data}")
            if resp.status_code == 200:
                print("  ✅ Gateway is healthy")
                return True
            else:
                print("  ❌ Gateway returned non-200")
                return False
    except Exception as e:
        print(f"  ❌ Health check failed: {e}")
        return False


async def run_all_tests(gateway_url: str) -> None:
    ws_url = _derive_ws_url(gateway_url)
    print(f"\n🔬 Wonder Canvas + bot_end_call WebSocket Delivery Test")
    print(f"   Gateway: {gateway_url}")
    print(f"   WS URL:  {ws_url}")
    print(f"   Timeout: {TIMEOUT_SECS}s per test")

    results = {}

    results["health"] = await test_gateway_health(gateway_url)
    if not results["health"]:
        print("\n⛔ Gateway not healthy — skipping remaining tests")
        return

    results["ws_connect"] = await test_ws_connectivity(ws_url)
    if not results["ws_connect"]:
        print("\n⛔ WebSocket not connectable — skipping event tests")
        return

    results["wonder_canvas"] = await test_wonder_canvas_scene(gateway_url, ws_url)
    results["bot_end_call"] = await test_bot_end_call(gateway_url, ws_url)

    # Summary
    print("\n" + "="*60)
    print("RESULTS SUMMARY")
    print("="*60)
    all_pass = True
    for test, passed in results.items():
        icon = "✅" if passed else "❌"
        print(f"  {icon} {test}: {'PASS' if passed else 'FAIL'}")
        if not passed:
            all_pass = False

    if all_pass:
        print("\n🎉 All tests passed! WebSocket delivery pipeline is working.")
    else:
        print("\n🔴 Some tests failed. See individual test output for diagnosis.")
        print("\n📋 Known bugs (as of 2026-02-17):")
        if not results.get("wonder_canvas"):
            print("   BUG: _broadcast_tool_event_best_effort sends nia.event only via WS,")
            print("        not via Daily REST API. During voice calls, WS bridge is stopped.")
            print("   FIX: Add Daily API send for ui_envelope in _broadcast_tool_event_best_effort")
        if not results.get("bot_end_call"):
            print("   BUG: bot_end_call not in _PASSTHROUGH_UI_EVENTS, no direct handler.")
            print("        Relay path sends nia.tool_invoke, not nia.event bot.session.end")
            print("   FIX: Add 'bot_end_call': 'bot.session.end' to _PASSTHROUGH_UI_EVENTS")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Test WebSocket event delivery from bot gateway")
    parser.add_argument("--gateway", default=GATEWAY_URL, help="Gateway base URL")
    parser.add_argument("--timeout", type=float, default=TIMEOUT_SECS, help="Per-test timeout")
    args = parser.parse_args()

    TIMEOUT_SECS = args.timeout

    try:
        asyncio.run(run_all_tests(args.gateway))
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(1)
