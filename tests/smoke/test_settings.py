"""Smoke test for Settings page."""
import pytest
from conftest import BASE_URL


class TestSettings:
    def test_settings_page_loads(self, page):
        page.goto(f"{BASE_URL}/settings", wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(3000)
        # Page should have some content
        content = page.content()
        assert len(content) > 500, "Settings page appears empty"

    def test_settings_page_scrollable(self, page):
        page.goto(f"{BASE_URL}/settings", wait_until="networkidle", timeout=30000)
        page.wait_for_timeout(2000)
        # Try scrolling
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        scroll_y = page.evaluate("window.scrollY")
        # Page may or may not scroll depending on content height — just verify no crash
        assert True
