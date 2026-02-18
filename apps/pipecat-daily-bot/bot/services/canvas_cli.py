#!/usr/bin/env python3
"""CLI wrapper for pushing content to PearlOS Canvas/Notes via Mesh API.

Usage:
    # Push markdown content
    python canvas_cli.py push --title "My Doc" --content "# Hello\nWorld"
    
    # Push a file
    python canvas_cli.py push-file --path /workspace/some/file.py
    
    # Push from stdin
    echo "# Content" | python canvas_cli.py push --title "From Stdin" --stdin
    
    # List notes
    python canvas_cli.py list
    
    # Delete a note
    python canvas_cli.py delete --id <note-id>

Environment:
    MESH_API_ENDPOINT  (default: http://localhost:2000/api)
    MESH_SHARED_SECRET (required)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

# Ensure bot package is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("MESH_API_ENDPOINT", "http://localhost:2000/api")


async def cmd_push(args):
    from services.openclaw_mesh_bridge import push_content_to_notes

    content = args.content
    if args.stdin:
        content = sys.stdin.read()
    if not content:
        print("Error: --content or --stdin required", file=sys.stderr)
        sys.exit(1)

    note = await push_content_to_notes(args.title, content, mode=args.mode)
    note_id = note.get("_id") or note.get("page_id")
    print(json.dumps({"ok": True, "id": note_id, "title": args.title}))


async def cmd_push_file(args):
    from services.openclaw_mesh_bridge import push_file_to_notes

    note = await push_file_to_notes(args.path, title=args.title, mode=args.mode)
    note_id = note.get("_id") or note.get("page_id")
    title = note.get("title") or args.title or os.path.basename(args.path)
    print(json.dumps({"ok": True, "id": note_id, "title": title}))


async def cmd_list(_args):
    from services.openclaw_mesh_bridge import list_notes

    notes = await list_notes()
    for n in notes:
        print(json.dumps({
            "id": n.get("_id"),
            "title": n.get("title"),
            "mode": n.get("mode"),
        }))


async def cmd_update(args):
    from services.openclaw_mesh_bridge import update_note_content

    content = args.content
    if args.stdin:
        content = sys.stdin.read()

    note = await update_note_content(args.id, content, title=args.title)
    print(json.dumps({"ok": True, "id": args.id}))


async def cmd_delete(args):
    from services.openclaw_mesh_bridge import delete_note

    ok = await delete_note(args.id)
    print(json.dumps({"ok": ok, "id": args.id}))


def main():
    parser = argparse.ArgumentParser(description="PearlOS Canvas CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    # push
    p = sub.add_parser("push", help="Push markdown content to canvas")
    p.add_argument("--title", required=True)
    p.add_argument("--content", default="")
    p.add_argument("--stdin", action="store_true", help="Read content from stdin")
    p.add_argument("--mode", default="work", choices=["work", "personal"])

    # push-file
    p = sub.add_parser("push-file", help="Push a file to canvas")
    p.add_argument("--path", required=True)
    p.add_argument("--title", default=None)
    p.add_argument("--mode", default="work", choices=["work", "personal"])

    # list
    sub.add_parser("list", help="List all notes")

    # update
    p = sub.add_parser("update", help="Update an existing note")
    p.add_argument("--id", required=True)
    p.add_argument("--content", default="")
    p.add_argument("--title", default=None)
    p.add_argument("--stdin", action="store_true")

    # delete
    p = sub.add_parser("delete", help="Delete a note")
    p.add_argument("--id", required=True)

    args = parser.parse_args()

    dispatch = {
        "push": cmd_push,
        "push-file": cmd_push_file,
        "list": cmd_list,
        "update": cmd_update,
        "delete": cmd_delete,
    }

    asyncio.run(dispatch[args.command](args))


if __name__ == "__main__":
    main()
