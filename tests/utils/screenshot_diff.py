"""Perceptual screenshot diff utility."""
import os
from pathlib import Path


def compare_screenshots(actual_path: str, baseline_path: str, threshold: float = 0.02) -> dict:
    """Compare two screenshots. Returns dict with match status and diff info.
    
    Uses pixel-level comparison. threshold is fraction of pixels allowed to differ.
    """
    try:
        from PIL import Image
        import struct
        import zlib
    except ImportError:
        # Fallback: byte-level comparison
        with open(actual_path, "rb") as f1, open(baseline_path, "rb") as f2:
            match = f1.read() == f2.read()
        return {"match": match, "method": "byte", "diff_ratio": 0.0 if match else 1.0}

    img1 = Image.open(actual_path).convert("RGB")
    img2 = Image.open(baseline_path).convert("RGB")

    if img1.size != img2.size:
        return {"match": False, "method": "pillow", "diff_ratio": 1.0, "reason": "size_mismatch"}

    pixels1 = list(img1.getdata())
    pixels2 = list(img2.getdata())
    total = len(pixels1)
    diff_count = sum(1 for a, b in zip(pixels1, pixels2) if _pixel_diff(a, b) > 30)
    ratio = diff_count / total if total else 0

    return {
        "match": ratio <= threshold,
        "method": "pillow",
        "diff_ratio": round(ratio, 4),
        "diff_pixels": diff_count,
        "total_pixels": total,
    }


def _pixel_diff(a: tuple, b: tuple) -> float:
    """Euclidean distance between two RGB pixels."""
    return ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) ** 0.5


def save_baseline(screenshot_bytes: bytes, name: str, baselines_dir: str) -> str:
    """Save screenshot as baseline. Returns path."""
    os.makedirs(baselines_dir, exist_ok=True)
    path = os.path.join(baselines_dir, f"{name}.png")
    with open(path, "wb") as f:
        f.write(screenshot_bytes)
    return path
