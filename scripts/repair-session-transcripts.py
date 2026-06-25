#!/usr/bin/env python3
"""
Automatic session transcript repair for OpenClaw.

Detects and fixes corrupted session transcripts that cause
"Agent couldn't generate a response" errors. Two failure modes:

1. Thinking-only dead ends: DeepSeek returns reasoning_content with
   <=20 output tokens and no visible text or tool calls. The model
   gets stuck in a loop where every retry also produces thinking-only.

2. Orphaned tool_use blocks: A timeout interrupts a tool call mid-execution,
   leaving a tool_use block without a matching tool_result. This corrupts
   the conversation history for providers that require paired blocks.

Run via cron every 5 minutes or on-demand after timeout errors.
"""

import json
import os
import sys
import glob
import time

SESSIONS_DIR = "/root/.openclaw/agents/main/sessions"
DRY_RUN = "--dry-run" in sys.argv
VERBOSE = "--verbose" in sys.argv or "-v" in sys.argv


def log(msg):
    print(f"[session-repair] {msg}", flush=True)


def repair_session(filepath):
    """Repair a single session JSONL file. Returns True if repairs were made."""
    try:
        with open(filepath) as f:
            lines = f.readlines()
    except Exception as e:
        log(f"  skip {filepath}: {e}")
        return False

    if not lines:
        return False

    original_count = len(lines)
    repaired = list(lines)
    repairs = []

    # Pass 1: Remove trailing thinking-only + bootstrap-context entries
    while repaired:
        last = repaired[-1].strip()
        if not last:
            repaired.pop()
            continue
        try:
            obj = json.loads(last)
        except json.JSONDecodeError:
            break

        # Remove bootstrap-context custom entries at tail
        if obj.get("type") == "custom" and "bootstrap-context" in obj.get("customType", ""):
            repaired.pop()
            repairs.append("removed trailing bootstrap-context")
            continue

        # Remove thinking-only assistant entries at tail
        if obj.get("type") == "message":
            msg = obj.get("message", {})
            if msg.get("role") == "assistant":
                content = msg.get("content", [])
                usage = msg.get("usage", {})
                if isinstance(content, list):
                    types = [c.get("type") for c in content if isinstance(c, dict)]
                    output_tokens = usage.get("output", 999)
                    # Thinking-only with very low output = dead end
                    if types == ["thinking"] and output_tokens <= 20:
                        repaired.pop()
                        repairs.append(f"removed thinking-only dead end (output={output_tokens})")
                        continue
        break

    # Pass 2: Check for orphaned tool_use at the very end
    # (assistant with tool_use as last message, no following tool_result)
    if repaired:
        last = repaired[-1].strip()
        try:
            obj = json.loads(last)
            if obj.get("type") == "message":
                msg = obj.get("message", {})
                if msg.get("role") == "assistant":
                    content = msg.get("content", [])
                    if isinstance(content, list):
                        has_tool_use = any(
                            isinstance(c, dict) and c.get("type") in ("toolCall", "toolUse", "tool_use")
                            for c in content
                        )
                        if has_tool_use:
                            # This assistant message has tool calls with no results following.
                            # Inject synthetic tool results.
                            tool_calls = []
                            for c in content:
                                if isinstance(c, dict) and c.get("type") in ("toolCall", "toolUse", "tool_use"):
                                    tc_id = c.get("id", "")
                                    tc_name = c.get("name", "unknown")
                                    tool_calls.append((tc_id, tc_name))

                            for tc_id, tc_name in tool_calls:
                                synthetic = {
                                    "type": "message",
                                    "id": f"repair-{int(time.time())}-{tc_id[:8]}",
                                    "parentId": obj.get("id", ""),
                                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                                    "message": {
                                        "role": "toolResult",
                                        "toolCallId": tc_id,
                                        "toolName": tc_name,
                                        "content": [
                                            {
                                                "type": "text",
                                                "text": f"[Session repair] Tool call was interrupted by a timeout. The operation may have partially completed. Please check the current state before retrying."
                                            }
                                        ]
                                    }
                                }
                                repaired.append(json.dumps(synthetic) + "\n")
                                repairs.append(f"injected synthetic tool_result for orphaned {tc_name} ({tc_id[:12]})")
        except json.JSONDecodeError:
            pass

    if not repairs:
        return False

    session_id = os.path.basename(filepath).replace(".jsonl", "")
    log(f"  {session_id}: {len(repairs)} repairs")
    for r in repairs:
        log(f"    - {r}")

    if DRY_RUN:
        log(f"    [dry-run] would write {len(repaired)} entries (was {original_count})")
        return True

    # Write repaired file
    with open(filepath, "w") as f:
        f.writelines(repaired)

    log(f"    written: {len(repaired)} entries (was {original_count})")
    return True


def main():
    if not os.path.isdir(SESSIONS_DIR):
        log(f"sessions dir not found: {SESSIONS_DIR}")
        sys.exit(1)

    # Only check active (non-deleted) session files
    pattern = os.path.join(SESSIONS_DIR, "*.jsonl")
    files = [f for f in glob.glob(pattern) if ".deleted." not in f]

    if not files:
        if VERBOSE:
            log("no active sessions found")
        return

    repaired_count = 0
    for filepath in files:
        if repair_session(filepath):
            repaired_count += 1

    if repaired_count > 0:
        log(f"repaired {repaired_count} session(s)")
    elif VERBOSE:
        log("all sessions clean")


if __name__ == "__main__":
    main()
