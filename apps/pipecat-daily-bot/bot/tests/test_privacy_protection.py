"""
Test suite for lastConversationSummary privacy protection.

In private sessions: first_name, email, metadata, lastConversationSummary included.
In multi-user sessions: first_name, email, metadata included; lastConversationSummary excluded.
"""

import pytest
from flows.core import _sanitize_profile_data


@pytest.fixture
def test_profile():
    """Create a comprehensive test profile with all potential fields."""
    return {
        "name": "Alice Johnson",  # Top-level, will be excluded
        "first_name": "Alice",  # Will be included
        "email": "alice@example.com",  # Will be included
        "title": "Senior Engineer",  # Top-level, will be excluded
        "sessionHistory": [
            {"action": "Opened dailyCall app", "time": "2025-11-06T10:00:00Z"},
            {"action": "Loaded HTML applet", "time": "2025-11-06T10:01:00Z"},
        ] * 25,  # Simulate 50 entries
        "lastConversationSummary": {
            "summary": "Alice discussed confidential project details and personal health concerns",
            "timestamp": "2025-11-06T17:52:00Z",
            "topics": ["project planning", "personal matters"]
        },
        "metadata": {
            "department": "Engineering",
            "location": "San Francisco",
            "team": "Platform",
            "role": "Tech Lead"
        }
    }


def test_private_session_includes_conversation_summary(test_profile):
    """Private sessions should include lastConversationSummary for continuity."""
    sanitized = _sanitize_profile_data(test_profile, is_private_session=True)
    
    # Should include conversation summary
    assert "lastConversationSummary" in sanitized
    assert sanitized["lastConversationSummary"] == test_profile["lastConversationSummary"]
    
    # Should include standard fields
    assert sanitized["first_name"] == "Alice"
    assert sanitized["email"] == "alice@example.com"
    
    # Should include metadata children
    assert sanitized["department"] == "Engineering"
    assert sanitized["location"] == "San Francisco"
    assert sanitized["team"] == "Platform"
    assert sanitized["role"] == "Tech Lead"
    
    # Should exclude sessionHistory and other top-level fields
    assert "sessionHistory" not in sanitized
    assert "name" not in sanitized
    assert "title" not in sanitized


def test_multiuser_session_excludes_conversation_summary(test_profile):
    """Multi-user sessions should exclude lastConversationSummary for privacy."""
    sanitized = _sanitize_profile_data(test_profile, is_private_session=False)
    
    # Should NOT include conversation summary (privacy protection)
    assert "lastConversationSummary" not in sanitized
    
    # Should still include standard fields
    assert sanitized["first_name"] == "Alice"
    assert sanitized["email"] == "alice@example.com"
    
    # Should include metadata children
    assert sanitized["department"] == "Engineering"
    assert sanitized["location"] == "San Francisco"
    assert sanitized["team"] == "Platform"
    assert sanitized["role"] == "Tech Lead"
    
    # Should exclude sessionHistory and other top-level fields
    assert "sessionHistory" not in sanitized
    assert "name" not in sanitized
    assert "title" not in sanitized


def test_private_vs_multiuser_field_consistency(test_profile):
    """Private and multi-user sessions should differ only in lastConversationSummary."""
    private = _sanitize_profile_data(test_profile, is_private_session=True)
    multiuser = _sanitize_profile_data(test_profile, is_private_session=False)
    
    # Remove lastConversationSummary from private for comparison
    private_without_summary = {k: v for k, v in private.items() if k != "lastConversationSummary"}
    
    # All other fields should be identical
    assert private_without_summary == multiuser
    
    # Only difference should be lastConversationSummary
    assert "lastConversationSummary" in private
    assert "lastConversationSummary" not in multiuser


def test_session_history_always_excluded(test_profile):
    """sessionHistory should never be included regardless of session type."""
    private = _sanitize_profile_data(test_profile, is_private_session=True)
    multiuser = _sanitize_profile_data(test_profile, is_private_session=False)
    
    assert "sessionHistory" not in private
    assert "sessionHistory" not in multiuser


def test_top_level_fields_always_excluded(test_profile):
    """Top-level fields (except first_name, email) should always be excluded."""
    private = _sanitize_profile_data(test_profile, is_private_session=True)
    multiuser = _sanitize_profile_data(test_profile, is_private_session=False)
    
    excluded_fields = ["name", "title"]
    
    for field in excluded_fields:
        assert field not in private, f"{field} should not be in private session"
        assert field not in multiuser, f"{field} should not be in multi-user session"


def test_profile_without_conversation_summary():
    """Profiles without lastConversationSummary should work correctly."""
    profile = {
        "first_name": "Bob",
        "email": "bob@example.com",
        "metadata": {
            "role": "Developer"
        }
    }
    
    private = _sanitize_profile_data(profile, is_private_session=True)
    multiuser = _sanitize_profile_data(profile, is_private_session=False)
    
    # Neither should have lastConversationSummary
    assert "lastConversationSummary" not in private
    assert "lastConversationSummary" not in multiuser
    
    # Both should have the same fields
    assert private == multiuser
    assert private["first_name"] == "Bob"
    assert private["email"] == "bob@example.com"
    assert private["role"] == "Developer"


def test_profile_with_missing_fields():
    """Profiles with missing optional fields should handle gracefully."""
    minimal_profile = {
        "metadata": {
            "team": "Backend"
        }
    }
    
    private = _sanitize_profile_data(minimal_profile, is_private_session=True)
    multiuser = _sanitize_profile_data(minimal_profile, is_private_session=False)
    
    # Should only include metadata field
    assert private == {"team": "Backend"}
    assert multiuser == {"team": "Backend"}


def test_conversation_summary_structure_preserved():
    """lastConversationSummary structure should be preserved exactly in private sessions."""
    profile = {
        "first_name": "Charlie",
        "lastConversationSummary": {
            "summary": "Detailed discussion about API design",
            "timestamp": "2025-11-06T14:30:00Z",
            "topics": ["API", "design patterns", "architecture"],
            "sentiment": "positive",
            "actionItems": ["Review PR", "Update docs"]
        }
    }
    
    sanitized = _sanitize_profile_data(profile, is_private_session=True)
    
    # Entire structure should be preserved
    assert sanitized["lastConversationSummary"] == profile["lastConversationSummary"]
    assert len(sanitized["lastConversationSummary"]["topics"]) == 3
    assert len(sanitized["lastConversationSummary"]["actionItems"]) == 2
