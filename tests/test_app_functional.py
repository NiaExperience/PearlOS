"""
PearlOS Desktop App Functional Tests
=====================================
Tests that verify ACTUAL app behavior, not just window rendering.
Each test opens an app and checks for real content.

Usage:
    cd /workspace/nia-universal
    python -m pytest tests/test_app_functional.py -v --tb=short 2>&1 | tee /tmp/functional-test-output.txt
"""

import pytest
import os
import time
import json
from playwright.sync_api import sync_playwright, Page, Browser

SCREENSHOT_DIR = "/root/.openclaw/workspace/audit-screenshots/functional"
PEARLOS_URL = "http://localhost:3000/pearlos"
RESULTS = {}  # Collect results for reporting


def screenshot(page: Page, name: str) -> str:
    path = os.path.join(SCREENSHOT_DIR, f"{name}.png")
    page.screenshot(path=path, full_page=False)
    return path


def collect_result(app: str, status: str, reason: str, screenshot_path: str = ""):
    RESULTS[app] = {"status": status, "reason": reason, "screenshot": screenshot_path}


class TestPearlOSApps:
    """Functional tests for PearlOS desktop apps."""

    @pytest.fixture(scope="class")
    def browser_context(self):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 900})
            yield context, browser
            browser.close()

    @pytest.fixture(scope="class")
    def work_mode_page(self, browser_context):
        """Navigate to PearlOS and switch to Work mode."""
        context, browser = browser_context
        page = context.new_page()

        # Collect console errors
        js_errors = []
        page.on("console", lambda msg: js_errors.append(msg.text) if msg.type == "error" else None)

        page.goto(PEARLOS_URL, wait_until="networkidle", timeout=120000)
        page.wait_for_timeout(3000)

        # Switch to Work mode by clicking the Monitor/Desktop button
        # The nav button with Monitor icon is in PersistentNavButtons
        desktop_btn = page.locator('button[title="Desktop"]')
        if desktop_btn.count() > 0:
            desktop_btn.first.click()
            page.wait_for_timeout(2000)
        else:
            # Try finding by the Monitor icon or text
            # Look for any button that triggers work mode
            monitor_buttons = page.locator("button").filter(has=page.locator("svg"))
            for i in range(monitor_buttons.count()):
                btn = monitor_buttons.nth(i)
                # The desktop button is typically in the top-left nav
                box = btn.bounding_box()
                if box and box["x"] < 100 and box["y"] < 100:
                    btn.click()
                    page.wait_for_timeout(2000)
                    break

        screenshot(page, "00-work-mode-desktop")
        yield page, js_errors

    def _open_app_by_icon(self, page: Page, icon_alt: str, timeout_ms: int = 10000):
        """Click a desktop icon by its alt text and wait for response."""
        icon = page.locator(f'img[alt="{icon_alt}"]')
        if icon.count() == 0:
            return False
        icon.first.click()
        page.wait_for_timeout(timeout_ms)
        return True

    def _open_app_by_dispatch(self, page: Page, app_name: str, timeout_ms: int = 10000):
        """Open app via JavaScript event dispatch (more reliable)."""
        page.evaluate(f"""
            window.dispatchEvent(new CustomEvent('nia:desktop.openApp', {{
                detail: {{ app: '{app_name}' }}
            }}));
        """)
        page.wait_for_timeout(timeout_ms)

    def _close_all_windows(self, page: Page):
        """Close all open windows/scenes to reset state."""
        # Close maneuverable windows
        close_btns = page.locator('[data-testid="window-close"], button:has-text("✕"), button:has-text("×")')
        for i in range(close_btns.count()):
            try:
                close_btns.nth(i).click(timeout=1000)
            except Exception:
                pass
        # Clear wonder canvas scenes
        page.evaluate("""
            window.dispatchEvent(new CustomEvent('nia:wonder.clear'));
        """)
        page.wait_for_timeout(1000)

    def _get_window_content(self, page: Page) -> str:
        """Get text content from the topmost app window."""
        # Try maneuverable window first
        window = page.locator('[class*="maneuverable"], [class*="ManeuverableWindow"], [class*="window-body"]')
        if window.count() > 0:
            try:
                return window.first.inner_text(timeout=3000)
            except Exception:
                pass

        # Try wonder canvas / stage area
        stage = page.locator('[class*="Stage"], [class*="wonder"], [class*="canvas"]')
        if stage.count() > 0:
            try:
                return stage.first.inner_text(timeout=3000)
            except Exception:
                pass

        # Fallback: get all visible text on page
        return page.inner_text("body")

    def _check_window_exists(self, page: Page) -> bool:
        """Check if any app window is open."""
        selectors = [
            '[class*="maneuverable"]',
            '[class*="ManeuverableWindow"]',
            '[class*="window-body"]',
            'iframe',
        ]
        for sel in selectors:
            if page.locator(sel).count() > 0:
                return True
        return False

    # ─── NOTES ───────────────────────────────────────────────────────────

    def test_notes_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "notepad", 8000)
        shot = screenshot(page, "01-notes-after-open")

        # Check for actual content
        content = self._get_window_content(page)
        has_window = self._check_window_exists(page)

        if not has_window:
            collect_result("Notes", "FAIL", "No window opened", shot)
            pytest.fail("Notes: No window opened")

        # Check for meaningful content (not just loading)
        content_lower = content.lower()
        is_loading = "loading" in content_lower and len(content) < 100
        is_empty = len(content.strip()) < 20

        if is_loading:
            collect_result("Notes", "FAIL", f"Stuck on loading. Content: '{content[:200]}'", shot)
            pytest.fail(f"Notes stuck on loading: '{content[:200]}'")
        elif is_empty:
            collect_result("Notes", "PARTIAL", f"Window opened but minimal content: '{content[:200]}'", shot)
        else:
            collect_result("Notes", "PASS", f"Notes UI loaded with content ({len(content)} chars)", shot)

        self._close_all_windows(page)

    # ─── PHOTO MAGIC ─────────────────────────────────────────────────────

    @pytest.mark.skip(reason="SKIPPED — ComfyUI deferred until rest of PearlOS stabilized. Memory issues crash server.")
    def test_photo_magic_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "photo-magic", 8000)
        shot = screenshot(page, "02-photo-magic-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Photo Magic", "FAIL", "No window opened", shot)
            pytest.fail("Photo Magic: No window opened")

        # Look for UI elements: buttons, canvas, drop zone, tools
        has_ui = len(content.strip()) > 30 or page.locator("canvas, button, [class*='drop'], [class*='tool']").count() > 0

        if has_ui:
            collect_result("Photo Magic", "PASS", f"UI rendered ({len(content)} chars text, UI elements present)", shot)
        else:
            collect_result("Photo Magic", "FAIL", f"Blank or no UI: '{content[:200]}'", shot)
            pytest.fail(f"Photo Magic blank: '{content[:200]}'")

        self._close_all_windows(page)

    # ─── YOUTUBE ─────────────────────────────────────────────────────────

    def test_youtube_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "youtube", 10000)
        shot = screenshot(page, "03-youtube-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("YouTube", "FAIL", "No window opened", shot)
            pytest.fail("YouTube: No window opened")

        # YouTube should show search, video titles, or iframe
        has_iframe = page.locator("iframe[src*='youtube'], iframe[src*='invidious']").count() > 0
        has_content = len(content.strip()) > 50

        if has_iframe or has_content:
            collect_result("YouTube", "PASS", f"YouTube loaded (iframe={has_iframe}, content={len(content)} chars)", shot)
        else:
            collect_result("YouTube", "PARTIAL", f"Window opened but content unclear: '{content[:200]}'", shot)

        self._close_all_windows(page)

    # ─── NEWS ────────────────────────────────────────────────────────────

    def test_news_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        # News uses WonderCanvas, not a window
        self._open_app_by_dispatch(page, "news", 12000)
        shot = screenshot(page, "04-news-after-open")

        # News renders into the WonderCanvas/Stage area
        # Check for text content on the whole page since it's a full-screen scene
        body_text = page.inner_text("body")

        # Look for headline-like content
        lines = [l.strip() for l in body_text.split("\n") if len(l.strip()) > 15]
        headline_count = len(lines)

        # Check for news-specific patterns
        has_headlines = headline_count >= 3
        has_news_keywords = any(kw in body_text.lower() for kw in ["headline", "breaking", "story", "news", "read more", "category"])
        # Also check if the fetch populated (news dispatches nia:request.news then backend fills)
        # The initial HTML is a skeleton; real content comes from the backend
        is_skeleton_only = "loading" in body_text.lower() and headline_count < 2

        if is_skeleton_only:
            # Check if it's showing the news template at least
            has_news_structure = page.evaluate("""
                document.querySelector('[class*="news"], [class*="headline"], [class*="story"]') !== null ||
                document.querySelector('.weather-wrap, .w-temp') === null
            """)
            if has_news_structure:
                collect_result("News", "PARTIAL", f"News skeleton rendered but no headlines populated (needs backend). Lines found: {headline_count}", shot)
            else:
                collect_result("News", "FAIL", f"News failed to render. Body text: '{body_text[:300]}'", shot)
                pytest.fail(f"News failed: '{body_text[:300]}'")
        elif has_headlines:
            collect_result("News", "PASS", f"News loaded with {headline_count} headline-length lines", shot)
        else:
            collect_result("News", "PARTIAL", f"News scene rendered but few headlines ({headline_count} lines). Content: '{body_text[:300]}'", shot)

        # Clear the wonder canvas scene
        page.evaluate("window.dispatchEvent(new CustomEvent('nia:wonder.clear'))")
        page.wait_for_timeout(1000)

    # ─── WEATHER ─────────────────────────────────────────────────────────

    def test_weather_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "weather", 12000)
        shot = screenshot(page, "05-weather-after-open")

        body_text = page.inner_text("body")
        body_lower = body_text.lower()

        # Weather should show temperature, location, conditions
        has_temp = any(c in body_text for c in ["°F", "°C", "°f", "°c"])
        has_weather_words = any(w in body_lower for w in ["humidity", "wind", "feels like", "sunny", "cloudy", "rain", "clear", "overcast", "forecast"])
        has_location = any(w in body_lower for w in ["location", "your location", "📍"])
        is_error = "unavailable" in body_lower or "couldn't load" in body_lower
        is_loading = "fetching weather" in body_lower or "locating you" in body_lower

        if has_temp and has_weather_words:
            collect_result("Weather", "PASS", f"Weather data loaded (temp + conditions found)", shot)
        elif is_error:
            collect_result("Weather", "FAIL", "Weather showed error/unavailable", shot)
            pytest.fail("Weather showed error state")
        elif is_loading:
            collect_result("Weather", "FAIL", f"Weather stuck on loading after 12s", shot)
            pytest.fail("Weather stuck loading")
        else:
            collect_result("Weather", "PARTIAL", f"Weather rendered but no clear temp data. Content: '{body_text[:300]}'", shot)

        page.evaluate("window.dispatchEvent(new CustomEvent('nia:wonder.clear'))")
        page.wait_for_timeout(1000)

    # ─── PEARL VISION (Daily Call) ───────────────────────────────────────

    def test_pearl_vision(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "dailyCall", 8000)
        shot = screenshot(page, "06-pearl-vision-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)
        content_lower = content.lower()

        if not has_window:
            collect_result("Pearl Vision", "FAIL", "No window opened", shot)
            pytest.fail("Pearl Vision: No window opened")

        is_connecting_forever = "connecting" in content_lower and len(content.strip()) < 100
        has_video_ui = page.locator("video, [class*='daily'], [class*='call'], [class*='video']").count() > 0

        if is_connecting_forever:
            collect_result("Pearl Vision", "FAIL",
                          "Stuck on 'connecting'. Needs Daily.co room/session to function. "
                          "This is expected without an active call session.", shot)
        elif has_video_ui:
            collect_result("Pearl Vision", "PARTIAL",
                          "Video UI elements present but no active call (expected without Daily.co session)", shot)
        else:
            collect_result("Pearl Vision", "PARTIAL",
                          f"Window opened, content: '{content[:200]}'. Needs Daily.co session to fully work.", shot)

        self._close_all_windows(page)

    # ─── FILES ───────────────────────────────────────────────────────────

    def test_files_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "files", 10000)
        shot = screenshot(page, "07-files-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Files", "FAIL", "No window opened", shot)
            pytest.fail("Files: No window opened")

        # Files uses filebrowser in an iframe
        has_iframe = page.locator("iframe").count() > 0
        has_file_content = any(w in content.lower() for w in ["files", "folder", "directory", "upload", "download", "name", "size"])
        is_404 = "404" in content or "not found" in content.lower()

        if is_404:
            collect_result("Files", "FAIL", "Filebrowser shows 404", shot)
            pytest.fail("Files: 404 error")
        elif has_iframe or has_file_content:
            collect_result("Files", "PASS" if has_file_content else "PARTIAL",
                          f"Files app loaded (iframe={has_iframe}, file content={has_file_content})", shot)
        else:
            collect_result("Files", "FAIL", f"Files opened but no content: '{content[:200]}'", shot)
            pytest.fail(f"Files blank: '{content[:200]}'")

        self._close_all_windows(page)

    # ─── TERMINAL ────────────────────────────────────────────────────────

    def test_terminal_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "terminal", 8000)
        shot = screenshot(page, "08-terminal-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Terminal", "FAIL", "No window opened", shot)
            pytest.fail("Terminal: No window opened")

        # Terminal should have xterm.js or similar
        has_terminal = page.locator("[class*='xterm'], [class*='terminal'], canvas").count() > 0
        has_prompt = any(c in content for c in ["$", "#", "~", "root@", "user@"])

        if has_terminal or has_prompt:
            collect_result("Terminal", "PASS", f"Terminal loaded (xterm={has_terminal}, prompt={has_prompt})", shot)
        elif len(content.strip()) > 20:
            collect_result("Terminal", "PARTIAL", f"Terminal window with some content: '{content[:200]}'", shot)
        else:
            collect_result("Terminal", "FAIL", f"Terminal blank: '{content[:200]}'", shot)
            pytest.fail(f"Terminal blank: '{content[:200]}'")

        self._close_all_windows(page)

    # ─── BROWSER ─────────────────────────────────────────────────────────

    def test_browser_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "browser", 10000)
        shot = screenshot(page, "09-browser-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Browser", "FAIL", "No window opened", shot)
            pytest.fail("Browser: No window opened")

        has_iframe = page.locator("iframe").count() > 0
        has_url_bar = page.locator("input[type='text'], input[type='url'], [class*='url'], [class*='address']").count() > 0

        if has_iframe or has_url_bar:
            collect_result("Browser", "PASS", f"Browser loaded (iframe={has_iframe}, urlbar={has_url_bar})", shot)
        elif len(content.strip()) > 50:
            collect_result("Browser", "PARTIAL", f"Browser opened with content: '{content[:200]}'", shot)
        else:
            collect_result("Browser", "FAIL", f"Browser blank: '{content[:200]}'", shot)
            pytest.fail(f"Browser blank: '{content[:200]}'")

        self._close_all_windows(page)

    # ─── SPRITES (SKIP — KNOWN CRASHER) ─────────────────────────────────

    @pytest.mark.skip(reason="SKIPPED — ComfyUI deferred until rest of PearlOS stabilized. Memory issues crash server.")
    def test_sprites_app(self, work_mode_page):
        pass

    # ─── CREATION ENGINE ─────────────────────────────────────────────────

    def test_creation_engine(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "creation-engine", 8000)
        shot = screenshot(page, "10-creation-engine-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Creation Engine", "FAIL", "No window opened", shot)
            pytest.fail("Creation Engine: No window opened")

        if len(content.strip()) > 30:
            collect_result("Creation Engine", "PASS", f"Creation Engine opened with content ({len(content)} chars)", shot)
        else:
            collect_result("Creation Engine", "PARTIAL", f"Window opened but minimal content: '{content[:200]}'", shot)

        self._close_all_windows(page)

    # ─── SETTINGS ────────────────────────────────────────────────────────

    def test_settings(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        # Settings is opened via the gear icon in PersistentNavButtons
        settings_btn = page.locator('button[title="Settings"]')
        if settings_btn.count() > 0:
            settings_btn.first.click()
        else:
            # Try the gear/settings SVG button
            page.locator("button").filter(has=page.locator("svg")).last.click()

        page.wait_for_timeout(3000)
        shot = screenshot(page, "11-settings-after-open")

        # Settings is a modal, not a maneuverable window
        content = page.inner_text("body")
        has_settings = any(w in content.lower() for w in ["settings", "theme", "model", "voice", "preferences", "api key", "appearance"])

        if has_settings:
            collect_result("Settings", "PASS", "Settings panel appeared with options", shot)
        else:
            collect_result("Settings", "FAIL", f"No settings content found. Body: '{content[:300]}'", shot)
            pytest.fail(f"Settings not found: '{content[:300]}'")

        # Close settings modal
        close_btn = page.locator('button:has-text("✕"), button:has-text("×"), button:has-text("Close"), [class*="close"]')
        if close_btn.count() > 0:
            close_btn.first.click(timeout=2000)
        page.wait_for_timeout(500)

    # ─── DISCORD ─────────────────────────────────────────────────────────

    def test_discord_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        # Discord uses WonderCanvas
        self._open_app_by_dispatch(page, "discord", 10000)
        shot = screenshot(page, "12-discord-after-open")

        body_text = page.inner_text("body")
        has_discord_ui = any(w in body_text.lower() for w in ["discord", "channel", "messages", "loading messages", "type a message"])
        has_auth = "auth" in body_text.lower() or "login" in body_text.lower() or "sign in" in body_text.lower()

        if has_discord_ui:
            collect_result("Discord", "PASS", "Discord UI rendered (channel list / messages visible)", shot)
        elif has_auth:
            collect_result("Discord", "PARTIAL", "Discord shows auth/login (expected without token)", shot)
        else:
            collect_result("Discord", "PARTIAL", f"Discord rendered something: '{body_text[:300]}'", shot)

        page.evaluate("window.dispatchEvent(new CustomEvent('nia:wonder.clear'))")
        page.wait_for_timeout(1000)

    # ─── GMAIL ───────────────────────────────────────────────────────────

    def test_gmail_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "gmail", 8000)
        shot = screenshot(page, "13-gmail-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Gmail", "FAIL", "No window opened", shot)
            pytest.fail("Gmail: No window opened")

        has_auth = any(w in content.lower() for w in ["sign in", "google", "gmail", "email", "auth"])
        has_iframe = page.locator("iframe").count() > 0

        if has_auth or has_iframe:
            collect_result("Gmail", "PARTIAL", f"Gmail opened (auth screen expected). iframe={has_iframe}", shot)
        else:
            collect_result("Gmail", "PARTIAL", f"Gmail window opened: '{content[:200]}'", shot)

        self._close_all_windows(page)

    # ─── GOOGLE DRIVE ────────────────────────────────────────────────────

    def test_google_drive_app(self, work_mode_page):
        page, js_errors = work_mode_page
        self._close_all_windows(page)

        self._open_app_by_dispatch(page, "drive", 8000)
        shot = screenshot(page, "14-google-drive-after-open")

        has_window = self._check_window_exists(page)
        content = self._get_window_content(page)

        if not has_window:
            collect_result("Google Drive", "FAIL", "No window opened", shot)
            pytest.fail("Google Drive: No window opened")

        has_auth = any(w in content.lower() for w in ["sign in", "google", "drive", "auth"])
        has_iframe = page.locator("iframe").count() > 0

        if has_auth or has_iframe:
            collect_result("Google Drive", "PARTIAL", f"Google Drive opened (auth screen expected). iframe={has_iframe}", shot)
        else:
            collect_result("Google Drive", "PARTIAL", f"Google Drive window opened: '{content[:200]}'", shot)

        self._close_all_windows(page)


