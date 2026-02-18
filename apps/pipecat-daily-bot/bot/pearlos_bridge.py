#!/usr/bin/env python3
"""PearlOS Bridge CLI — lets OpenClaw trigger PearlOS UI actions.

Usage:
    python pearlos_bridge.py youtube.search '{"query": "eighties rock videos"}'
    python pearlos_bridge.py app.open '{"app": "youtube"}'
    python pearlos_bridge.py note.open '{"noteId": "abc123"}'

Hits the bot gateway's /emit-event endpoint which forwards to the PearlOS
frontend via Daily.co app-messages.
"""

import sys
import json
import urllib.request
import os

BOT_GATEWAY = os.getenv("BOT_GATEWAY_URL", "http://localhost:4444")


def emit(event: str, payload: dict | None = None) -> dict:
    """Send an event to the PearlOS frontend via bot gateway."""
    body = json.dumps({
        "event": event,
        "payload": payload or {},
    }).encode()

    req = urllib.request.Request(
        f"{BOT_GATEWAY}/emit-event",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        error_body = e.read().decode() if e.fp else ""
        return {"ok": False, "status": e.code, "error": error_body}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# Convenience wrappers for common actions
SHORTCUTS = {
    "youtube-search": ("youtube.search", lambda args: {"query": " ".join(args)}),
    "youtube-play": ("youtube.play", lambda args: {"videoId": args[0]} if args else {}),
    "youtube-pause": ("youtube.pause", lambda _: {}),
    "youtube-next": ("youtube.next", lambda _: {}),
    "open": ("app.open", lambda args: {"app": args[0]} if args else {}),
    "close": ("apps.close", lambda args: {"app": args[0]} if args else {}),
}


def main():
    if len(sys.argv) < 2:
        print("Usage: pearlos_bridge.py <event|shortcut> [payload_json | args...]")
        print(f"\nShortcuts: {', '.join(SHORTCUTS.keys())}")
        sys.exit(1)

    cmd = sys.argv[1]

    # Check shortcuts first
    if cmd in SHORTCUTS:
        event, builder = SHORTCUTS[cmd]
        payload = builder(sys.argv[2:])
    elif len(sys.argv) >= 3:
        event = cmd
        try:
            payload = json.loads(sys.argv[2])
        except json.JSONDecodeError:
            # Treat remaining args as a simple key=value or just a string
            payload = {"value": " ".join(sys.argv[2:])}
    else:
        event = cmd
        payload = {}

    result = emit(event, payload)
    print(json.dumps(result, indent=2))
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()
