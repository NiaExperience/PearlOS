"""Integration tests specifically for decorator-based tool discovery system.

These tests validate that the new decorator system correctly discovers and
integrates all 45 tools across 7 modules.
"""

import pytest
from tools.discovery import BotToolDiscovery
from tools import toolbox


class TestDecoratorDiscoveryIntegration:
    """Tests validating the decorator-based discovery system."""
    
    def test_discovery_finds_tools(self):
        """Verify BotToolDiscovery finds > 45 tools."""
        discovery = BotToolDiscovery()
        tools = discovery.discover_tools()
        
        assert len(tools) >= 45, f"Expected >45 tools, found {len(tools)}"
    
    def test_discovery_finds_features(self):
        """Verify all tool features are represented (misc tools have feature_flag=None)."""
        discovery = BotToolDiscovery()
        features = discovery.get_tool_features()
        
        expected_features = {'notes', 'maneuverableWindow', 'userProfile', 'youtube', 'htmlContent'}
        assert  expected_features.issubset(features), f"Missing features: {expected_features - set(features)}"
    
    def test_all_tools_have_required_metadata(self):
        """Verify all discovered tools have complete metadata."""
        discovery = BotToolDiscovery()
        tools = discovery.discover_tools()
        
        required_fields = ['name', 'description', 'feature_flag', 'parameters', 'passthrough', 'handler_function']
        
        for tool_name, metadata in tools.items():
            for field in required_fields:
                assert field in metadata, \
                    f"Tool '{tool_name}' missing required field '{field}'"
            
            # Verify types
            assert isinstance(metadata['name'], str)
            assert isinstance(metadata['description'], str)
            assert isinstance(metadata['feature_flag'], (str, type(None)))  # Can be None for misc/core tools
            assert isinstance(metadata['parameters'], dict)
            assert callable(metadata['handler_function'])
    
    def test_notes_tools_present(self):
        """Verify all 16 notes tools are discovered."""
        discovery = BotToolDiscovery()
        notes_tools = discovery.get_tools_by_feature('notes')
        
        expected_tools = [
            'bot_add_note_content',
            'bot_back_to_notes',
            'bot_create_note',
            'bot_delete_note',
            'bot_download_note',
            'bot_list_notes',
            'bot_open_note',
            'bot_read_current_note',
            'bot_remove_note_content',
            'bot_replace_note_content',
            'bot_replace_note',
            'bot_save_note',
            'bot_switch_note_mode'
        ]
        
        found_tools = set(notes_tools.keys())
        expected_set = set(expected_tools)
        
        assert expected_set.issubset(found_tools), \
            f"Missing: {expected_set - found_tools}"
    
    def test_window_tools_are_passthrough(self):
        """Verify all window tools have passthrough flag set."""
        discovery = BotToolDiscovery()
        window_tools = discovery.get_tools_by_feature('window')
        
        for tool_name, metadata in window_tools.items():
            passthrough = metadata['passthrough']
            # Handle both bool and dict formats
            is_passthrough = passthrough if isinstance(passthrough, bool) else bool(passthrough.get("run_llm", True) == False)
            assert is_passthrough, f"Window tool '{tool_name}' should be passthrough"

    def test_youtube_tools_present(self):
        """Verify all 4 youtube tools are discovered."""
        discovery = BotToolDiscovery()
        youtube_tools = discovery.get_tools_by_feature('youtube')
        
        expected_tools = [
            'bot_search_youtube_videos',
            'bot_play_youtube_video',
            'bot_play_next_youtube_video',
            'bot_pause_youtube_video',
            'bot_open_youtube',
            'bot_close_youtube'
        ]
        
        found_tools = set(youtube_tools.keys())
        expected_set = set(expected_tools)
        
        assert found_tools == expected_set, \
            f"Missing: {expected_set - found_tools}, Extra: {found_tools - expected_set}"
    
    def test_html_tools_present(self):
        """Verify all 4 html tools are discovered."""
        discovery = BotToolDiscovery()
        html_tools = discovery.get_tools_by_feature('htmlContent')
        
        expected_count = 6
        actual_count = len(html_tools)
        
        assert actual_count >= expected_count, \
            f"Expected {expected_count} html tools, found {actual_count}"
    
    def test_profile_tools_present(self):
        """Verify all 2 profile tools are discovered."""
        discovery = BotToolDiscovery()
        profile_tools = discovery.get_tools_by_feature('userProfile')
        
        expected_tools = ['bot_update_user_profile', 'bot_delete_profile_metadata']
        
        found_tools = set(profile_tools.keys())
        expected_set = set(expected_tools)
        
        assert found_tools == expected_set, \
            f"Missing: {expected_set - found_tools}, Extra: {found_tools - expected_set}"

