"""Phase 1: Tool discovery tests."""
import pytest
from tools.discovery import get_discovery


@pytest.fixture(scope="module")
def discovery():
    return get_discovery()


@pytest.fixture(scope="module")
def tool_names(discovery):
    tools = discovery.discover_tools()
    if isinstance(tools, dict):
        return list(tools.keys())
    return [t.get("function", {}).get("name", "") for t in tools if isinstance(t, dict)]


class TestToolDiscovery:
    def test_tool_count(self, discovery):
        tools = discovery.discover_tools()
        assert len(tools) >= 15, f"Expected >= 15 tools, got {len(tools)}"

    def test_critical_tools_exist(self, tool_names):
        critical = [
            "bot_switch_desktop_mode",
            "bot_open_news",
            "bot_open_notes",
            "bot_get_weather",
            "bot_wonder_canvas_scene",
            "bot_web_search",
        ]
        for name in critical:
            assert name in tool_names, f"Critical tool '{name}' not found"
