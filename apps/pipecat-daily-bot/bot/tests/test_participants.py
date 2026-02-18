from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from session.participant_data import (
    derive_name_and_context,
    derive_name_and_context_enhanced,
    extract_raw_name,
    extract_user_metadata,
    first_token,
    is_stealth_participant,
    STEALTH_SESSION_USER_ID,
)


def test_first_token_basic():
    assert first_token("Jeffrey Klug") == "Jeffrey"
    assert first_token("  Alice   ") == "Alice"
    assert first_token("") == ""


def test_extract_raw_name_from_info_userName():
    obj = {"info": {"userName": "Jane Doe"}}
    assert extract_raw_name(obj) == "Jane Doe"


def test_extract_raw_name_from_common_keys():
    assert extract_raw_name({"user_name": "John"}) == "John"
    assert extract_raw_name({"name": "Bobby Tables"}) == "Bobby Tables"
    assert extract_raw_name({"displayName": "Sam"}) == "Sam"


def test_extract_raw_name_none_when_missing():
    assert extract_raw_name({}) is None
    assert extract_raw_name(42) is None


def test_derive_name_and_context_prefers_event_payload():
    pid = "p1"
    participant = {"id": pid, "user_name": "Mary Jane", "user_id": "u123", "joined_at": 100}

    def lookup(_pid: str) -> dict[str, Any] | None:
        return {"user_name": "SHOULD_NOT_BE_USED"}

    name, ctx = derive_name_and_context(pid, participant, lookup)
    assert name == "Mary"  # first token
    assert isinstance(ctx, dict)
    # Context should include only whitelisted keys present in participant
    assert ctx.get("user_id") == "u123"
    assert ctx.get("user_name") == "Mary Jane"
    assert ctx.get("joined_at") == 100


def test_derive_name_and_context_falls_back_to_lookup():
    pid = "p2"
    participant = {"id": pid}  # no name fields

    def lookup(_pid: str) -> dict[str, Any] | None:
        return {"info": {"userName": "Peter Parker"}, "user_id": "u777"}

    name, ctx = derive_name_and_context(pid, participant, lookup)
    assert name == "Peter"
    # context may include whitelisted keys from meta
    if ctx is not None:
        assert ctx.get("user_id") == "u777"


def test_derive_name_and_context_none_when_unavailable():
    pid = "p3"
    participant = {"id": pid}

    def lookup(_pid: str) -> dict[str, Any] | None:
        return None

    name, ctx = derive_name_and_context(pid, participant, lookup)
    assert name is None
    assert ctx is None or isinstance(ctx, dict)


# Tests for extract_user_metadata function
def test_extract_user_metadata_complete_data():
    """Test extraction with complete session metadata."""
    participant = {
        "id": "p1",
        "userData": {
            "sessionUserId": "user123",
            "sessionUserName": "John Doe",
            "sessionUserEmail": "john@example.com"
        }
    }
    
    metadata = extract_user_metadata(participant)
    assert metadata is not None
    assert metadata["session_user_id"] == "user123"
    assert metadata["session_user_name"] == "John Doe"
    assert metadata["session_user_email"] == "john@example.com"


def test_extract_user_metadata_partial_data():
    """Test extraction with partial session metadata."""
    participant = {
        "id": "p1",
        "userData": {
            "sessionUserId": "user456",
            "sessionUserName": "",  # empty string should be ignored
            "sessionUserEmail": "jane@example.com"
        }
    }
    
    metadata = extract_user_metadata(participant)
    assert metadata is not None
    assert metadata["session_user_id"] == "user456"
    assert "session_user_name" not in metadata  # empty string filtered out
    assert metadata["session_user_email"] == "jane@example.com"


def test_extract_user_metadata_minimal_data():
    """Test extraction with only user ID."""
    participant = {
        "id": "p1", 
        "userData": {
            "sessionUserId": "user789"
        }
    }
    
    metadata = extract_user_metadata(participant)
    assert metadata is not None
    assert metadata["session_user_id"] == "user789"
    assert len(metadata) == 1


