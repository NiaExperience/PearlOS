"""Shared fixtures for PearlOS tests."""
import os
import sys

import pytest

# Phase 1: bot code on path
sys.path.insert(0, "/workspace/nia-universal/apps/pipecat-daily-bot/bot")

# Legacy constants (used by api/ smoke/ visual/ tests)
BASE_URL = os.getenv("PEARLOS_BASE_URL", "http://localhost:3000")
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:4444")
OPENCLAW_URL = os.getenv("OPENCLAW_URL", "http://localhost:18789")
ASSISTANT_ID = os.getenv("PEARLOS_ASSISTANT_ID", "pearlos")
BASELINES_DIR = os.path.join(os.path.dirname(__file__), "baselines")

try:
    from playwright.sync_api import sync_playwright

    @pytest.fixture(scope="session")
    def browser_context():
        """Launch headless Chromium and yield a browser context."""
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(
                viewport={"width": 1280, "height": 720},
                ignore_https_errors=True,
            )
            yield context
            context.close()
            browser.close()

    @pytest.fixture
    def page(browser_context):
        """Fresh page per test."""
        p = browser_context.new_page()
        yield p
        p.close()

except ImportError:
    pass  # Playwright not installed — skip browser fixtures