class TestToolboxDiscoveryIntegration:
    """Tests validating toolbox integration with discovery system."""
    
    @pytest.mark.asyncio
    async def test_toolbox_uses_discovery_system(self):
        """Verify prepare_toolbox uses BotToolDiscovery."""
        from unittest.mock import MagicMock
        
        mock_forwarder = MagicMock()
        forwarder_ref = {"instance": mock_forwarder}
        
        bundle = await toolbox.prepare_toolbox(
            room_url="https://test.daily.co/room",
            forwarder_ref=forwarder_ref,
            preloaded_prompts={},
            get_tenant_id=lambda: "test-tenant",
            get_user_id=lambda: "test-user"
        )

        # Should have discovered > 49 tools
        assert len(bundle.schemas) >= 49, f"Expected > 49 schemas, found {len(bundle.schemas)}"
        assert len(bundle.registrations) >= 49, f"Expected > 49 registrations, found {len(bundle.registrations)}"
    
    @pytest.mark.asyncio
    async def test_toolbox_schemas_match_discovery(self):
        """Verify schemas from toolbox match discovery output."""
        from unittest.mock import MagicMock
        
        # Get schemas from toolbox
        mock_forwarder = MagicMock()
        forwarder_ref = {"instance": mock_forwarder}
        
        bundle = await toolbox.prepare_toolbox(
            room_url="https://test.daily.co/room",
            forwarder_ref=forwarder_ref,
            preloaded_prompts={},
            get_tenant_id=lambda: "test-tenant",
            get_user_id=lambda: "test-user"
        )
        
        # Get tools from discovery
        discovery = BotToolDiscovery()
        discovered_tools = discovery.discover_tools()
        
        # Verify counts match
        assert len(bundle.schemas) == len(discovered_tools)
        
        # Verify all discovered tool names appear in schemas
        schema_names = {s.name for s in bundle.schemas}
        discovered_names = set(discovered_tools.keys())
        
        assert schema_names == discovered_names, \
            f"Schema/Discovery mismatch. Missing from schemas: {discovered_names - schema_names}, Extra in schemas: {schema_names - discovered_names}"
    
    @pytest.mark.asyncio
    async def test_toolbox_handlers_are_callable(self):
        """Verify all handlers from toolbox are callable."""
        from unittest.mock import MagicMock
        
        mock_forwarder = MagicMock()
        forwarder_ref = {"instance": mock_forwarder}
        
        bundle = await toolbox.prepare_toolbox(
            room_url="https://test.daily.co/room",
            forwarder_ref=forwarder_ref,
            preloaded_prompts={},
            get_tenant_id=lambda: "test-tenant",
            get_user_id=lambda: "test-user"
        )
        
        # All handlers should be callable
        for registration in bundle.registrations:
            assert callable(registration.handler), \
                f"Handler for '{registration.name}' is not callable"
    
    @pytest.mark.asyncio
    async def test_toolbox_prompts_override_descriptions(self):
        """Verify custom prompts override default descriptions."""
        from unittest.mock import MagicMock
        
        mock_forwarder = MagicMock()
        forwarder_ref = {"instance": mock_forwarder}
        
        custom_prompts = {
            'bot_create_note': 'Custom: Create a note with this special description'
        }
        
        bundle = await toolbox.prepare_toolbox(
            room_url="https://test.daily.co/room",
            forwarder_ref=forwarder_ref,
            preloaded_prompts=custom_prompts,
            get_tenant_id=lambda: "test-tenant",
            get_user_id=lambda: "test-user"
        )
        
        # Find the create_note schema
        create_note_schema = next((s for s in bundle.schemas if s.name == 'bot_create_note'), None)
        assert create_note_schema is not None, "bot_create_note schema not found"
        
        # Should use custom description
        assert 'Custom: Create a note' in create_note_schema.description


class TestDecoratorSystemPerformance:
    """Tests validating discovery system performance."""
    
    def test_discovery_is_fast(self):
        """Verify tool discovery completes in reasonable time."""
        import time
        
        start = time.time()
        discovery = BotToolDiscovery()
        tools = discovery.discover_tools()
        elapsed = time.time() - start
        
        # Discovery should complete in < 1 second
        assert elapsed < 1.0, f"Discovery took {elapsed:.2f}s, expected < 1.0s"
        assert len(tools) >= 45
    
    def test_schema_building_is_fast(self):
        """Verify schema building completes in reasonable time."""
        import time
        
        discovery = BotToolDiscovery()
        
        start = time.time()
        schemas = discovery.build_tool_schemas()
        elapsed = time.time() - start
        
        # Schema building should complete in < 1 second
        assert elapsed < 1.0, f"Schema building took {elapsed:.2f}s, expected < 1.0s"
        assert len(schemas) >= 45
