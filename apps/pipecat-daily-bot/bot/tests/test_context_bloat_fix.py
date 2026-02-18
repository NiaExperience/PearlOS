"""Test that sessionHistory is excluded from LLM context to prevent bloat."""

import json

import pytest

from flows.core import _sanitize_profile_data, _build_participant_context_entry


def test_sanitize_profile_data_excludes_session_history():
    """Verify that only first_name, email, metadata children and lastConversationSummary are included."""
    profile_with_history = {
        "name": "Test User",
        "first_name": "Test",
        "email": "test@example.com",
        "sessionHistory": [
            {"action": "opened app", "time": "2025-11-06T10:00:00Z"},
            {"action": "loaded widget", "time": "2025-11-06T10:01:00Z"},
            # ... potentially dozens more entries
        ],
        "lastConversationSummary": {
            "summary": "User discussed project planning",
            "timestamp": "2025-11-06T10:05:00Z",
        },
        "metadata": {"favorite_color": "blue", "department": "Engineering"},
    }

    # Test private session - first_name, email, metadata children + lastConversationSummary
    sanitized_private = _sanitize_profile_data(profile_with_history, is_private_session=True)
    assert "sessionHistory" not in sanitized_private
    assert "name" not in sanitized_private  # Top-level fields excluded (except first_name, email)
    assert "first_name" in sanitized_private  # Explicitly included
    assert sanitized_private["first_name"] == "Test"
    assert "email" in sanitized_private  # Explicitly included
    assert sanitized_private["email"] == "test@example.com"
    assert "lastConversationSummary" in sanitized_private
    assert "favorite_color" in sanitized_private  # Metadata child included
    assert "department" in sanitized_private  # Metadata child included

    # Test multi-user session - first_name, email, metadata children only (no lastConversationSummary)
    sanitized_multiuser = _sanitize_profile_data(profile_with_history, is_private_session=False)
    assert "sessionHistory" not in sanitized_multiuser
    assert "name" not in sanitized_multiuser
    assert "first_name" in sanitized_multiuser
    assert "email" in sanitized_multiuser
    assert "lastConversationSummary" not in sanitized_multiuser
    assert "favorite_color" in sanitized_multiuser  # Metadata child included
    assert "department" in sanitized_multiuser  # Metadata child included


def test_sanitize_profile_data_handles_missing_session_history():
    """Verify that profiles without sessionHistory work correctly and include first_name, email, metadata."""
    profile_without_history = {
        "name": "Test User",
        "first_name": "Test",
        "email": "test@example.com",
        "metadata": {"role": "engineer", "team": "platform"},
    }

    sanitized = _sanitize_profile_data(profile_without_history)

    # first_name and email should be present
    assert "first_name" in sanitized
    assert sanitized["first_name"] == "Test"
    assert "email" in sanitized
    assert sanitized["email"] == "test@example.com"
    # Metadata children should be present
    assert "role" in sanitized
    assert "team" in sanitized
    # Other top-level fields should be excluded
    assert "name" not in sanitized
    assert "sessionHistory" not in sanitized


def test_build_participant_context_entry_excludes_session_history():
    """Verify that participant context entries don't include sessionHistory."""
    entry = {
        "display_name": "Alice",
        "context": {
            "user_profile": {
                "name": "Alice Johnson",
                "sessionHistory": [
                    {"action": "test1", "time": "2025-11-06T10:00:00Z"},
                    {"action": "test2", "time": "2025-11-06T10:01:00Z"},
                ],
                "lastConversationSummary": {
                    "summary": "Discussed design patterns",
                    "timestamp": "2025-11-06T10:05:00Z",
                },
                "metadata": {"pronouns": "she/her"},
            }
        },
        "stealth": False,
    }

    # Test private session - lastConversationSummary should be included
    result_private = _build_participant_context_entry("p1", entry, is_private_session=True)
    result_json_private = json.dumps(result_private)
    assert "sessionHistory" not in result_json_private
    assert "lastConversationSummary" in result_json_private

    # Test multi-user session - lastConversationSummary should be excluded
    result_multiuser = _build_participant_context_entry("p1", entry, is_private_session=False)
    result_json_multiuser = json.dumps(result_multiuser)
    assert "sessionHistory" not in result_json_multiuser
    assert "lastConversationSummary" not in result_json_multiuser


def test_massive_session_history_excluded():
    """Simulate the staging issue: massive sessionHistory causing 800KB+ contexts."""
    # Create a profile with 100 session history entries (similar to staging)
    massive_history = []
    for i in range(100):
        massive_history.append({
            "action": "Opened dailyCall app",
            "sessionId": f"session-{i}",
            "time": f"2025-11-{(i % 30) + 1:02d}T{(i % 24):02d}:00:00Z",
            "refIds": [
                {
                    "description": f"Long description text {i}" * 10,
                    "id": f"ref-{i}",
                    "type": "HtmlGeneration"
                }
            ]
        })

    profile_with_massive_history = {
        "name": "Stephanie Riggs",
        "email": "stephanie@example.com",
        "sessionHistory": massive_history,
        "lastConversationSummary": {
            "summary": "Brief conversation summary",
            "timestamp": "2025-11-06T17:52:00Z"
        },
        "metadata": {
            "Author": "wrote acclaimed books",
            "avg_day": "Poking up the energy in Brooklyn"
        }
    }

    # Test private session - includes lastConversationSummary
    sanitized_private = _sanitize_profile_data(profile_with_massive_history, is_private_session=True)
    sanitized_json_private = json.dumps(sanitized_private)
    assert "sessionHistory" not in sanitized_json_private
    assert "lastConversationSummary" in sanitized_json_private
    assert sanitized_private["lastConversationSummary"]["summary"] == "Brief conversation summary"
    
    # Test multi-user session - excludes lastConversationSummary for privacy
    sanitized_multiuser = _sanitize_profile_data(profile_with_massive_history, is_private_session=False)
    sanitized_json_multiuser = json.dumps(sanitized_multiuser)
    assert "sessionHistory" not in sanitized_json_multiuser
    assert "lastConversationSummary" not in sanitized_json_multiuser
    
    # Both should be much smaller than the original
    assert len(sanitized_json_private) < 5000, f"Private session profile is {len(sanitized_json_private)} bytes, should be < 5KB"
    assert len(sanitized_json_multiuser) < 5000, f"Multi-user session profile is {len(sanitized_json_multiuser)} bytes, should be < 5KB"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
