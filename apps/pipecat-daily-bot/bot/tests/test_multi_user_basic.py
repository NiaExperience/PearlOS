"""
Basic tests for multi-user functionality.

This module tests the multi-user functionality through simple, focused tests
that don't require complex mocking of the Pipecat framework.
"""

import os

import bot  # type: ignore
import pytest
from session.participant_data import derive_name_and_context


class TestMultiUserBasic:
    """Basic tests for multi-user functionality."""

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


    def test_create_daily_room_token_missing_api_key(self):
        """Test Daily room token creation with missing API key."""
        # This test verifies the function exists and handles missing API key
        room_url = "https://test.daily.co/room"
        
        # Test that the function exists and raises the expected error
        import asyncio
        
        async def test_missing_key():
            # Temporarily remove the API key if it exists
            original_key = os.environ.get("DAILY_API_KEY")
            if "DAILY_API_KEY" in os.environ:
                del os.environ["DAILY_API_KEY"]
            
            try:
                with pytest.raises(ValueError, match="DAILY_API_KEY environment variable is required"):
                    await bot.create_daily_room_token(room_url)
            finally:
                # Restore the original key if it existed
                if original_key:
                    os.environ["DAILY_API_KEY"] = original_key
        
        asyncio.run(test_missing_key())





    def test_participant_name_extraction_edge_cases(self):
        """Test edge cases for participant name extraction."""
        # Test with None participant
        name, _ = derive_name_and_context("user-1", None)
        assert name is None
        
        # Test with empty string name
        participant_empty = {
            "id": "user-empty",
            "info": {"userName": "   "}
        }
        name_empty, _ = derive_name_and_context("user-empty", participant_empty)
        assert name_empty is None
        
        # Test with very long name
        participant_long = {
            "id": "user-long",
            "info": {"userName": "Very Long Name That Should Be Truncated To First Token"}
        }
        name_long, _ = derive_name_and_context("user-long", participant_long)
        assert name_long == "Very"




if __name__ == "__main__":
    pytest.main([__file__])
