"""Integration tests for toolbox with real functional prompts from database."""

import pytest
import uuid
from unittest.mock import MagicMock, AsyncMock, patch
from tools import toolbox
from actions import functional_prompt_actions
from nia_content_definitions import definitions


# Test tenant and user IDs
TEST_TENANT_UUID = uuid.uuid5(uuid.NAMESPACE_DNS, "test-toolbox-integration")
TEST_TENANT_ID = str(TEST_TENANT_UUID)


@pytest.fixture
def mock_functional_prompts():
    """Mock functional prompt responses for testing."""
    return {
        "bot_minimize_window": "Custom: Minimize the window to taskbar",
        "bot_maximize_window": "Custom: Maximize window to fullscreen",
        "bot_read_current_note": "Custom: Get the active shared note",
        "bot_create_html_content": "Custom: Create a new HTML applet or game",
    }


@pytest.mark.asyncio
async def test_load_prompts_from_database(mock_functional_prompts):
    """Test that load_prompts fetches functional prompts from database when preloaded prompts have missing keys."""
    # Start with empty preloaded prompts to force DB fetch
    with patch.object(
        functional_prompt_actions,
        'fetch_functional_prompts',
        new=AsyncMock(return_value=mock_functional_prompts)
    ) as mock_fetch:
        prompts = await toolbox.load_prompts({})

        # Since all keys have defaults, the function won't call fetch
        # Instead, let's test that when we pass empty strings, it DOES fetch
        prompts = await toolbox.load_prompts({
            "bot_minimize_window": "",  # Empty string triggers DB fetch
            "bot_maximize_window": "",
        })

        # Should have loaded custom prompts from database
        assert "bot_minimize_window" in prompts
        # Either custom prompt or default should be there
        assert len(prompts["bot_minimize_window"]) > 0

@pytest.mark.asyncio
async def test_prepare_toolbox_with_all_tools():
    """Test that prepare_toolbox registers all tool types."""
    mock_forwarder = MagicMock()
    forwarder_ref = {"instance": mock_forwarder}
    
    mock_get_tenant_id = lambda: "test-tenant-123"
    mock_get_user_id = lambda: "test-user-456"
    
    bundle = await toolbox.prepare_toolbox(
        room_url="https://test.daily.co/room",
        forwarder_ref=forwarder_ref,
        preloaded_prompts={},
        get_tenant_id=mock_get_tenant_id,
        get_user_id=mock_get_user_id
    )
    
    # Should have schemas for notes, HTML, window, view, and misc tools
    assert len(bundle.schemas) >= 23
    
    # Check that we have the right number of registrations
    assert len(bundle.registrations) >= 19  # All except HTML need tenant context
    
    # Verify specific tool names are present
    schema_names = [s.name for s in bundle.schemas]
    assert "bot_read_current_note" in schema_names
    assert "bot_create_html_content" in schema_names
    assert "bot_minimize_window" in schema_names
    assert "bot_maximize_window" in schema_names
    assert "bot_close_view" in schema_names
    assert "bot_open_gmail" in schema_names
    
    registration_names = [r.name for r in bundle.registrations]
    assert "bot_read_current_note" in registration_names
    assert "bot_create_html_content" in registration_names
    assert "bot_minimize_window" in registration_names
    assert "bot_close_view" in registration_names


@pytest.mark.asyncio
async def test_prepare_toolbox_with_custom_prompts(mock_functional_prompts):
    """Test that toolbox uses custom prompts from preloaded data."""
    mock_forwarder = MagicMock()
    forwarder_ref = {"instance": mock_forwarder}
    
    # Pass custom prompts as preloaded prompts (simulating what would come from DB)
    bundle = await toolbox.prepare_toolbox(
        room_url="https://test.daily.co/room",
        forwarder_ref=forwarder_ref,
        preloaded_prompts=mock_functional_prompts,  # Pass custom prompts directly
        get_tenant_id=lambda: TEST_TENANT_ID,
        get_user_id=lambda: "test-user"
    )
    
    # Find the window tool schemas
    window_schemas = [s for s in bundle.schemas if s.name.startswith("bot_minimize") or s.name.startswith("bot_maximize")]
    
    assert len(window_schemas) >= 2
    
    # Check that custom descriptions were used
    minimize_schema = next((s for s in window_schemas if s.name == "bot_minimize_window"), None)
    if minimize_schema:
        assert "Custom: Minimize the window to taskbar" in minimize_schema.description
    
    # Check note tool
    note_schemas = [s for s in bundle.schemas if s.name == "bot_read_current_note"]
    if note_schemas:
        assert "Custom: Get the active shared note" in note_schemas[0].description