def test_extract_user_metadata_no_user_data():
    """Test extraction when no userData field present."""
    participant = {"id": "p1", "name": "guest"}
    
    metadata = extract_user_metadata(participant)
    assert metadata is None


def test_extract_user_metadata_empty_user_data():
    """Test extraction when userData is empty."""
    participant = {
        "id": "p1",
        "userData": {}
    }
    
    metadata = extract_user_metadata(participant)
    assert metadata is None


def test_extract_user_metadata_invalid_input():
    """Test extraction with invalid inputs."""
    assert extract_user_metadata(None) is None
    assert extract_user_metadata("not a dict") is None
    assert extract_user_metadata(42) is None


def test_extract_user_metadata_with_stealth_boolean_true():
    """Stealth flag as boolean True should be parsed and set to True."""
    participant = {
        "id": "p1",
        "userData": {
            "sessionUserId": "user123",
            "stealth": True,
        }
    }
    md = extract_user_metadata(participant)
    assert md is not None
    assert md.get("session_user_id") == "user123"
    assert md.get("stealth") is True


def test_extract_user_metadata_with_stealth_boolean_false():
    """Stealth flag as boolean False should be parsed and set to False."""
    participant = {
        "id": "p1",
        "userData": {
            "sessionUserId": "user123",
            "stealth": False,
        }
    }
    md = extract_user_metadata(participant)
    assert md is not None
    assert md.get("stealth") is False


def test_extract_user_metadata_with_stealth_string_truthy():
    """Stealth flag as string truthy should be parsed to True."""
    for val in ("true", "TRUE", "Yes", "on", "1"):
        participant = {
            "id": "p1",
            "userData": {
                "sessionUserId": "user123",
                "stealth": val,
            }
        }
        md = extract_user_metadata(participant)
        assert md is not None
        assert md.get("stealth") is True


def test_extract_user_metadata_with_stealth_string_falsy():
    """Stealth flag as non-truthy string should not set True (could be omitted or False)."""
    for val in ("false", "no", "off", "0", " "):
        participant = {
            "id": "p1",
            "userData": {
                "sessionUserId": "user123",
                "stealth": val,
            }
        }
        md = extract_user_metadata(participant)
        # md exists due to session_user_id
        assert md is not None
        assert md.get("stealth") in (None, False)


def test_is_stealth_participant_matches_session_user_id():
    """Stealth detection should trigger on the shared sentinel session_user_id."""
    pctx = {"session_metadata": {"session_user_id": STEALTH_SESSION_USER_ID}}
    assert is_stealth_participant("pid-1", "Guest", pctx) is True


def test_is_stealth_participant_matches_session_user_id_case_insensitive():
    """Stealth detection should be case-insensitive for the sentinel session_user_id."""
    sentinel_upper = STEALTH_SESSION_USER_ID.upper()
    pctx = {"session_metadata": {"session_user_id": sentinel_upper}}
    assert is_stealth_participant("pid-2", "Guest", pctx) is True


# Tests for derive_name_and_context_enhanced function
@pytest.mark.asyncio
async def test_derive_name_and_context_enhanced_without_profile():
    """Test enhanced function when profile loading is disabled."""
    participant = {
        "id": "p1",
        "user_name": "Alice",
        "userData": {
            "sessionUserId": "user123"
        }
    }
    
    name, ctx = await derive_name_and_context_enhanced("p1", participant, enable_profile_loading=False)
    assert name == "Alice"
    assert ctx is not None
    assert "user_profile" not in ctx
    assert "has_user_profile" not in ctx
    # Session metadata should still be included even when profile loading is disabled
    assert "session_metadata" in ctx
    assert ctx["session_metadata"]["session_user_id"] == "user123"


