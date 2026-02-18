"""Unit tests for sharing/utils.py - bot sharing tool handlers and implementation."""

from unittest.mock import MagicMock
import pytest

from pipecat.services.llm_service import FunctionCallParams
from tools.sharing.utils import (
    _extract_user_from_context,
    _resolve_user_id,
)


def test_extract_user_from_context_none():
    """Test extracting user from None context."""
    result = _extract_user_from_context(None)
    assert result is None


def test_extract_user_from_context_empty():
    """Test extracting user from empty context."""
    result = _extract_user_from_context({})
    assert result is None


def test_extract_user_from_context_string():
    """Test extracting user from string context."""
    result = _extract_user_from_context("some context string")
    assert result is None  # Not implemented yet, returns None


@pytest.mark.asyncio
async def test_resolve_user_id_from_arguments(unique_user_id):
    """Test resolving user ID from function arguments."""
    
    class MockTransport:
        def participants(self):
            return {
                'local': {'id': 'local', 'local': True},
                'participant-1': {
                    'id': 'participant-1',
                    'info': {
                        'userData': {
                            'sessionUserId': unique_user_id,
                            'sessionUserName': 'Alice',
                            'private': 'true'
                        }
                    }
                }
            }
    
    forwarder = MagicMock()
    forwarder.transport = MockTransport()

    arguments = {"content": "- buy milk", "position": "end", "userId": unique_user_id}
    params = FunctionCallParams('test', 'tool-call-5', arguments, None, None, None)
    params.room_url = 'room_url'
    params.forwarder = forwarder
    
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id == unique_user_id
    assert error == ""


@pytest.mark.asyncio
async def test_resolve_user_id_no_transport():
    """Test resolving user ID when no transport available."""
    
    class MockParams:
        def __init__(self):
            self.arguments = {}
            self.context = None
    
    from unittest.mock import MagicMock
    
    mock_forwarder = MagicMock()
    mock_forwarder.transport = None
    
    params = MockParams()
    params.forwarder = mock_forwarder
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id is None
    assert "No transport available" in error


@pytest.mark.asyncio
async def test_resolve_user_id_single_participant():
    """Test resolving user ID with single participant."""
    
    class MockParams:
        def __init__(self):
            self.arguments = {}
            self.context = None
    
    class MockTransport:
        def participants(self):
            return {
                'local': {'id': 'local', 'local': True},
                'participant-1': {
                    'id': 'participant-1',
                    'info': {
                        'userData': {
                            'sessionUserId': 'user-789',
                            'sessionUserName': 'Alice'
                        }
                    }
                }
            }
    
    from unittest.mock import MagicMock
    
    mock_forwarder = MagicMock()
    mock_forwarder.transport = MockTransport()
    
    params = MockParams()
    params.forwarder = mock_forwarder
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id == "user-789"
    assert error == ""


@pytest.mark.asyncio
async def test_resolve_user_id_multiple_participants():
    """Test resolving user ID with multiple participants (ambiguous)."""
    
    class MockParams:
        def __init__(self):
            self.arguments = {}
            self.context = None
    
    class MockTransport:
        def participants(self):
            return {
                'local': {'id': 'local', 'local': True},
                'participant-1': {
                    'id': 'participant-1',
                    'info': {
                        'userData': {
                            'sessionUserId': 'user-789',
                            'sessionUserName': 'Alice'
                        }
                    }
                },
                'participant-2': {
                    'id': 'participant-2',
                    'info': {
                        'userData': {
                            'sessionUserId': 'user-999',
                            'sessionUserName': 'Bob'
                        }
                    }
                }
            }
    
    from unittest.mock import MagicMock
    
    mock_forwarder = MagicMock()
    mock_forwarder.transport = MockTransport()
    
    params = MockParams()
    params.forwarder = mock_forwarder
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id is None
    assert "Multiple participants detected" in error
    assert "Alice" in error or "Bob" in error


@pytest.mark.asyncio
async def test_resolve_user_id_no_participants():
    """Test resolving user ID with no human participants."""
    
    class MockParams:
        def __init__(self):
            self.arguments = {}
            self.context = None
    
    class MockTransport:
        def participants(self):
            return {
                'local': {'id': 'local', 'local': True}
            }
    
    from unittest.mock import MagicMock
    
    mock_forwarder = MagicMock()
    mock_forwarder.transport = MockTransport()
    
    params = MockParams()
    params.forwarder = mock_forwarder
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id is None
    assert "No human participants" in error

@pytest.mark.asyncio
async def test_resolve_user_id_from_context_pid():
    """Test resolving user ID from PID in context messages (Strategy 2.5)."""
    
    # Mock Transport with participants
    class MockTransport:
        def participants(self):
            return {
                'local': {'id': 'local', 'local': True},
                'p-123': {
                    'id': 'p-123',
                    'info': {
                        'userId': 'user-alice-id',
                        'userData': {
                            'sessionUserName': 'Alice'
                        }
                    }
                },
                'p-456': {
                    'id': 'p-456',
                    'info': {
                        'userId': 'user-bob-id',
                        'userData': {
                            'sessionUserName': 'Bob'
                        }
                    }
                }
            }
    
    mock_transport = MockTransport()
    mock_forwarder = MagicMock()
    mock_forwarder.transport = mock_transport

    # Case 1: Context has a message with PID for Alice
    # The format is [User Name, pid: ID]
    context_messages = [
        {"role": "system", "content": "System prompt"},
        {"role": "user", "content": "Hello [User Alice, pid: p-123]"},
        {"role": "assistant", "content": "Hi Alice"},
        {"role": "user", "content": "Share this note [User Alice, pid: p-123]"}
    ]
    
    params = FunctionCallParams(
        'share_note',
        'call_1',
        {},
        None, # llm
        context_messages, # context
        None # result_callback
    )
    params.forwarder = mock_forwarder
    params.handler_context = None
    
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id == "user-alice-id"
    assert error == ""

    # Case 2: Context has a message with PID for Bob (most recent)
    context_messages_bob = [
        {"role": "user", "content": "I am Alice [User Alice, pid: p-123]"},
        {"role": "user", "content": "And I am Bob [User Bob, pid: p-456]"}
    ]
    
    params.context = context_messages_bob
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id == "user-bob-id"
    assert error == ""

    # Case 3: PID not found in participants
    context_messages_unknown = [
        {"role": "user", "content": "I am Ghost [User Ghost, pid: p-999]"}
    ]
    
    params.context = context_messages_unknown
    # Should fall back to Strategy 3 (Multiple participants error)
    user_id, error = await _resolve_user_id(params, "https://test.daily.co/room")
    
    assert user_id is None
    assert "Multiple participants detected" in error