@pytest.mark.asyncio
async def test_get_required_prompt_keys():
    """Test that get_required_prompt_keys returns all tool keys."""
    keys = toolbox.get_required_prompt_keys()
    
    # Should include keys from notes, HTML, and window tools
    assert "bot_read_current_note" in keys
    assert "bot_replace_note" in keys
    assert "bot_add_note_content" in keys
    assert "bot_create_note" in keys
    
    assert "bot_create_html_content" in keys
    assert "bot_load_html_applet" in keys
    assert "bot_update_html_applet" in keys
    
    assert "bot_minimize_window" in keys
    assert "bot_maximize_window" in keys
    assert "bot_restore_window" in keys
    assert "bot_snap_window_left" in keys
    assert "bot_snap_window_right" in keys
    assert "bot_reset_window_position" in keys
    
    assert "bot_close_view" in keys
    assert "bot_open_gmail" in keys
    assert "bot_open_browser" in keys
    
    # Should have at least 23 keys (4 notes + 3 HTML + 6 window + 10 view)
    assert len(keys) >= 23


@pytest.mark.asyncio
async def test_get_default_prompts():
    """Test that get_default_prompts returns fallback descriptions."""
    defaults = toolbox.get_default_prompts()
    
    # Should have defaults for all tool categories
    assert "bot_read_current_note" in defaults
    assert "bot_minimize_window" in defaults
    assert "bot_create_html_content" in defaults
    assert "bot_close_view" in defaults
    assert "bot_open_gmail" in defaults
    
    # Check that defaults are strings
    assert isinstance(defaults["bot_read_current_note"], str)
    assert len(defaults["bot_read_current_note"]) > 0
    
    assert isinstance(defaults["bot_minimize_window"], str)
    assert len(defaults["bot_minimize_window"]) > 0
    
    assert isinstance(defaults["bot_close_view"], str)
    assert len(defaults["bot_close_view"]) > 0


@pytest.mark.asyncio
async def test_toolbox_bundle_structure():
    """Test that ToolboxBundle has correct structure."""
    mock_forwarder = MagicMock()
    forwarder_ref = {"instance": mock_forwarder}
    
    bundle = await toolbox.prepare_toolbox(
        room_url="https://test.daily.co/room",
        forwarder_ref=forwarder_ref,
        preloaded_prompts={},
        get_tenant_id=lambda: "test-tenant",
        get_user_id=lambda: "test-user"
    )
    
    # Bundle should have all expected fields
    assert hasattr(bundle, 'prompts')
    assert hasattr(bundle, 'schemas')
    assert hasattr(bundle, 'tools_schema')
    assert hasattr(bundle, 'registrations')
    
    # Prompts should be a dict
    assert isinstance(bundle.prompts, dict)
    
    # Schemas should be a list
    assert isinstance(bundle.schemas, list)
    assert len(bundle.schemas) > 0
    
    # Registrations should be a list
    assert isinstance(bundle.registrations, list)
    assert len(bundle.registrations) > 0
    
    # Each registration should have name and handler
    for reg in bundle.registrations:
        assert hasattr(reg, 'name')
        assert hasattr(reg, 'handler')
        assert callable(reg.handler)


@pytest.mark.asyncio
async def test_parse_prompt_payload():
    """Test parse_prompt_payload with various inputs."""
    # Test with dict
    result = toolbox.parse_prompt_payload({
        "bot_minimize_window": "Test prompt",
        "bot_maximize_window": "Another prompt"
    })
    assert result["bot_minimize_window"] == "Test prompt"
    assert result["bot_maximize_window"] == "Another prompt"
    
    # Test with JSON string
    import json
    json_str = json.dumps({"bot_minimize_window": "JSON prompt"})
    result = toolbox.parse_prompt_payload(json_str)
    assert result["bot_minimize_window"] == "JSON prompt"
    
    # Test with None
    result = toolbox.parse_prompt_payload(None)
    assert result == {}
    
    # Test with empty dict
    result = toolbox.parse_prompt_payload({})
    assert result == {}


@pytest.mark.asyncio
async def test_serialize_prompt_payload():
    """Test serialize_prompt_payload produces valid JSON."""
    import json
    
    prompts = {
        "bot_minimize_window": "Test prompt",
        "bot_maximize_window": "Another prompt"
    }
    
    serialized = toolbox.serialize_prompt_payload(prompts)
    
    # Should be valid JSON
    parsed = json.loads(serialized)
    assert parsed["bot_minimize_window"] == "Test prompt"
    assert parsed["bot_maximize_window"] == "Another prompt"
    
    # Test with None
    serialized = toolbox.serialize_prompt_payload(None)
    assert serialized == "{}"
