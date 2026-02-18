"""Unit tests for BotToolDiscovery system.

Tests automatic tool discovery, module scanning, metadata extraction,
and registry building without requiring decorated tools to exist yet.
"""
from __future__ import annotations

from pathlib import Path

import pytest
from tools.discovery import BotToolDiscovery


class TestBotToolDiscovery:
    """Test suite for BotToolDiscovery class."""
    
    def test_initializes_with_default_path(self):
        """Test that discovery initializes with default tools directory."""
        discovery = BotToolDiscovery()
        
        assert discovery.tools_dir is not None
        assert discovery.tools_dir.name == "tools"
    
    def test_initializes_with_custom_path(self):
        """Test that discovery accepts custom tools directory."""
        custom_path = Path("/tmp/custom_tools")
        discovery = BotToolDiscovery(tools_dir=custom_path)
        
        assert discovery.tools_dir == custom_path
    
    def test_discovers_tool_modules(self):
        """Test that discovery finds Python modules in tools/ directory."""
        discovery = BotToolDiscovery()
        modules = discovery.tool_modules
        
        # Should find at least 7 tool modules
        assert len(modules) >= 7
        
        # Should be list of strings
        assert isinstance(modules, list)
        assert all(isinstance(m, str) for m in modules)
        
        # Should have tools. prefix
        assert all(m.startswith("tools.") for m in modules)
    
    def test_module_names_match_files(self):
        """Test that module names correspond to actual files."""
        discovery = BotToolDiscovery()
        
        # Check for known tool modules
        expected_modules = [
            "tools.notes.crud",
            "tools.window_tools",
            "tools.view_tools",
            "tools.html.crud",
            "tools.youtube_tools",
            "tools.profile_tools",
            "tools.misc_tools",
        ]
        
        for module in expected_modules:
            assert module in discovery.tool_modules, \
                f"Expected module {module} not found in {discovery.tool_modules}"
    
    def test_discovers_tools_returns_dict(self):
        """Test that discover_tools returns a dictionary."""
        discovery = BotToolDiscovery()
        tools = discovery.discover_tools()
        
        assert isinstance(tools, dict)
    
    def test_discovered_tools_structure(self):
        """Test that discovered tools have expected metadata structure."""
        discovery = BotToolDiscovery()
        tools = discovery.discover_tools()
        
        # If we have any decorated tools, check their structure
        if len(tools) > 0:
            # Get first tool
            tool_name = next(iter(tools))
            tool_meta = tools[tool_name]
            
            # Check required fields exist
            assert "name" in tool_meta
            assert "description" in tool_meta
            assert "feature_flag" in tool_meta
            assert "parameters" in tool_meta
            assert "passthrough" in tool_meta
            assert "handler_function" in tool_meta
            assert "module" in tool_meta
            
            # Check types
            assert isinstance(tool_meta["name"], str)
            assert isinstance(tool_meta["description"], str)
            assert isinstance(tool_meta["feature_flag"], str)
            assert isinstance(tool_meta["parameters"], dict)
            assert isinstance(tool_meta["passthrough"], bool)
            assert callable(tool_meta["handler_function"])
            assert isinstance(tool_meta["module"], str)
    
    def test_build_schemas_returns_list(self):
        """Test that build_schemas returns a list."""
        discovery = BotToolDiscovery()
        schemas = discovery.build_tool_schemas()
        
        assert isinstance(schemas, list)
    
    def test_build_schemas_with_prompts_override(self):
        """Test that custom prompts override tool descriptions."""
        discovery = BotToolDiscovery()
        
        # First discover to see if we have any tools
        tools = discovery.discover_tools()
        if len(tools) == 0:
            pytest.skip("No decorated tools found yet")
        
        # Get first tool name
        tool_name = next(iter(tools))
        
        # Build schemas with override
        custom_prompts = {
            tool_name: "CUSTOM_DESCRIPTION_TEST"
        }
        schemas = discovery.build_tool_schemas(prompts=custom_prompts)
        
        # Find the schema for this tool
        matching_schema = next(
            (s for s in schemas if s.name == tool_name),
            None
        )
        
        if matching_schema:
            assert matching_schema.description == "CUSTOM_DESCRIPTION_TEST"
    
    def test_build_handler_mapping_returns_dict(self):
        """Test that build_handler_mapping returns a dictionary."""
        discovery = BotToolDiscovery()
        handlers = discovery.build_handler_mapping(
            "https://daily.co/test-room",
            {"instance": None}
        )
        
        assert isinstance(handlers, dict)
    
    def test_handler_mapping_contains_callables(self):
        """Test that handler mapping contains callable functions."""
        discovery = BotToolDiscovery()
        handlers = discovery.build_handler_mapping(
            "https://daily.co/test-room",
            {"instance": None}
        )
        
        if len(handlers) > 0:
            # Check first handler is callable
            first_handler = next(iter(handlers.values()))
            assert callable(first_handler)
    
    def test_get_tools_by_feature(self):
        """Test filtering tools by feature flag."""
        discovery = BotToolDiscovery()
        
        # Try to get note tools
        note_tools = discovery.get_tools_by_feature("notes")
        
        assert isinstance(note_tools, dict)
        
        # If we have note tools, verify they're all in notes feature flag
        if len(note_tools) > 0:
            for _tool_name, tool_meta in note_tools.items():
                assert tool_meta["feature_flag"] == "notes"
    
    def test_get_tool_count(self):
        """Test getting total tool count."""
        discovery = BotToolDiscovery()
        count = discovery.get_tool_count()
        
        assert isinstance(count, int)
        assert count >= 0
    
    def test_get_tool_features(self):
        """Test getting all tool feature flags."""
        discovery = BotToolDiscovery()
        categories = discovery.get_tool_features()
        
        assert isinstance(categories, set)
        
        # If we have decorated tools, check for expected feature flags
        if len(categories) > 0:
            # Feature flags should be strings
            assert all(isinstance(cat, str) for cat in categories)


