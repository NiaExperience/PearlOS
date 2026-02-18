"""
Tests for multi-user event handler integration.

This module tests the integration of multi-user functionality with the bot's
event handlers, ensuring participant names are properly mapped and used.
"""

from unittest.mock import Mock

import pytest
from session.participant_data import derive_name_and_context
from core.context import MultiUserContextAggregator


class TestMultiUserEventHandlers:
    """Test multi-user functionality in event handlers."""

    def setup_method(self):
        """Set up test fixtures before each test method."""
        self.env_patches = {
            "OPENAI_API_KEY": "test-openai-key",
            "ELEVENLABS_API_KEY": "test-elevenlabs-key",
            "DAILY_API_KEY": "test-daily-key",
            "DAILY_ROOM_URL": "https://test.daily.co/room"
        }

    def test_participant_name_extraction(self):
        """Test extraction of participant names from different data structures."""
        # Test with userName in info
        participant1 = {
            "id": "user-1",
            "info": {"userName": "Charlie Brown"}
        }
        name1, _ = derive_name_and_context("user-1", participant1)
        assert name1 == "Charlie"
        
        # Test with user_name at root level
        participant2 = {
            "id": "user-2",
            "user_name": "Diana Prince"
        }
        name2, _ = derive_name_and_context("user-2", participant2)
        assert name2 == "Diana"
        
        # Test with name at root level
        participant3 = {
            "id": "user-3",
            "name": "Eve Wilson"
        }
        name3, _ = derive_name_and_context("user-3", participant3)
        assert name3 == "Eve"

    def test_participant_name_fallback(self):
        """Test fallback behavior when participant name is not available."""
        # Test with no name fields
        participant = {
            "id": "user-unknown"
        }
        name, _ = derive_name_and_context("user-unknown", participant)
        assert name is None
        
        # Test with empty name
        participant_empty = {
            "id": "user-empty",
            "info": {"userName": ""}
        }
        name_empty, _ = derive_name_and_context("user-empty", participant_empty)
        assert name_empty is None

    def test_multi_user_aggregator_creation(self):
        """Test that MultiUserContextAggregator can be created and used."""
        # Create a mock context
        mock_context = Mock()
        
        # Create the aggregator
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Test basic functionality
        aggregator.set_participant_name("user-123", "Alice")
        assert aggregator.get_participant_name("user-123") == "Alice"
        assert aggregator.get_participant_name("unknown-user") == "unknown-user"

    def test_participant_name_mapping_workflow(self):
        """Test the complete workflow of participant name mapping."""
        # Create aggregator
        mock_context = Mock()
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Simulate participant join event
        participant = {
            "id": "user-123",
            "info": {"userName": "Alice Smith"}
        }
        
        # Extract name using the same logic as event handlers
        pid = participant.get('id')
        name, _ = derive_name_and_context(pid, participant)
        
        # Map the participant
        if pid and name:
            aggregator.set_participant_name(pid, name)
        
        # Verify mapping
        assert aggregator.get_participant_name("user-123") == "Alice"

    def test_multiple_participants_mapping(self):
        """Test mapping multiple participants."""
        # Create aggregator
        mock_context = Mock()
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Test multiple participants
        participants = [
            {"id": "user-1", "info": {"userName": "Alice"}},
            {"id": "user-2", "info": {"userName": "Bob"}},
            {"id": "user-3", "info": {"userName": "Charlie"}}
        ]
        
        # Map all participants
        for participant in participants:
            pid = participant.get('id')
            name, _ = derive_name_and_context(pid, participant)
            if pid and name:
                aggregator.set_participant_name(pid, name)
        
        # Verify all participants are mapped
        assert aggregator.get_participant_name("user-1") == "Alice"
        assert aggregator.get_participant_name("user-2") == "Bob"
        assert aggregator.get_participant_name("user-3") == "Charlie"
        
        # Verify we can handle unknown participants
        assert aggregator.get_participant_name("user-unknown") == "user-unknown"

    def test_participant_name_overwrite(self):
        """Test overwriting participant names."""
        # Create aggregator
        mock_context = Mock()
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Set initial name
        aggregator.set_participant_name("user-123", "Alice")
        assert aggregator.get_participant_name("user-123") == "Alice"
        
        # Overwrite with new name
        aggregator.set_participant_name("user-123", "Alice Smith")
        assert aggregator.get_participant_name("user-123") == "Alice Smith"

    def test_participant_name_edge_cases(self):
        """Test edge cases for participant name handling."""
        # Create aggregator
        mock_context = Mock()
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Test with None values
        aggregator.set_participant_name(None, "Alice")
        aggregator.set_participant_name("user-123", None)
        
        # Should handle gracefully
        assert aggregator.get_participant_name(None) == "Alice"
        assert aggregator.get_participant_name("user-123") is None
        
        # Test with empty strings
        aggregator.set_participant_name("", "Empty ID")
        aggregator.set_participant_name("user-empty", "")
        
        assert aggregator.get_participant_name("") == "Empty ID"
        assert aggregator.get_participant_name("user-empty") == ""

    def test_derive_name_and_context_integration(self):
        """Test integration with existing derive_name_and_context function."""
        # Test with a participant that has userName in info
        participant = {
            "id": "user-456",
            "info": {"userName": "Bob Johnson"}
        }
        
        def mock_lookup(pid):
            return None
        
        name, context = derive_name_and_context("user-456", participant, mock_lookup)
        
        # Should extract first name from userName
        assert name == "Bob"
        # Context may be None or contain data depending on implementation
        assert context is None or isinstance(context, dict)

    def test_event_handler_name_extraction_patterns(self):
        """Test various name extraction patterns that might occur in event handlers."""
        test_cases = [
            # Standard cases
            ({"id": "user-1", "info": {"userName": "John Doe"}}, "John"),
            ({"id": "user-2", "user_name": "Jane Smith"}, "Jane"),
            ({"id": "user-3", "name": "Bob Wilson"}, "Bob"),
            
            # Edge cases
            ({"id": "user-4", "info": {"userName": ""}}, None),
            ({"id": "user-5", "info": {"userName": "   "}}, None),
            ({"id": "user-6"}, None),
            ({"id": "user-7", "info": {"userName": "Very Long Name That Should Be Truncated"}}, "Very"),
        ]
        
        for participant, expected_name in test_cases:
            pid = participant.get('id')
            name, _ = derive_name_and_context(pid, participant)
            assert name == expected_name, f"Failed for participant: {participant}"

    def test_aggregator_persistence_across_events(self):
        """Test that aggregator state persists across multiple events."""
        # Create aggregator
        mock_context = Mock()
        aggregator = MultiUserContextAggregator(mock_context)
        
        # Simulate first participant join
        participant1 = {"id": "user-1", "info": {"userName": "Alice"}}
        pid1 = participant1.get('id')
        name1, _ = derive_name_and_context(pid1, participant1)
        aggregator.set_participant_name(pid1, name1)
        
        # Simulate second participant join
        participant2 = {"id": "user-2", "info": {"userName": "Bob"}}
        pid2 = participant2.get('id')
        name2, _ = derive_name_and_context(pid2, participant2)
        aggregator.set_participant_name(pid2, name2)
        
        # Verify both participants are still mapped
        assert aggregator.get_participant_name("user-1") == "Alice"
        assert aggregator.get_participant_name("user-2") == "Bob"
        
        # Note: We can't easily test internal state without exposing it


    def test_error_handling_in_name_extraction(self):
        """Test error handling in name extraction."""
        # Test with invalid participant data
        invalid_participants = [
            None,
            {},
            {"id": None},
            {"id": ""},
            {"info": {"userName": "Valid Name"}},  # Missing id
        ]
        
        for participant in invalid_participants:
            if participant is None:
                name, _ = derive_name_and_context("user-1", participant)
                assert name is None
            else:
                pid = participant.get('id') if participant else None
                name, _ = derive_name_and_context(pid, participant)
                # Should handle gracefully without raising exceptions
                assert name is None or isinstance(name, str)


if __name__ == "__main__":
    pytest.main([__file__])

