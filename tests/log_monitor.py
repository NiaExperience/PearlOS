#!/usr/bin/env python3
"""PearlOS Log Monitor — scan bot gateway logs for regression patterns.

Usage: python tests/log_monitor.py
Exit code 0 = clean, 1 = errors found.
"""
import os
import re
import sys

LOG_FILES = [
    "/tmp/bot_gateway.log",
    "/tmp/bot_gateway_full.log",
]

# (pattern, severity, description)
PATTERNS = [
    (r"KeyError.*template\b|template.*KeyError", "ERROR", "KeyError in template rendering"),
    (r"render_template.*failed|Traceback.*template", "ERROR", "Template render failure/traceback"),
    (r"forwarder is None", "ERROR", "Event delivery failure (forwarder is None)"),
    (r"DIRECT_TOOLS.*KeyError", "ERROR", "Tool routing failure (DIRECT_TOOLS KeyError)"),
    (r"duplicate.*canvas|dedup.*blocked", "INFO", "Canvas dedup firing"),
    (r"TimeoutError|asyncio\.TimeoutError", "WARN", "Timeout / hanging call"),
    (r"html_url.*404|canvas_store.*miss", "WARN", "URL payload delivery failure (404/miss)"),
    (r"XSS|script.*injection", "CRITICAL", "Security alert (possible XSS/injection)"),
    (r"ImportError|ModuleNotFoundError", "ERROR", "Broken import after merge"),
    (r"PHASE2_BACKEND.*error|openclaw.*unreachable", "ERROR", "OpenClaw connectivity failure"),
]


def scan_file(filepath):
    """Scan a log file for known regression patterns. Returns list of findings."""
    findings = []
    if not os.path.exists(filepath):
        return findings

    try:
        with open(filepath, "r", errors="replace") as f:
            lines = f.readlines()
    except Exception as e:
        findings.append(("ERROR", f"Could not read {filepath}: {e}", ""))
        return findings

    for i, line in enumerate(lines, 1):
        for pattern, severity, desc in PATTERNS:
            if re.search(pattern, line, re.IGNORECASE):
                # Deduplicate: don't report the same pattern on adjacent lines
                snippet = line.strip()[:120]
                findings.append((severity, desc, f"{filepath}:{i}: {snippet}"))
                break  # One match per line

    return findings


def main():
    all_findings = []
    files_checked = 0

    for logfile in LOG_FILES:
        if os.path.exists(logfile):
            files_checked += 1
            findings = scan_file(logfile)
            all_findings.extend(findings)

    print("=== PearlOS Log Monitor ===")
    print()

    if files_checked == 0:
        print("⚠️  No log files found. Checked:")
        for f in LOG_FILES:
            print(f"   {f}")
        print()
        print("This is OK if the gateway hasn't been started yet.")
        return 0

    if not all_findings:
        print(f"✅ Clean — no issues detected ({files_checked} log file(s) scanned)")
        return 0

    # Group by severity
    errors = [f for f in all_findings if f[0] in ("ERROR", "CRITICAL")]
    warns = [f for f in all_findings if f[0] == "WARN"]
    infos = [f for f in all_findings if f[0] == "INFO"]

    has_errors = len(errors) > 0

    if errors:
        print(f"❌ ERRORS ({len(errors)}):")
        for sev, desc, loc in errors[:20]:  # Cap output
            print(f"  [{sev}] {desc}")
            print(f"         {loc}")
        print()

    if warns:
        print(f"⚠️  WARNINGS ({len(warns)}):")
        for sev, desc, loc in warns[:10]:
            print(f"  [{sev}] {desc}")
            print(f"         {loc}")
        print()

    if infos:
        print(f"ℹ️  INFO ({len(infos)}):")
        for sev, desc, loc in infos[:5]:
            print(f"  [{sev}] {desc}")
        print()

    print(f"Total: {len(errors)} errors, {len(warns)} warnings, {len(infos)} info")
    return 1 if has_errors else 0


if __name__ == "__main__":
    sys.exit(main())