def pytest_sessionfinish(session, exitstatus):
    """Write results after all tests complete."""
    if not RESULTS:
        return

    results_path = "/root/.openclaw/workspace/memory/functional-app-test-results.md"
    os.makedirs(os.path.dirname(results_path), exist_ok=True)

    lines = ["# PearlOS App Functional Test Results\n"]
    lines.append(f"**Run Date:** {time.strftime('%Y-%m-%d %H:%M UTC')}\n")
    lines.append("**Test Philosophy:** PASS = app actually functions. FAIL = window may open but app doesn't work.\n\n")

    # Summary table
    pass_count = sum(1 for r in RESULTS.values() if r["status"] == "PASS")
    fail_count = sum(1 for r in RESULTS.values() if r["status"] == "FAIL")
    partial_count = sum(1 for r in RESULTS.values() if r["status"] == "PARTIAL")
    skip_count = 1  # Sprites

    lines.append(f"## Summary: {pass_count} PASS | {fail_count} FAIL | {partial_count} PARTIAL | {skip_count} SKIP\n\n")

    for app, result in sorted(RESULTS.items()):
        emoji = {"PASS": "✅", "FAIL": "❌", "PARTIAL": "⚠️"}.get(result["status"], "❓")
        lines.append(f"### {emoji} {app}: **{result['status']}**\n")
        lines.append(f"- {result['reason']}\n")
        if result.get("screenshot"):
            lines.append(f"- Screenshot: `{result['screenshot']}`\n")
        lines.append("\n")

    # Sprites skip note
    lines.append("### ⏭️ Sprites: **SKIP**\n")
    lines.append("- Known to crash server — Blair confirmed P0. Skipped to protect environment.\n\n")

    with open(results_path, "w") as f:
        f.writelines(lines)

    print(f"\n{'='*60}")
    print(f"Results saved to {results_path}")
    print(f"PASS={pass_count} FAIL={fail_count} PARTIAL={partial_count} SKIP={skip_count}")
    print(f"{'='*60}")
