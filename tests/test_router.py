"""Phase 1: Non-blocking router logic tests."""
from processors.non_blocking_router import DIRECT_TOOLS, _CANVAS_INTENT_KEYWORDS


class TestDirectTools:
    def test_open_news_not_in_direct_tools(self):
        """Regression guard: open_news must NOT be in DIRECT_TOOLS."""
        assert "open_news" not in DIRECT_TOOLS

    def test_known_tools_present(self):
        expected = [
            "open_notes", "close_notes",
            "open_youtube", "close_youtube",
            "open_terminal", "close_terminal",
            "switch_desktop", "switch_home", "switch_work",
            "clear_canvas", "end_call",
            "play_soundtrack", "stop_soundtrack", "next_track",
        ]
        for tool in expected:
            assert tool in DIRECT_TOOLS, f"'{tool}' missing from DIRECT_TOOLS"

    def test_close_tools_emit_apps_close(self):
        for name, (event, _) in DIRECT_TOOLS.items():
            if name.startswith("close_"):
                assert event == "apps.close", f"{name} emits '{event}' not 'apps.close'"

    def test_open_tools_emit_app_open(self):
        for name, (event, _) in DIRECT_TOOLS.items():
            if name.startswith("open_"):
                assert event == "app.open", f"{name} emits '{event}' not 'app.open'"

    def test_switch_tools_emit_desktop_mode_switch(self):
        for name, (event, _) in DIRECT_TOOLS.items():
            if name.startswith("switch_"):
                assert event == "desktop.mode.switch", f"{name} emits '{event}'"


class TestCanvasIntentKeywords:
    def test_all_lowercase(self):
        for kw in _CANVAS_INTENT_KEYWORDS:
            assert kw == kw.lower(), f"Keyword '{kw}' is not lowercase"

    def test_critical_keywords_present(self):
        kw_set = set(_CANVAS_INTENT_KEYWORDS)
        for expected in ["galaxy", "canvas", "scene", "show me a"]:
            assert expected in kw_set, f"'{expected}' missing from canvas intent keywords"
