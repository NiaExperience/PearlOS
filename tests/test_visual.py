"""Phase 2A: Headless Chrome visual rendering tests for all Wonder Canvas templates."""
import os
import pytest

from tools.wonder_canvas_templates import (
    render_template,
    get_template_names,
    TEMPLATE_DEFAULTS,
)

SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
ALL_NAMES = get_template_names()


@pytest.fixture(scope="module", autouse=True)
def ensure_screenshot_dir():
    os.makedirs(SCREENSHOT_DIR, exist_ok=True)


@pytest.fixture(scope="module")
def playwright_page():
    """Single browser page reused across all visual tests."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        yield page
        browser.close()


@pytest.mark.visual
class TestVisualTemplates:
    """Render every template in headless Chrome and screenshot it."""

    @pytest.mark.parametrize("name", ALL_NAMES)
    def test_screenshot(self, name, playwright_page):
        """Render template, take screenshot, assert no JS errors and file > 1KB."""
        console_errors = []

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(msg.text)

        playwright_page.on("console", on_console)

        defaults = TEMPLATE_DEFAULTS.get(name, {})
        html = render_template(name, **defaults)

        playwright_page.set_content(html, wait_until="domcontentloaded")
        playwright_page.wait_for_timeout(500)

        path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
        playwright_page.screenshot(path=path)

        playwright_page.remove_listener("console", on_console)

        assert os.path.exists(path), f"Screenshot not saved for {name}"
        size = os.path.getsize(path)
        assert size > 1024, f"Screenshot for {name} too small ({size} bytes)"
        assert not console_errors, f"JS console errors for {name}: {console_errors}"
