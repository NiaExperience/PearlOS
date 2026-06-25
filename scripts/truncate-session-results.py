#!/usr/bin/env python3
"""truncate-session-results.py

Walks every active OpenClaw session .jsonl file under
/root/.openclaw/agents/main/sessions/ and shortens any oversized tool
result payloads stored in `message.content[].text`. Originals are copied
to bloat-archive/ before any file is modified.

Run via cron every 10 minutes; output goes to /tmp/truncate-session-results.log.

Safety:
  - Skips files in bloat-archive/ and any *.deleted*, *.reset*,
    *.checkpoint*, *.tmp, or *.bak file.
  - Skips files modified in the last 120 seconds (likely active write).
  - Only touches `type == "message"` records with `role == "toolResult"`.
  - Never modifies the session header (`type == "session"`),
    `model_change`, `thinking_level_change`, or `custom` records.
  - Atomic rewrite via tempfile + rename. Aborts if mtime/size changes
    between read and rename (i.e. gateway appended while we worked).
  - Idempotent: a marker is appended to truncated text so we don't
    re-truncate on the next pass.
"""

import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timezone

SESSIONS_DIR = "/root/.openclaw/agents/main/sessions"
ARCHIVE_DIR = os.path.join(SESSIONS_DIR, "bloat-archive")
MAX_TOOL_RESULT_CHARS = 5000
TRUNCATION_MARKER = "\n\n[... truncated by truncate-session-results.py — original archived ...]"
ACTIVE_WRITE_SKIP_SECONDS = 120

PRESERVE_TYPES = {"session", "model_change", "thinking_level_change", "custom"}
SKIP_NAME_FRAGMENTS = (".deleted", ".reset", ".checkpoint", ".tmp", ".bak", ".pre-trim")


def log(msg: str) -> None:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{ts} {msg}", flush=True)


def should_skip(name: str) -> bool:
    if not name.endswith(".jsonl"):
        return True
    for frag in SKIP_NAME_FRAGMENTS:
        if frag in name:
            return True
    return False


def _truncate_string(s: str) -> tuple[str, int]:
    """Return (new_string, bytes_saved). Idempotent via marker."""
    if TRUNCATION_MARKER in s:
        return s, 0
    if len(s) <= MAX_TOOL_RESULT_CHARS:
        return s, 0
    new = s[:MAX_TOOL_RESULT_CHARS] + TRUNCATION_MARKER
    return new, len(s) - len(new)


def _walk_truncate(node, depth: int = 0):
    """Recursively truncate long string values in dicts/lists.

    Returns (modified, bytes_saved). Caps recursion at depth 5 so we
    never blow the stack on pathological structures.
    """
    if depth > 5:
        return False, 0
    modified = False
    saved = 0
    if isinstance(node, dict):
        for k, v in list(node.items()):
            if isinstance(v, str):
                new, s = _truncate_string(v)
                if s:
                    node[k] = new
                    saved += s
                    modified = True
            elif isinstance(v, (dict, list)):
                m, s = _walk_truncate(v, depth + 1)
                modified = modified or m
                saved += s
    elif isinstance(node, list):
        for i, v in enumerate(node):
            if isinstance(v, str):
                new, s = _truncate_string(v)
                if s:
                    node[i] = new
                    saved += s
                    modified = True
            elif isinstance(v, (dict, list)):
                m, s = _walk_truncate(v, depth + 1)
                modified = modified or m
                saved += s
    return modified, saved


def truncate_record(obj: dict) -> tuple[bool, int]:
    """Return (modified, bytes_saved). Mutates obj in place.

    Targets toolResult messages: shortens both `content[].text` and any
    long string fields under `message.details` (e.g. `details.aggregated`
    from the `exec` tool, which can hold the entire stdout buffer).
    """
    if obj.get("type") != "message":
        return False, 0
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return False, 0
    if msg.get("role") != "toolResult":
        return False, 0

    modified = False
    saved = 0

    content = msg.get("content")
    if isinstance(content, list):
        m, s = _walk_truncate(content)
        modified = modified or m
        saved += s

    details = msg.get("details")
    if isinstance(details, (dict, list)):
        m, s = _walk_truncate(details)
        modified = modified or m
        saved += s

    return modified, saved