@pytest.mark.asyncio 
async def test_derive_name_and_context_enhanced_with_session_metadata():
    """Test enhanced function includes session metadata."""
    participant = {
        "id": "p1", 
        "user_name": "Bob",
        "userData": {
            "sessionUserId": "user456",
            "sessionUserName": "Robert Smith"
        }
    }
    
    with patch('services.user_profile.get_profile_service') as mock_get_service:
        mock_service = AsyncMock()
        mock_service.load_user_profile.return_value = None  # No profile found
        mock_get_service.return_value = mock_service
        
        name, ctx = await derive_name_and_context_enhanced("p1", participant)
        
        assert name == "Bob"
        assert ctx is not None
        assert "session_metadata" in ctx
        assert ctx["session_metadata"]["session_user_id"] == "user456"
        assert ctx["session_metadata"]["session_user_name"] == "Robert Smith"


@pytest.mark.asyncio
async def test_derive_name_and_context_enhanced_with_profile_data():
    """Test enhanced function with successful profile loading."""
    participant = {
        "id": "p1",
        "userData": {
            "sessionUserId": "user789",
            "sessionUserName": "Charlie Brown"
        }
    }
    
    mock_profile = {
        "userId": "user789",
        "first_name": "Charles",
        "email": "charlie@example.com",
        "metadata": {"preferences": {"theme": "dark"}}
    }
    
    with patch('services.user_profile.get_profile_service') as mock_get_service:
        mock_service = AsyncMock()
        # Support both legacy load and new reload-on-join behavior
        mock_service.load_user_profile.return_value = mock_profile
        mock_service.reload_user_profile.return_value = mock_profile
        mock_get_service.return_value = mock_service
        
        name, ctx = await derive_name_and_context_enhanced("p1", participant)
        
        # With reload-on-join default enabled, reload_user_profile should be called
        mock_service.reload_user_profile.assert_called_once_with("user789")
        # And load_user_profile should not be called in this path
        mock_service.load_user_profile.assert_not_called()
        
        assert name == "Charles"  # Should use profile name since no base name
        assert ctx is not None
        assert ctx["has_user_profile"] is True
        assert ctx["user_profile"] == mock_profile
        assert "session_metadata" in ctx


@pytest.mark.asyncio
async def test_derive_name_and_context_enhanced_prefers_info_username_over_session_metadata():
    """info.userName should override sessionUserName when both are present."""
    participant = {
        "id": "p1",
        "info": {
            "userName": "Bob",
            "userData": {
                "sessionUserId": "user999",
                "sessionUserName": "Jeff"
            }
        }
    }

    name, ctx = await derive_name_and_context_enhanced("p1", participant, enable_profile_loading=False)

    assert name == "Bob"
    assert ctx is not None
    assert ctx["session_metadata"]["session_user_id"] == "user999"
    assert ctx["session_metadata"]["session_user_name"] == "Jeff"


@pytest.mark.asyncio
async def test_derive_name_and_context_enhanced_profile_loading_error():
    """Test enhanced function handles profile loading errors gracefully."""
    participant = {
        "id": "p1",
        "user_name": "Dave",
        "userData": {
            "sessionUserId": "user999"
        }
    }
    
    with patch('services.user_profile.get_profile_service') as mock_get_service:
        mock_service = AsyncMock()
        mock_service.load_user_profile.side_effect = Exception("Profile service error")
        mock_get_service.return_value = mock_service
        
        name, ctx = await derive_name_and_context_enhanced("p1", participant)
        
        # Should still return base results despite error
        assert name == "Dave"
        assert ctx is not None
        # Should still have session metadata despite profile error
        assert "session_metadata" in ctx


@pytest.mark.asyncio
async def test_derive_name_and_context_enhanced_no_session_metadata():
    """Test enhanced function with no session metadata."""
    participant = {
        "id": "p1",
        "user_name": "Eve"
    }
    
    name, ctx = await derive_name_and_context_enhanced("p1", participant)
    
    assert name == "Eve"
    assert ctx is not None
    # Should not have session metadata or profile
    assert "session_metadata" not in ctx
    assert "user_profile" not in ctx
