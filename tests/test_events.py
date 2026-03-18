"""Phase 1: Event constant tests."""
from processors.non_blocking_router import DIRECT_TOOLS


class TestEventConstants:
    """Verify event string constants used in DIRECT_TOOLS."""

    def test_wonder_clear(self):
        assert DIRECT_TOOLS["clear_canvas"][0] == "wonder.clear"

    def test_app_open_notes(self):
        assert DIRECT_TOOLS["open_notes"][0] == "app.open"

    def test_apps_close_notes(self):
        assert DIRECT_TOOLS["close_notes"][0] == "apps.close"

    def test_desktop_mode_switch(self):
        assert DIRECT_TOOLS["switch_desktop"][0] == "desktop.mode.switch"

    def test_open_youtube(self):
        assert DIRECT_TOOLS["open_youtube"][0] == "app.open"

    def test_close_youtube(self):
        assert DIRECT_TOOLS["close_youtube"][0] == "apps.close"

    def test_end_call(self):
        assert DIRECT_TOOLS["end_call"][0] == "bot.session.end"

    def test_soundtrack_control(self):
        assert DIRECT_TOOLS["play_soundtrack"][0] == "soundtrack.control"
