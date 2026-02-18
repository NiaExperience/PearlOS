"""Tests to ensure local bot participant doesn't trigger premature greetings."""

import os
import sys
from unittest.mock import Mock

import pytest

from session.participant_data import STEALTH_SESSION_USER_ID

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import eventbus.bus
from handlers import register_default_handlers


@pytest.fixture
def registered_handlers():
    """Register handlers and return unsubscribe functions."""
    # Mock components
    mock_messages = []
    mock_task = Mock()
    mock_context_agg = Mock()
    mock_transport = Mock()
    
    class DummyFlowManager:
        def __init__(self):
            self.state = {}
            self.task = mock_task
    
    # Register handlers using correct signature
    unsubscribe = register_default_handlers(
        room_url="https://daily.co/test-room",
        task=mock_task,
        context_agg=mock_context_agg,
        messages=mock_messages,
            transport=mock_transport,
            flow_manager=DummyFlowManager(),
    )
    
    yield {
        'unsubscribe': unsubscribe,
        'mock_messages': mock_messages,
        'mock_task': mock_task,
        'mock_context_agg': mock_context_agg,
        'mock_transport': mock_transport
    }
    
    # Cleanup
    unsubscribe()


def test_local_bot_join_does_not_trigger_greeting(registered_handlers):
    """Test that local bot joining doesn't trigger a greeting."""
    mock_messages = registered_handlers['mock_messages']
    
    # Clear any existing messages
    mock_messages.clear()
    
    # Simulate local bot joining (this should NOT trigger greeting)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'local',  # This is the key - local bot participant
        'name': None  # Bot typically has no name
    })
    
    # Should have NO messages queued (no greeting triggered)
    assert len(mock_messages) == 0, "Local bot join should not trigger any greeting messages"


def test_real_participant_join_triggers_greeting(registered_handlers):
    """Test that real participant joining does trigger a greeting."""
    mock_messages = registered_handlers['mock_messages']
    
    # Clear any existing messages
    mock_messages.clear()
    
    # Simulate real participant joining (this SHOULD trigger greeting after grace period)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'real-user-123',  # Real participant ID
        'name': 'Alice',
        'context': {
            'session_metadata': {
                'session_user_id': 'user-123',
                'session_user_name': 'Alice Smith',
                'session_user_email': 'alice@example.com'
            },
            'user_profile': {
                'first_name': 'Alice',
                'email': 'alice@example.com'
            },
            'has_user_profile': True
        }
    })
    
    # Should trigger greeting for real participant (may need to wait for grace period in real scenarios)
    # In test environment, should process immediately due to no event loop
    assert len(mock_messages) > 0, "Real participant join should trigger greeting messages"
    
    # Check that the greeting message contains personalized content
    greeting_found = False
    for msg in mock_messages:
        if msg.get('role') == 'system' and 'Alice' in msg.get('content', ''):
            greeting_found = True
            break
    
    assert greeting_found, "Greeting should contain participant's name"


def test_mixed_local_and_real_participants(registered_handlers):
    """Test scenario with both local bot and real participants joining."""
    mock_messages = registered_handlers['mock_messages']
    
    # Clear any existing messages
    mock_messages.clear()
    
    # First, local bot joins (should not trigger greeting)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'local',
        'name': None
    })
    
    # Verify no messages yet
    assert len(mock_messages) == 0, "Local bot should not trigger greeting"
    
    # Then real participant joins (should trigger greeting)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'real-user-456',
        'name': 'Bob',
        'context': {
            'session_metadata': {
                'session_user_id': 'user-456', 
                'session_user_name': 'Bob Johnson',
                'session_user_email': 'bob@example.com'
            },
            'user_profile': {
                'first_name': 'Bob',
                'email': 'bob@example.com'
            },
            'has_user_profile': True
        }
    })
    
    # Should now have greeting messages for the real participant only
    assert len(mock_messages) > 0, "Real participant should trigger greeting"
    
    # Verify greeting is for Bob, not local bot
    greeting_content = ""
    for msg in mock_messages:
        if msg.get('role') == 'system':
            greeting_content += msg.get('content', '')
    
    assert 'Bob' in greeting_content, "Greeting should mention Bob's name"
    assert 'local' not in greeting_content.lower(), "Greeting should not mention local bot"