def process_file(path: str) -> dict:
    """Process one session file; returns stats dict."""
    stats = {
        "path": path,
        "skipped": None,
        "records_total": 0,
        "records_modified": 0,
        "bytes_before": 0,
        "bytes_after": 0,
        "bytes_saved_payload": 0,
    }

    try:
        st = os.stat(path)
    except FileNotFoundError:
        stats["skipped"] = "vanished"
        return stats

    age = time.time() - st.st_mtime
    if age < ACTIVE_WRITE_SKIP_SECONDS:
        stats["skipped"] = f"active (mtime {age:.0f}s ago)"
        return stats

    stats["bytes_before"] = st.st_size
    initial_mtime = st.st_mtime
    initial_size = st.st_size

    out_lines: list[str] = []
    file_modified = False
    saved_total = 0
    records_modified = 0
    records_total = 0

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for raw in f:
                line = raw.rstrip("\n")
                if not line:
                    out_lines.append("")
                    continue
                records_total += 1
                try:
                    obj = json.loads(line)
                except Exception:
                    out_lines.append(line)
                    continue
                if obj.get("type") in PRESERVE_TYPES:
                    out_lines.append(line)
                    continue
                modified, saved = truncate_record(obj)
                if modified:
                    file_modified = True
                    records_modified += 1
                    saved_total += saved
                    out_lines.append(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))
                else:
                    out_lines.append(line)
    except Exception as e:
        stats["skipped"] = f"read-error: {e}"
        return stats

    stats["records_total"] = records_total
    stats["records_modified"] = records_modified
    stats["bytes_saved_payload"] = saved_total

    if not file_modified:
        return stats

    # Re-stat — bail if file changed under us
    try:
        st2 = os.stat(path)
    except FileNotFoundError:
        stats["skipped"] = "vanished-mid-process"
        return stats
    if st2.st_mtime != initial_mtime or st2.st_size != initial_size:
        stats["skipped"] = "changed-mid-process"
        return stats

    # Archive original
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    archive_name = f"{os.path.basename(path)}.{ts}.pre-truncate"
    archive_path = os.path.join(ARCHIVE_DIR, archive_name)
    try:
        shutil.copy2(path, archive_path)
    except Exception as e:
        stats["skipped"] = f"archive-failed: {e}"
        return stats

    # Write tmp + atomic rename
    dirpath = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".trunc-", suffix=".jsonl", dir=dirpath)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.write("\n".join(out_lines))
            if out_lines and not out_lines[-1].endswith("\n"):
                out.write("\n")
        # Final guard before rename
        st3 = os.stat(path)
        if st3.st_mtime != initial_mtime or st3.st_size != initial_size:
            os.unlink(tmp)
            stats["skipped"] = "changed-before-rename"
            return stats
        os.rename(tmp, path)
    except Exception as e:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        stats["skipped"] = f"write-error: {e}"
        return stats

    try:
        stats["bytes_after"] = os.stat(path).st_size
    except FileNotFoundError:
        stats["bytes_after"] = 0
    return stats


def main() -> int:
    dry_run = "--dry-run" in sys.argv
    if not os.path.isdir(SESSIONS_DIR):
        log(f"sessions dir not found: {SESSIONS_DIR}")
        return 1

    total_processed = 0
    total_modified_files = 0
    total_records_modified = 0
    total_bytes_before = 0
    total_bytes_after = 0
    total_payload_saved = 0
    skipped_summary: dict[str, int] = {}

    for name in sorted(os.listdir(SESSIONS_DIR)):
        if should_skip(name):
            continue
        path = os.path.join(SESSIONS_DIR, name)
        if not os.path.isfile(path):
            continue
        if dry_run:
            # Read-only: report what would change.
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    rec_mod = 0
                    saved = 0
                    for raw in f:
                        try:
                            obj = json.loads(raw)
                        except Exception:
                            continue
                        if obj.get("type") in PRESERVE_TYPES:
                            continue
                        modified, s = truncate_record(obj)
                        if modified:
                            rec_mod += 1
                            saved += s
                    if rec_mod:
                        log(f"DRY-RUN {name}: would truncate {rec_mod} record(s), saving ~{saved} bytes")
                        total_records_modified += rec_mod
                        total_payload_saved += saved
                        total_modified_files += 1
            except Exception as e:
                log(f"DRY-RUN {name}: read-error {e}")
            total_processed += 1
            continue

        s = process_file(path)
        total_processed += 1
        if s["skipped"]:
            skipped_summary[s["skipped"].split(":")[0]] = skipped_summary.get(s["skipped"].split(":")[0], 0) + 1
            continue
        if s["records_modified"]:
            total_modified_files += 1
            total_records_modified += s["records_modified"]
            total_bytes_before += s["bytes_before"]
            total_bytes_after += s["bytes_after"]
            total_payload_saved += s["bytes_saved_payload"]
            log(
                f"TRUNCATED {os.path.basename(path)}: "
                f"{s['records_modified']} record(s), "
                f"{s['bytes_before']} -> {s['bytes_after']} bytes "
                f"(payload saved {s['bytes_saved_payload']})"
            )

    if dry_run:
        log(
            f"DRY-RUN summary: processed={total_processed} "
            f"would-modify-files={total_modified_files} "
            f"would-modify-records={total_records_modified} "
            f"payload-saved≈{total_payload_saved}"
        )
    elif total_modified_files or total_processed:
        log(
            f"summary: processed={total_processed} "
            f"modified-files={total_modified_files} "
            f"modified-records={total_records_modified} "
            f"file-bytes {total_bytes_before}->{total_bytes_after} "
            f"payload-saved={total_payload_saved} "
            f"skipped={skipped_summary or 'none'}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
