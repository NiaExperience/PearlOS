#!/usr/bin/env python3
"""Pre-commit capability guard for PearlOS voice pipeline.

Validates that code changes don't silently break critical capabilities.
Run automatically on commit, or manually: python scripts/check_capabilities.py
"""

import json
import re
import sys
from pathlib import Path

MANIFEST = Path(__file__).parent.parent / "bot" / "CAPABILITY_MANIFEST.json"
ROUTER = Path(__file__).parent.parent / "bot" / "processors" / "non_blocking_router.py"


def load_manifest():
    with open(MANIFEST) as f:
        return json.load(f)


def extract_phase1_tools(source: str) -> set[str]:
    """Extract tool names from PHASE1_TOOL_DEFINITIONS (uncommented only)."""
    names = set()
    # Find the list assignment and its closing bracket
    p1_match = re.search(r"PHASE1_TOOL_DEFINITIONS.*?=\s*\[", source)
    if not p1_match:
        return names
    p1_start = p1_match.start()
    # Find the [ that's part of = [...], not list[dict]
    eq_pos = source.find("=", p1_start)
    bracket_start = source.find("[", eq_pos)
    depth = 0
    end = bracket_start
    for i in range(bracket_start, len(source)):
        if source[i] == "[":
            depth += 1
        elif source[i] == "]":
            depth -= 1
        if depth == 0:
            end = i + 1
            break
    block = source[p1_start:end]
    for line in block.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        for m in re.finditer(r'"name":\s*"(bot_\w+)"', line):
            names.add(m.group(1))
    return names


def extract_whitelist(source: str) -> set[str]:
    """Extract tool names from PASSTHROUGH_TOOL_WHITELIST (uncommented only)."""
    names = set()
    # Find the set assignment: PASSTHROUGH_TOOL_WHITELIST: set[str] = {
    wl_match = re.search(r"PASSTHROUGH_TOOL_WHITELIST\s*:\s*set\[str\]\s*=\s*\{", source)
    if not wl_match:
        return names
    brace_start = source.find("{", wl_match.start())
    depth = 0
    end = brace_start
    for i in range(brace_start, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
        if depth == 0:
            end = i + 1
            break
    block = source[brace_start:end]
    for line in block.split("\n"):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue
        for m in re.finditer(r'"(bot_\w+)"', line):
            names.add(m.group(1))
    return names


def check_gateway_path(source: str) -> bool:
    """Verify _run_openclaw_background_legacy still exists and is reachable."""
    has_method = "_run_openclaw_background_legacy" in source
    call_pattern = r"await\s+self\._run_openclaw_background_legacy"
    has_call = bool(re.search(call_pattern, source))
    return has_method and has_call


def check_forbidden_removals(source: str, manifest: dict) -> list[str]:
    """Check that forbidden items haven't been removed."""
    errors = []
    for item, reason in manifest.get("forbidden_removals", {}).items():
        if item not in source:
            errors.append(f"SEVERED: '{item}' not found in router. {reason}")
    return errors


def main():
    if not MANIFEST.exists():
        print(f"⚠️  No capability manifest at {MANIFEST}")
        return 0
    if not ROUTER.exists():
        print(f"⚠️  Router not found at {ROUTER}")
        return 0

    manifest = load_manifest()
    source = ROUTER.read_text()
    errors = []
    warnings = []

    # Check Phase 1 tools
    phase1_tools = extract_phase1_tools(source)
    required_p1 = set(manifest.get("phase1_required_tools", []))
    routing_only = set(manifest.get("phase1_routing_only_tools", []))
    all_required_p1 = required_p1 | routing_only

    missing_p1 = all_required_p1 - phase1_tools
    if missing_p1:
        for tool in sorted(missing_p1):
            errors.append(f"❌ PHASE1 MISSING: '{tool}' removed from PHASE1_TOOL_DEFINITIONS")

    # Check whitelist
    whitelist = extract_whitelist(source)
    required_wl = set(manifest.get("passthrough_whitelist_required", []))
    missing_wl = required_wl - whitelist
    if missing_wl:
        for tool in sorted(missing_wl):
            errors.append(f"❌ WHITELIST MISSING: '{tool}' removed from PASSTHROUGH_TOOL_WHITELIST")

    # Routing-only tools should NOT be in whitelist
    wrongly_whitelisted = routing_only & whitelist
    if wrongly_whitelisted:
        for tool in sorted(wrongly_whitelisted):
            warnings.append(
                f"⚠️  '{tool}' is in whitelist but should be routing-only "
                "(Phase 1 selects, Phase 2 executes)"
            )

    # Check gateway path
    if manifest.get("phase2_must_reach_openclaw_gateway"):
        if not check_gateway_path(source):
            errors.append(
                "❌ SEVERED: OpenClaw gateway path (_run_openclaw_background_legacy) "
                "removed or unreachable"
            )

    # Check forbidden removals
    errors.extend(check_forbidden_removals(source, manifest))

    # Report
    if warnings:
        for w in warnings:
            print(w)
    if errors:
        print("\n🚨 CAPABILITY REGRESSION DETECTED 🚨\n")
        for e in errors:
            print(e)
        print(f"\nManifest: {MANIFEST}")
        print("Fix the code or update the manifest (with Blair's approval).")
        return 1

    print(f"✅ All capabilities intact ({len(required_p1)} Phase 1 tools, "
          f"{len(required_wl)} whitelist tools, gateway path verified)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
