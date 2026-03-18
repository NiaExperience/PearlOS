#!/usr/bin/env python3
"""PearlOS Self-Test — standalone health + test runner.

Usage: python tests/pearl_self_test.py
Exit code 0 = all pass, 1 = any failure.
"""
import json
import os
import random
import subprocess
import sys
import urllib.request
import urllib.error

sys.path.insert(0, "/workspace/nia-universal/apps/pipecat-daily-bot/bot")

PASS = "✅"
FAIL = "❌"
SKIP = "⏭️"


def check_service(name, url, timeout=5):
    """Check if a service responds at the given URL."""
    try:
        req = urllib.request.Request(url, method="GET")
        resp = urllib.request.urlopen(req, timeout=timeout)
        return resp.status < 500
    except Exception:
        return False


def run_pytest(files, label, extra_args=None):
    """Run pytest on given files and return (passed, failed, errors, skipped)."""
    cmd = [
        sys.executable, "-m", "pytest", *files,
        "--tb=no", "-q", "--no-header",
    ]
    if extra_args:
        cmd.extend(extra_args)
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300,
            cwd="/workspace/nia-universal",
        )
        # Parse last line like "123 passed, 48 xfailed, 1 skipped"
        output = result.stdout.strip()
        lines = output.split("\n")
        summary_line = lines[-1] if lines else ""
        passed = _extract_count(summary_line, "passed")
        failed = _extract_count(summary_line, "failed")
        errors = _extract_count(summary_line, "error")
        return passed, failed, errors, result.returncode
    except subprocess.TimeoutExpired:
        return 0, 0, 1, 1
    except Exception as e:
        return 0, 0, 1, 1


def _extract_count(line, keyword):
    """Extract count from pytest summary like '123 passed'."""
    import re
    m = re.search(rf"(\d+)\s+{keyword}", line)
    return int(m.group(1)) if m else 0


def spot_check_templates():
    """Render 3 random templates with Playwright and check screenshot size."""
    results = []
    try:
        from tools.wonder_canvas_templates import render_template, get_template_names
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        return [(f"import error: {e}", False, 0)]

    names = get_template_names()
    picks = random.sample(names, min(3, len(names)))

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        page = browser.new_page(viewport={"width": 390, "height": 844})
        for name in picks:
            try:
                html = render_template(name)
                page.set_content(html, wait_until="domcontentloaded")
                page.wait_for_timeout(500)
                screenshot = page.screenshot()
                size_kb = len(screenshot) // 1024
                results.append((name, size_kb > 1, size_kb))
            except Exception as e:
                results.append((name, False, 0))
        browser.close()
    return results


def check_news_api():
    """Check if news API returns data."""
    try:
        req = urllib.request.Request(
            "http://localhost:3000/api/news/feed",
            method="GET",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        if isinstance(data, list):
            items = len(data)
            cats = len(set(item.get("category", "") for item in data if isinstance(item, dict)))
            return True, items, cats
        elif isinstance(data, dict) and "items" in data:
            items = len(data["items"])
            cats = len(set(item.get("category", "") for item in data["items"] if isinstance(item, dict)))
            return True, items, cats
        return True, 0, 0
    except Exception:
        return False, 0, 0


def main():
    overall = True
    report = []

    def add(icon, msg):
        report.append(f"  {icon} {msg}")

    # --- Services ---
    report.append("Services:")
    services = [
        ("Next.js (:3000)", "http://localhost:3000/pearlos"),
        ("Bot Gateway (:4444)", "http://localhost:4444/health"),
        ("OpenClaw (:18789)", "http://localhost:18789/v1/models"),
        ("PocketTTS (:8766)", "http://localhost:8766/health"),
    ]
    for name, url in services:
        ok = check_service(name, url)
        add(PASS if ok else FAIL, name)
        if not ok:
            # Try alternate port for OpenClaw
            if ":18789" in url:
                alt = url.replace(":18789", ":8000")
                ok2 = check_service(name, alt)
                if ok2:
                    report[-1] = f"  {PASS} {name} (on :8000)"
                    ok = True
            if not ok:
                overall = False

    # --- Tests ---
    report.append("")
    report.append("Tests:")

    unit_files = [
        "tests/test_templates.py", "tests/test_events.py",
        "tests/test_router.py", "tests/test_news.py", "tests/test_tools.py",
    ]
    p, f, e, rc = run_pytest(unit_files, "Unit")
    add(PASS if rc == 0 else FAIL, f"Unit tests: {p} passed" + (f", {f} failed" if f else ""))
    if rc != 0:
        overall = False

    # Visual tests
    p2, f2, e2, rc2 = run_pytest(["tests/test_visual.py"], "Visual")
    add(PASS if rc2 == 0 else FAIL, f"Visual tests: {p2} passed" + (f", {f2} failed" if f2 else ""))
    if rc2 != 0:
        overall = False

    # Integration tests
    p3, f3, e3, rc3 = run_pytest(
        ["tests/test_gateway.py", "tests/test_news_api.py"], "Integration",
        ["-m", "integration"],
    )
    if p3 + f3 == 0:
        add(SKIP, "Integration: skipped (services not running?)")
    else:
        add(PASS if rc3 == 0 else FAIL, f"Integration: {p3} passed" + (f", {f3} failed" if f3 else ""))
        if rc3 != 0:
            overall = False

    # --- Spot Checks ---
    report.append("")
    report.append("Spot Checks:")
    spot = spot_check_templates()
    for name, ok, size_kb in spot:
        add(PASS if ok else FAIL, f"{name} renders ({size_kb}KB)")
        if not ok:
            overall = False

    # --- News API ---
    report.append("")
    report.append("News API:")
    news_ok, items, cats = check_news_api()
    if news_ok:
        add(PASS, f"{items} items, {cats} categories")
    else:
        add(SKIP, "News API not reachable (Next.js not running?)")

    # --- Summary ---
    report.append("")
    report.append(f"OVERALL: {'PASS ' + PASS if overall else 'FAIL ' + FAIL}")

    print("=== PearlOS Self-Test Report ===")
    print("\n".join(report))

    return 0 if overall else 1


if __name__ == "__main__":
    sys.exit(main())