def test_roster_tracking_with_local_bot(registered_handlers):
    """Test that roster tracking works correctly with local bot filtering."""
    
    # Test first participant join (local bot)
    eventbus.bus.publish('daily.participant.first.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'local',
        'name': None
    })
    
    # Test regular participant join (local bot)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'local',
        'name': None
    })
    
    # Should not crash or cause issues - just be filtered out from greeting logic
    # This test mainly ensures the filtering doesn't break other functionality


def test_stealth_participant_does_not_trigger_greeting(registered_handlers):
    """Test that stealth participants don't trigger greetings."""
    mock_messages = registered_handlers['mock_messages']
    
    # Clear any existing messages
    mock_messages.clear()
    
    # Simulate stealth participant joining
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'stealth-user-789',
        'name': 'StealthUser',
        'context': {
            'session_metadata': {
                'session_user_id': 'stealth-789',
                'session_user_name': 'Stealth User',
                'session_user_email': 'stealth@example.com',
                'stealth': True  # This should prevent greeting
            }
        }
    })
    
    # Should have NO messages queued (no greeting triggered for stealth user)
    assert len(mock_messages) == 0, "Stealth participant should not trigger any greeting messages"


def test_stealth_sentinel_without_flag_does_not_trigger_greeting(registered_handlers):
    """Sentinel session_user_id should suppress greeting even without explicit stealth flag."""
    mock_messages = registered_handlers['mock_messages']

    mock_messages.clear()

    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'guest-user-000',
        'name': 'Guest',
        'context': {
            'session_metadata': {
                'session_user_id': STEALTH_SESSION_USER_ID,
                'session_user_name': 'Guest'
            }
        }
    })

    assert len(mock_messages) == 0, "Stealth sentinel session_user_id should suppress greeting"


def test_non_stealth_after_stealth_participant(registered_handlers):
    """Test that non-stealth participants still trigger greetings after stealth participants join."""
    mock_messages = registered_handlers['mock_messages']
    
    # Clear any existing messages
    mock_messages.clear()
    
    # First, stealth participant joins (should not trigger greeting)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'stealth-user-999',
        'name': 'StealthUser',
        'context': {
            'session_metadata': {
                'session_user_id': 'stealth-999',
                'session_user_name': 'Stealth User',
                'stealth': True
            }
        }
    })
    
    # Verify no messages yet
    assert len(mock_messages) == 0, "Stealth participant should not trigger greeting"
    
    # Then regular participant joins (should trigger greeting)
    eventbus.bus.publish('daily.participant.join', {
        'room': 'https://daily.co/test-room',
        'participant': 'regular-user-111',
        'name': 'Charlie',
        'context': {
            'session_metadata': {
                'session_user_id': 'user-111',
                'session_user_name': 'Charlie Brown',
                'session_user_email': 'charlie@example.com'
                # No stealth flag - should trigger greeting
            },
            'user_profile': {
                'first_name': 'Charlie',
                'email': 'charlie@example.com'
            }
        }
    })
    
    # Should now have greeting messages for Charlie only
    assert len(mock_messages) > 0, "Non-stealth participant should trigger greeting"
    
    # Verify greeting is for Charlie, not stealth user
    greeting_content = ""
    for msg in mock_messages:
        if msg.get('role') == 'system':
            greeting_content += msg.get('content', '')
    
    assert 'Charlie' in greeting_content, "Greeting should mention Charlie's name"
    assert 'Stealth' not in greeting_content, "Greeting should not mention stealth user"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])