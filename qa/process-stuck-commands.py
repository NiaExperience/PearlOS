#!/usr/bin/env python3
"""
Process stuck spawn-acp-agent commands from the control queue by dispatching
them directly to the bot gateway tasks API.

The control queue at /workspace/nia-universal/qa/command-queue.json had NO
consumer/worker reading it, so commands sat forever. This script reads the
pending commands, creates a task on the bot gateway for each one (just like
pearl-task-dispatch does), executes it immediately, and marks it done in the
queue.
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

QUEUE_FILE = "/workspace/nia-universal/qa/command-queue.json"
BOT_GATEWAY = (os.environ.get("BOT_GATEWAY_URL") or "http://localhost:4444").rstrip("/")
SHARED_SECRET = os.environ.get("BOT_CONTROL_SHARED_SECRET") or ""


def gw_request(method, path, body=None):
    """Make an HTTP request to the bot gateway."""
    url = f"{BOT_GATEWAY}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if SHARED_SECRET:
        req.add_header("X-Bot-Secret", SHARED_SECRET)
        req.add_header("Authorization", f"Bearer {SHARED_SECRET}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code} on {method} {path}: {body_text[:500]}")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Connection failed on {method} {path}: {e.reason}")


def mark_executed(cmd_id, error=None):
    """Mark a command as executed in the queue file."""
    with open(QUEUE_FILE) as f:
        data = json.load(f)
    for cmd in data["commands"]:
        if cmd["id"] == cmd_id:
            cmd["executedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if error:
                cmd["error"] = error
            break
    with open(QUEUE_FILE, "w") as f:
        json.dump(data, f, indent=2)


def main():
    # Read pending commands from queue
    with open(QUEUE_FILE) as f:
        data = json.load(f)

    pending = [c for c in data["commands"] if not c.get("executedAt")]
    print(f"Found {len(pending)} pending commands to process")

    if not pending:
        print("Nothing to process.")
        return

    for cmd in pending:
        cmd_id = cmd["id"]
        payload = cmd.get("payload", {})
        role = payload.get("role", "?")
        title = f"{payload.get('projectTitle', '?')}: {payload.get('title', '?')}"
        description = payload.get("description", "")

        print(f"\n[{role}] Creating task: {title[:80]}...")

        try:
            # Step 1: Create task on bot gateway
            create_body = {
                "source": "manual",
                "created_by": "pearl",
                "assignee": "claude_cli",
                "status": "pending",
                "urgency": "urgent",
                "title": title,
                "task": description,
            }
            create_result = gw_request("POST", "/api/tasks", create_body)
            task_id = (
                create_result.get("task", {}).get("id")
                or create_result.get("id")
                or ""
            )

            if not task_id:
                print(f"  ERROR: No task ID returned")
                mark_executed(cmd_id, "no_task_id_returned")
                continue

            print(f"  Created task: {task_id}")

            # Step 2: Execute the task immediately
            exec_result = gw_request(
                "POST", f"/api/tasks/{urllib.request.quote(task_id, safe='')}/execute"
            )
            exec_status = (
                exec_result.get("task", {}).get("status", "unknown")
            )
            print(f"  Executed: status={exec_status}")

            mark_executed(cmd_id)
            print(f"  ✓ Done")

        except RuntimeError as e:
            print(f"  ERROR: {e}")
            mark_executed(cmd_id, str(e)[:200])
        except Exception as e:
            print(f"  ERROR: {e}")
            mark_executed(cmd_id, str(e)[:200])

    print(f"\n=== All pending commands processed ===")
    print(f"Queue file: {QUEUE_FILE}")

    # Show final queue state
    with open(QUEUE_FILE) as f:
        final = json.load(f)
    remaining = [c for c in final["commands"] if not c.get("executedAt")]
    if remaining:
        print(f"WARNING: {len(remaining)} commands still pending (they should not be!)")
    else:
        print("All commands have been marked as executed.")


if __name__ == "__main__":
    main()
