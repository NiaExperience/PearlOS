#!/usr/bin/env python3
"""PearlOS UI control CLI — lets OpenClaw trigger PearlOS frontend actions.

Usage:
    python pearlos_ui.py youtube_search "lofi hip hop"
    python pearlos_ui.py youtube_play [video_id]
    python pearlos_ui.py youtube_pause
    python pearlos_ui.py youtube_next
    python pearlos_ui.py open <app>          # notes, youtube, gmail, terminal, browser, google_drive
    python pearlos_ui.py close <app>
    python pearlos_ui.py window <action>     # minimize, maximize, restore, snap_left, snap_right, reset
    python pearlos_ui.py soundtrack_play <genre>
    python pearlos_ui.py soundtrack_stop
    python pearlos_ui.py soundtrack_next
    python pearlos_ui.py soundtrack_volume <0-100>
    python pearlos_ui.py desktop_mode <mode> # default, focus, zen
    python pearlos_ui.py sprite <name>
    python pearlos_ui.py raw <event> [json_payload]
"""

import sys
import json
import urllib.request

GATEWAY = "http://localhost:4444"

def emit(event: str, payload: dict = {}):
    data = json.dumps({"event": event, "payload": payload}).encode()
    req = urllib.request.Request(
        f"{GATEWAY}/emit-event",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        print(json.loads(resp.read()))

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)

    cmd = args[0].lower()

    # YouTube
    if cmd == "youtube_search" and len(args) > 1:
        emit("youtube.search", {"query": " ".join(args[1:])})
    elif cmd == "youtube_play":
        payload = {"videoId": args[1]} if len(args) > 1 else {}
        emit("app.open", {"app": "youtube"})
        emit("youtube.play", payload)
    elif cmd == "youtube_pause":
        emit("youtube.pause", {})
    elif cmd == "youtube_next":
        emit("youtube.next", {})

    # App open/close
    elif cmd == "open" and len(args) > 1:
        emit("app.open", {"app": args[1]})
    elif cmd == "close" and len(args) > 1:
        emit("apps.close", {"app": args[1]})

    # Window management
    elif cmd == "window" and len(args) > 1:
        action_map = {
            "minimize": "window.minimize",
            "maximize": "window.maximize",
            "restore": "window.restore",
            "snap_left": "window.snap.left",
            "snap_right": "window.snap.right",
            "reset": "window.reset",
        }
        event = action_map.get(args[1])
        if event:
            emit(event, {})
        else:
            print(f"Unknown window action: {args[1]}")
            sys.exit(1)

    # Soundtrack
    elif cmd == "soundtrack_play" and len(args) > 1:
        emit("soundtrack.control", {"action": "play", "genre": args[1]})
    elif cmd == "soundtrack_stop":
        emit("soundtrack.control", {"action": "stop"})
    elif cmd == "soundtrack_next":
        emit("soundtrack.control", {"action": "next"})
    elif cmd == "soundtrack_volume" and len(args) > 1:
        emit("soundtrack.control", {"action": "setVolume", "volume": int(args[1])})

    # Desktop mode
    elif cmd == "desktop_mode" and len(args) > 1:
        emit("desktop.mode.switch", {"mode": args[1]})

    # Sprite
    elif cmd == "sprite" and len(args) > 1:
        emit("sprite.summon", {"name": args[1]})

    # Raw event
    elif cmd == "raw" and len(args) > 1:
        payload = json.loads(args[2]) if len(args) > 2 else {}
        emit(args[1], payload)

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