class TestBotToolDiscoveryEdgeCases:
    """Test edge cases and error handling."""
    
    def test_handles_nonexistent_directory(self):
        """Test that discovery handles non-existent directory gracefully."""
        fake_path = Path("/tmp/nonexistent_tools_dir_12345")
        discovery = BotToolDiscovery(tools_dir=fake_path)
        
        # Should return empty list, not crash
        assert discovery.tool_modules == []
    
    def test_discover_tools_with_nonexistent_directory(self):
        """Test that discover_tools handles non-existent directory."""
        fake_path = Path("/tmp/nonexistent_tools_dir_12345")
        discovery = BotToolDiscovery(tools_dir=fake_path)
        tools = discovery.discover_tools()
        
        # Should return empty dict
        assert tools == {}
    
    def test_get_tools_by_feature_with_unknown_category(self):
        """Test filtering by non-existent feature flag."""
        discovery = BotToolDiscovery()
        tools = discovery.get_tools_by_feature("nonexistent_category")
        
        # Should return empty dict
        assert tools == {}
    
    def test_build_schemas_with_no_tools(self):
        """Test building schemas when no tools are decorated yet."""
        fake_path = Path("/tmp/nonexistent_tools_dir_12345")
        discovery = BotToolDiscovery(tools_dir=fake_path)
        schemas = discovery.build_tool_schemas()
        
        # Should return empty list
        assert schemas == []
    
    def test_build_handler_mapping_with_no_tools(self):
        """Test building handler mapping when no tools exist."""
        fake_path = Path("/tmp/nonexistent_tools_dir_12345")
        discovery = BotToolDiscovery(tools_dir=fake_path)
        handlers = discovery.build_handler_mapping(
            "https://daily.co/room",
            {"instance": None}
        )
        
        # Should return empty dict
        assert handlers == {}
    
    def test_filter_tools_by_features_with_none(self):
        """Test that filter_tools_by_features with None returns all tools."""
        discovery = BotToolDiscovery()
        all_tools = discovery.discover_tools()
        filtered_tools = discovery.filter_tools_by_features(None)
        
        # Should return all tools when no features specified
        assert filtered_tools == all_tools
        assert len(filtered_tools) == len(all_tools)
    
    def test_filter_tools_by_features_with_empty_list(self):
        """Test that filter_tools_by_features with empty list returns all tools."""
        discovery = BotToolDiscovery()
        all_tools = discovery.discover_tools()
        filtered_tools = discovery.filter_tools_by_features([])
        
        # Empty list means no features enabled, should return all tools
        assert filtered_tools == all_tools
    
    def test_filter_tools_by_features_notes_only(self):
        """Test filtering to only notes tools."""
        discovery = BotToolDiscovery()
        filtered_tools = discovery.filter_tools_by_features(["notes"])
        
        # Should have some notes tools
        assert len(filtered_tools) > 0
        
        # All filtered tools should either have feature_flag="notes" or feature_flag=None
        for name, meta in filtered_tools.items():
            feature_flag = meta.get("feature_flag")
            assert feature_flag is None or feature_flag == "notes", \
                f"Tool {name} has unexpected feature_flag: {feature_flag}"
    
    def test_filter_tools_by_features_multiple_features(self):
        """Test filtering with multiple feature flags."""
        discovery = BotToolDiscovery()
        all_tools = discovery.discover_tools()
        filtered_tools = discovery.filter_tools_by_features(["notes", "youtube"])
        
        # Should have tools from both features
        assert len(filtered_tools) > 0
        assert len(filtered_tools) <= len(all_tools)
        
        # All filtered tools should have matching feature_flag or None
        for name, meta in filtered_tools.items():
            feature_flag = meta.get("feature_flag")
            assert feature_flag is None or feature_flag in ["notes", "youtube"], \
                f"Tool {name} has unexpected feature_flag: {feature_flag}"
    
    def test_filter_tools_by_features_excludes_non_matching(self):
        """Test that tools with non-matching feature_flags are excluded."""
        discovery = BotToolDiscovery()
        all_tools = discovery.discover_tools()
        filtered_tools = discovery.filter_tools_by_features(["notes"])
        
        # Find a tool with a different feature_flag (e.g., youtube)
        youtube_tools = [
            name for name, meta in all_tools.items()
            if meta.get("feature_flag") == "youtube"
        ]
        
        if youtube_tools:
            # Verify youtube tools are not in the filtered set
            for youtube_tool in youtube_tools:
                assert youtube_tool not in filtered_tools, \
                    f"YouTube tool {youtube_tool} should not be in notes-only filter"
    
    def test_filter_tools_by_features_includes_no_flag_tools(self):
        """Test that tools with feature_flag=None are always included."""
        discovery = BotToolDiscovery()
        all_tools = discovery.discover_tools()
        
        # Find tools with no feature flag
        no_flag_tools = [
            name for name, meta in all_tools.items()
            if meta.get("feature_flag") is None
        ]
        
        if no_flag_tools:
            # Filter to just one specific feature
            filtered_tools = discovery.filter_tools_by_features(["notes"])
            
            # All no-flag tools should still be present
            for tool_name in no_flag_tools:
                assert tool_name in filtered_tools, \
                    f"Tool {tool_name} with no feature_flag should always be included"
    
    def test_get_tools_by_feature_notes(self):
        """Test get_tools_by_feature method for notes."""
        discovery = BotToolDiscovery()
        notes_tools = discovery.get_tools_by_feature("notes")
        
        # Should have notes tools
        assert len(notes_tools) > 0
        
        # All should have feature_flag="notes" (excludes None tools)
        for name, meta in notes_tools.items():
            assert meta.get("feature_flag") == "notes", \
                f"Tool {name} in get_tools_by_feature('notes') should have feature_flag='notes'"
    
    def test_get_tools_by_feature_unknown_feature(self):
        """Test get_tools_by_feature with non-existent feature."""
        discovery = BotToolDiscovery()
        tools = discovery.get_tools_by_feature("nonexistent_feature")
        
        # Should return empty dict
        assert tools == {}
    
    def test_get_tool_features_returns_set(self):
        """Test that get_tool_features returns unique feature flags."""
        discovery = BotToolDiscovery()
        features = discovery.get_tool_features()
        
        # Should return a set
        assert isinstance(features, set)
        
        # Should have multiple features
        assert len(features) > 0
        
        # Should include known features
        expected_features = {"notes", "youtube", "maneuverableWindow", "userProfile", "htmlContent"}
        assert expected_features.issubset(features), \
            f"Expected features {expected_features} not all present in {features}"
        
        # Should not include None
        assert None not in features
    
    def test_build_tool_schemas_with_filtered_tools(self):
        """Test that build_tool_schemas accepts pre-filtered tools."""
        discovery = BotToolDiscovery()
        
        # Filter to just notes tools
        filtered_tools = discovery.filter_tools_by_features(["notes"])
        
        # Build schemas with filtered tools
        schemas = discovery.build_tool_schemas(tools=filtered_tools)
        
        # Should have schemas for filtered tools
        assert len(schemas) == len(filtered_tools)
        
        # Schema names should match filtered tool names
        schema_names = {schema.name for schema in schemas}
        filtered_names = set(filtered_tools.keys())
        assert schema_names == filtered_names
    
    def test_build_handler_mapping_with_filtered_tools(self):
        """Test that build_handler_mapping accepts pre-filtered tools."""
        discovery = BotToolDiscovery()
        
        # Filter to just notes tools
        filtered_tools = discovery.filter_tools_by_features(["notes"])
        
        # Build handlers with filtered tools
        handlers = discovery.build_handler_mapping(
            room_url="https://daily.co/room",
            forwarder_ref={"instance": None},
            tools=filtered_tools
        )
        
        # Should have handlers for filtered tools
        assert len(handlers) == len(filtered_tools)
        
        # Handler names should match filtered tool names
        assert set(handlers.keys()) == set(filtered_tools.keys())

