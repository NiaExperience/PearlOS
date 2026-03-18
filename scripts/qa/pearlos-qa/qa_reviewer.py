#!/usr/bin/env python3
"""
PearlOS QA Reviewer — Analyzes screenshots for visual defects and generates reports.

Reads screenshots from /tmp/qa-results/, runs pixel-level and OCR analysis,
and outputs a Markdown report with pass/fail per test and severity ratings.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from PIL import Image, ImageStat
from jinja2 import Environment, FileSystemLoader

# Optional OCR support
try:
    import pytesseract
    HAS_TESSERACT = True
except ImportError:
    HAS_TESSERACT = False

# --- Constants ---
VIEWPORT_W, VIEWPORT_H = 1280, 800
RESULTS_DIR = Path("/tmp/qa-results")
REPORT_PATH = RESULTS_DIR / "qa-report.md"
TEMPLATE_DIR = Path(__file__).parent

# Pearl avatar region (bottom-center area where avatar typically appears)
AVATAR_REGION = (540, VIEWPORT_H - 150, 740, VIEWPORT_H - 20)  # x1, y1, x2, y2

# Severity levels
CRITICAL = "critical"
WARNING = "warning"
INFO = "info"


@dataclass
class Defect:
    name: str
    severity: str  # critical, warning, info
    description: str


@dataclass
class TestResult:
    filename: str
    test_name: str
    timestamp: str
    passed: bool
    defects: list[Defect] = field(default_factory=list)

    @property
    def worst_severity(self) -> Optional[str]:
        if not self.defects:
            return None
        order = {CRITICAL: 0, WARNING: 1, INFO: 2}
        return min(self.defects, key=lambda d: order.get(d.severity, 99)).severity


# --- Analyzers ---

def _region_stats(img: Image.Image, box: tuple[int, int, int, int]):
    """Get mean and stddev for a crop region, clamped to image bounds."""
    w, h = img.size
    box = (max(0, box[0]), max(0, box[1]), min(w, box[2]), min(h, box[3]))
    if box[2] <= box[0] or box[3] <= box[1]:
        return None
    crop = img.crop(box)
    stat = ImageStat.Stat(crop)
    return stat.mean, stat.stddev


def check_white_boxes(img: Image.Image) -> list[Defect]:
    """Scan for large uniform white/light regions (>100x100) via grid sampling."""
    defects = []
    w, h = img.size
    step = 50
    for y in range(0, h - 100, step):
        for x in range(0, w - 100, step):
            box = (x, y, x + 100, y + 100)
            result = _region_stats(img, box)
            if result is None:
                continue
            mean, stddev = result
            # White box: all channels high mean (>240) and low variance (<5)
            if all(m > 240 for m in mean[:3]) and all(s < 5 for s in stddev[:3]):
                defects.append(Defect(
                    "white_box",
                    CRITICAL,
                    f"Large white rectangle detected at ({x},{y}) — possible rendering bug"
                ))
                return defects  # one is enough
    return defects


def check_empty_content(img: Image.Image) -> list[Defect]:
    """Check if the top half of the viewport is mostly empty/black."""
    defects = []
    h = min(img.size[1], VIEWPORT_H)
    top_half = (0, 0, img.size[0], h // 2)
    result = _region_stats(img, top_half)
    if result is None:
        return defects
    mean, stddev = result
    # Very dark and uniform = probably empty
    if all(m < 15 for m in mean[:3]) and all(s < 10 for s in stddev[:3]):
        defects.append(Defect(
            "empty_content",
            WARNING,
            "Top half of viewport appears empty/black — content may not have loaded"
        ))
    return defects


def check_avatar_obscured(img: Image.Image) -> list[Defect]:
    """Check if the Pearl avatar area is obscured by an overlay (uniform color)."""
    defects = []
    result = _region_stats(img, AVATAR_REGION)
    if result is None:
        return defects
    mean, stddev = result
    # If the avatar area is extremely uniform, it's likely covered by something
    if all(s < 3 for s in stddev[:3]):
        # But only flag if it's not just transparent/black background
        if not all(m < 10 for m in mean[:3]):
            defects.append(Defect(
                "zindex_overlap",
                WARNING,
                "Pearl avatar region appears obscured — possible z-index issue"
            ))
    return defects


def check_text_defects(img: Image.Image) -> list[Defect]:
    """Use OCR to detect broken template output or error text."""
    if not HAS_TESSERACT:
        return []
    defects = []
    try:
        text = pytesseract.image_to_string(img, timeout=10)
    except Exception:
        return defects

    # Raw JSON/dict dump
    if re.search(r"\[\{|\{\'|\":\s*\[", text):
        defects.append(Defect(
            "raw_data_dump",
            CRITICAL,
            "Raw JSON/dict text detected in screenshot — template rendering is broken"
        ))

    # Broken image placeholder
    if "image unavailable" in text.lower():
        defects.append(Defect(
            "broken_image",
            CRITICAL,
            '"Image unavailable" text detected — image failed to load'
        ))

    # Error messages
    if re.search(r"(traceback|error|exception|undefined)", text, re.IGNORECASE):
        defects.append(Defect(
            "error_text",
            WARNING,
            "Error-related text detected in screenshot"
        ))

    return defects


def check_missing_close_button(img: Image.Image) -> list[Defect]:
    """Heuristic: check top-right corner for a close button (X).
    
    The close button is typically a small light-colored element in the top-right.
    If the top-right corner is completely uniform/dark, it may be missing.
    """
    defects = []
    w = min(img.size[0], VIEWPORT_W)
    # Check top-right 50x50
    box = (w - 50, 0, w, 50)
    result = _region_stats(img, box)
    if result is None:
        return defects
    mean, stddev = result
    # If completely dark and uniform, the close button is probably missing
    if all(m < 20 for m in mean[:3]) and all(s < 5 for s in stddev[:3]):
        defects.append(Defect(
            "missing_close_button",
            INFO,
            "Top-right corner is dark/empty — close button may be missing"
        ))
    return defects


ALL_CHECKS = [
    check_white_boxes,
    check_empty_content,
    check_avatar_obscured,
    check_text_defects,
    check_missing_close_button,
]


# --- Main Logic ---

def parse_filename(filename: str) -> tuple[str, str]:
    """Extract timestamp and test name from filename like '20260305_034000_weather_card.png'."""
    stem = Path(filename).stem
    parts = stem.split("_", 2)
    if len(parts) >= 3:
        return f"{parts[0]}_{parts[1]}", parts[2]
    elif len(parts) == 2:
        return parts[0], parts[1]
    return "", stem


def analyze_screenshot(filepath: Path) -> TestResult:
    """Run all checks on a single screenshot."""
    timestamp, test_name = parse_filename(filepath.name)
    try:
        img = Image.open(filepath).convert("RGB")
    except Exception as e:
        return TestResult(
            filename=filepath.name,
            test_name=test_name,
            timestamp=timestamp,
            passed=False,
            defects=[Defect("load_error", CRITICAL, f"Could not open image: {e}")]
        )

    defects = []
    for check in ALL_CHECKS:
        defects.extend(check(img))

    return TestResult(
        filename=filepath.name,
        test_name=test_name,
        timestamp=timestamp,
        passed=len(defects) == 0,
        defects=defects,
    )


def generate_report(results: list[TestResult], output_path: Path) -> str:
    """Render the Markdown report using Jinja2 template."""
    env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)), autoescape=False)
    template = env.get_template("qa_report_template.md")

    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    severity_icon = {CRITICAL: "🔴", WARNING: "🟡", INFO: "🔵"}

    report = template.render(
        generated_at=now,
        total=len(results),
        passed=passed,
        failed=failed,
        results=results,
        severity_icon=severity_icon,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report)
    return report


def generate_discord_payload(results: list[TestResult]) -> dict:
    """Generate a Discord-ready summary payload."""
    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    critical = sum(1 for r in results if r.worst_severity == CRITICAL)

    status = "✅ ALL PASSED" if failed == 0 else f"❌ {failed} FAILED"
    if critical:
        status += f" ({critical} critical)"

    summary_lines = [f"**PearlOS QA Report** — {status}", f"Tests: {passed}/{len(results)} passed", ""]
    for r in results:
        icon = "✅" if r.passed else "❌"
        detail = ""
        if r.defects:
            detail = " — " + "; ".join(d.name for d in r.defects)
        summary_lines.append(f"{icon} `{r.test_name}`{detail}")

    return {
        "message": "\n".join(summary_lines),
        "passed": passed,
        "failed": failed,
        "critical": critical,
    }


def main():
    parser = argparse.ArgumentParser(description="PearlOS QA Screenshot Reviewer")
    parser.add_argument("--results-dir", type=Path, default=RESULTS_DIR)
    parser.add_argument("--output", type=Path, default=REPORT_PATH)
    parser.add_argument("--discord-json", action="store_true", help="Print Discord payload to stdout")
    args = parser.parse_args()

    # Look for screenshots in the results dir itself, or in the latest subdirectory
    screenshots = sorted(args.results_dir.glob("*.png"))
    if not screenshots:
        # qa_runner saves into timestamped subdirectories — find the latest one
        subdirs = sorted(
            [d for d in args.results_dir.iterdir() if d.is_dir()],
            key=lambda d: d.name,
            reverse=True,
        )
        for subdir in subdirs:
            screenshots = sorted(subdir.glob("*.png"))
            if screenshots:
                print(f"Using screenshots from subdirectory: {subdir}")
                break
    if not screenshots:
        print(f"No screenshots found in {args.results_dir} or its subdirectories", file=sys.stderr)
        sys.exit(1)

    print(f"Analyzing {len(screenshots)} screenshots...")
    results = [analyze_screenshot(s) for s in screenshots]

    report = generate_report(results, args.output)
    print(f"Report written to {args.output}")

    passed = sum(1 for r in results if r.passed)
    failed = len(results) - passed
    print(f"Results: {passed} passed, {failed} failed out of {len(results)} tests")

    if args.discord_json:
        payload = generate_discord_payload(results)
        print("\n--- Discord Payload ---")
        print(json.dumps(payload, indent=2))

    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
