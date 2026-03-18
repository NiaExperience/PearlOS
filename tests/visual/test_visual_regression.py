"""Visual regression tests — screenshot major PearlOS views and compare to baselines."""
import os
import pytest
from conftest import BASE_URL, ASSISTANT_ID, BASELINES_DIR
from utils.screenshot_diff import compare_screenshots, save_baseline

UPDATE_BASELINES = os.getenv("UPDATE_BASELINES", "0") == "1"

VIEWS = {
    "home_desktop": f"/{ASSISTANT_ID}",
    "settings": "/settings",
}


def _screenshot_view(page, view_name: str, path: str, wait_ms: int = 5000):
    """Navigate to a view and take a screenshot."""
    url = f"{BASE_URL}{path}"
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(wait_ms)  # let animations/hydration settle
    
    actual_dir = os.path.join(os.path.dirname(__file__), "..", "screenshots")
    os.makedirs(actual_dir, exist_ok=True)
    actual_path = os.path.join(actual_dir, f"{view_name}.png")
    page.screenshot(path=actual_path, full_page=True)
    return actual_path


class TestVisualRegression:
    """Screenshot major views and compare against baselines."""

    @pytest.mark.parametrize("view_name,path", list(VIEWS.items()))
    def test_view_screenshot(self, page, view_name, path):
        actual_path = _screenshot_view(page, view_name, path)
        baseline_path = os.path.join(BASELINES_DIR, f"{view_name}.png")

        if UPDATE_BASELINES or not os.path.exists(baseline_path):
            with open(actual_path, "rb") as f:
                save_baseline(f.read(), view_name, BASELINES_DIR)
            pytest.skip(f"Baseline saved for {view_name}")
            return

        result = compare_screenshots(actual_path, baseline_path)
        assert result["match"], (
            f"Visual regression in {view_name}: {result['diff_ratio']*100:.1f}% pixels differ "
            f"(threshold 2%). Run with UPDATE_BASELINES=1 to update."
        )
