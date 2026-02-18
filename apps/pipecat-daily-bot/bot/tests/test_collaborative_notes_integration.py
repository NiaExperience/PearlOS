"""
Integration tests for collaborative notes feature

Tests the complete flow:
1. Interface sends note context to bot server
2. Bot stores context in session state
3. User interacts via voice (tool calls)
4. Bot updates notes via Mesh with dual-secret auth
5. Bot emits nia.event refresh
6. Interface receives and processes event

These tests verify end-to-end integration without requiring
live Daily.co calls or actual network requests.
"""
from asyncio.log import logger
from collections.abc import Mapping
import os
from typing import Any, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from actions import notes_actions
from tools import events
from room import state as room_state
from pipecat.services.llm_service import FunctionCallParams
from pipecat.frames.frames import FunctionCallResultProperties

class RecordingForwarder:
    """Capture nia.event tool emissions during tests."""

    def __init__(self) -> None:
        self.calls = []
        self.tool_events = []

    async def _send(self, envelope):  # pragma: no cover - helper for tests only
        self.calls.append(envelope)

    async def emit_tool_event(self, topic, data, target_session_user_id=None):  # pragma: no cover - helper for tests
        self.tool_events.append(
            {
                "topic": topic,
                "data": data,
                "target_session_user_id": target_session_user_id,
            }
        )


_REGISTERED_TENANTS: set[str] = set()


@pytest.fixture(autouse=True)
def mock_redis():
    """Mock RedisClient for all tests in this module."""
    mock_client = AsyncMock()
    storage = {}
    async def mock_set(key, value, ex=None):
        storage[key] = value
    async def mock_get(key):
        return storage.get(key)
    async def mock_delete(key):
        storage.pop(key, None)
    mock_client.set.side_effect = mock_set
    mock_client.get.side_effect = mock_get
    mock_client.delete.side_effect = mock_delete
    
    # Configure _get_redis to return the mock_client itself
    mock_client._get_redis.return_value = mock_client
    
    with patch.object(room_state, '_redis', mock_client):
        yield mock_client


@pytest.fixture
def registered_tenant(mesh_test_server, unique_tenant_id):
    """Ensure Mesh content definitions are registered for the generated tenant."""
    from nia_content_definitions import ALL_DEFINITIONS, ensure_content_definitions

    mesh_url = os.environ.get("MESH_API_ENDPOINT", "http://localhost:5002")
    mesh_secret = os.environ.get("MESH_SHARED_SECRET", "test-mesh-secret")

    if unique_tenant_id not in _REGISTERED_TENANTS:
        results = ensure_content_definitions(
            definitions=ALL_DEFINITIONS,
            mesh_url=mesh_url,
            tenant=unique_tenant_id,
            mesh_secret=mesh_secret,
        )

        if not any(results.values()):
            pytest.fail(f"Failed to register content definitions for tenant {unique_tenant_id}")

        _REGISTERED_TENANTS.add(unique_tenant_id)

    return unique_tenant_id


@pytest.mark.asyncio
async def test_full_note_update_flow():
    """
    Test complete flow: context → state → update → event emission
    
    Simulates:
    1. Interface sends activeNoteId to bot server
    2. Bot stores it in session state
    3. User says "update note to say: Hello World"
    4. Bot calls bot_replace_note tool
    5. Tool updates via Mesh (dual-secret auth)
    6. Tool emits nia.event
    7. Interface would refresh
    """
    from tools.notes import bot_replace_note
    
    # 1. Setup: Interface sends context (simulated)
    room_url = "https://test.daily.co/integration"
    note_id = "510d8839-48df-42a5-b589-4132fb7ba790"  # Hardcoded test note
    tenant_id = "tenant-integration"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    await room_state.set_active_note_id(room_url, note_id)
    
    # 2. Verify state stored
    assert await room_state.get_active_note_id(room_url) == note_id
    assert room_state.get_room_tenant_id(room_url) == tenant_id
    
    # 3. Simulate tool call from LLM
    updated_note = {
        "_id": note_id,
        "title": "Integration Test",
        "content": "Hello World"
    }
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()  # Legacy path should remain unused
    mock_forwarder.emit_tool_event = AsyncMock()
    params = FunctionCallParams(None, None, {"userId": "integration-user"}, None, None, None)
    params.forwarder = mock_forwarder
    
    with patch('actions.notes_actions.update_note_content', new_callable=AsyncMock, return_value=True), \
        patch('actions.notes_actions.get_note_by_id', new_callable=AsyncMock, return_value=updated_note), \
        patch('tools.notes.crud.sharing_actions.check_resource_write_permission', new_callable=AsyncMock, return_value=True):
        # 4. Execute tool (bot calls this during function call)
        result = await bot_replace_note(room_url, "Hello World", mock_forwarder, params=params)
        
        # 5. Verify note updated
        assert result is not None
        assert result["success"] is True
        assert result["note"]["_id"] == note_id
        assert result["note"]["content"] == "Hello World"
        
    # 6. Verify event emitted
    mock_forwarder._send.assert_not_called()

    mock_forwarder.emit_tool_event.assert_awaited()
    refresh_calls = [
        call for call in mock_forwarder.emit_tool_event.await_args_list
        if call.args and call.args[0] == events.NOTES_REFRESH
    ]
    assert len(refresh_calls) == 1
    refresh_args = refresh_calls[0].args
    refresh_kwargs = refresh_calls[0].kwargs
    assert refresh_args[1]["noteId"] == note_id
    assert refresh_args[1]["action"] == "update"
    assert "timestamp" in refresh_args[1]
    assert refresh_kwargs == {}


@pytest.mark.asyncio
async def test_append_flow_with_formatting(mesh_test_server, registered_tenant, unique_user_id, register_mesh_record):
    """
    Test append flow with list item formatting
    
    User says: "add item: buy milk"
    Bot should append "- buy milk" to note
    """
    import bot
    from tools.notes import bot_add_note_content
    
    tenant_id = registered_tenant
    room_url = f"https://test.daily.co/{tenant_id}-append"

    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)

    created = await notes_actions.create_note(
        tenant_id=tenant_id,
        user_id=unique_user_id,
        title="Shopping List",
        content="# Shopping List\n- eggs",
    )
    register_mesh_record("Notes", created, tenant_id)
    await room_state.set_active_note_id(room_url, created["_id"])

    captured_result: dict[str, Any] | None = None
    async def function_call_result_callback(result: Any, *, properties: Optional[FunctionCallResultProperties] = None):
        nonlocal captured_result
        captured_result = result

    forwarder = RecordingForwarder()
    forwarder.transport = MagicMock()

    arguments = {"content": "- buy milk", "position": "end", "userId": unique_user_id}
    params = FunctionCallParams('bot_add_note_content', 'tool-call-1', arguments, None, None, result_callback=function_call_result_callback)
    params.room_url = room_url
    params.forwarder = forwarder

    await bot_add_note_content(params)

    assert captured_result is not None
    assert captured_result["success"] is True
    assert "- buy milk" in captured_result["note"]["content"]
    persisted = await notes_actions.get_note_by_id(tenant_id, created["_id"])
    assert "- buy milk" in persisted["content"]

    assert forwarder.calls == []

    refresh_events = [evt for evt in forwarder.tool_events if evt["topic"] == events.NOTES_REFRESH]
    assert len(refresh_events) == 1
    refresh_detail = refresh_events[0]["data"]
    assert refresh_detail["noteId"] == created["_id"]
    assert refresh_detail["action"] == "update"
    assert "timestamp" in refresh_detail


@pytest.mark.asyncio
async def test_delete_note_by_title_uses_fuzzy_lookup(mesh_test_server, registered_tenant, unique_user_id, register_mesh_record, mesh_record_tracker):
    """Verify bot_delete_note deletes using fuzzy title search and emits delete events."""
    from tools.notes import bot_delete_note

    room_url = "https://test.daily.co/delete-flow"
    tenant_id = registered_tenant

    room_state._room_tenants.clear()

    created = await notes_actions.create_note(
        tenant_id=tenant_id,
        user_id=unique_user_id,
        title="Dog Tricks",
        content="- rollover"
    )
    register_mesh_record("Notes", created, tenant_id)

    # Set active note so deletion clears it
    room_state.set_room_tenant_id(room_url, tenant_id)
    await room_state.set_active_note_id(room_url, created["_id"])

    forwarder = RecordingForwarder()
    arguments = { "userId": unique_user_id }
    params = FunctionCallParams(
        None,
        None,
        arguments,
        None,
        None,
        None
    )
    params.forwarder = forwarder
    result = await bot_delete_note(room_url, None, "dog tricks", True, forwarder, params)

    assert result is not None
    assert result["success"] is True

    # Mesh should no longer return the deleted note
    deleted_note = await notes_actions.get_note_by_id(tenant_id, created["_id"])
    assert deleted_note is None

    # Prevent cleanup from attempting to delete again
    mesh_record_tracker.mark_deleted("Notes", created, tenant_id)

    # Active note state should be cleared
    assert await room_state.get_active_note_id(room_url) is None

    # NOTE_DELETED and notes.refresh events are emitted with the correct payloads
    assert len(forwarder.tool_events) == 2
    topics = {evt["topic"]: evt["data"] for evt in forwarder.tool_events}
    assert topics["note.deleted"] == {"noteId": created["_id"]}
    refresh_detail = topics[events.NOTES_REFRESH]
    assert refresh_detail["noteId"] == created["_id"]
    assert refresh_detail["action"] == "delete"
    assert "timestamp" in refresh_detail


@pytest.mark.asyncio
async def test_delete_note_not_found_does_not_emit_event(unique_user_id):
    """Ensure deletion failures skip event emission."""
    from tools.notes import bot_delete_note

    room_url = "https://test.daily.co/delete-failure"
    tenant_id = "tenant-delete-failure"

    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)

    forwarder = RecordingForwarder()
    arguments = { "userId": unique_user_id }
    params = FunctionCallParams(
        None,
        None,
        arguments,
        None,
        None,
        None
    )
    params.forwarder = forwarder
    result = await bot_delete_note(room_url, None, "missing note", True, forwarder, params)

    assert result is not None
    assert result["success"] is False
    assert "not found" in (result.get("error") or result.get("user_message", "")).lower()

    # No events should be emitted on failure
    assert forwarder.tool_events == []


@pytest.mark.asyncio
async def test_create_and_switch_flow():
    """
    Test creating new note and switching active note
    
    User says: "create a new note called TODO"
    Bot creates note and sets it as active
    """
    import bot
    from tools.notes import bot_create_note
    
    room_url = "https://test.daily.co/create-flow"
    tenant_id = "tenant-flow"
    owner_participant_id = "participant-123"
    session_user_id = "user-456"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    # Set a placeholder note with owner (required for bot_create_note to get owner)
    await room_state.set_active_note_id(room_url, "placeholder-note", owner=owner_participant_id)
    
    new_note = {
        "_id": "note-new-todo",
        "title": "TODO",
        "content": "# TODO",
        "mode": "work"
    }
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()
    mock_forwarder.emit_tool_event = AsyncMock()  # Also mock emit_tool_event
    
    # Mock transport to provide sessionUserId
    with patch('actions.notes_actions.create_note', new_callable=AsyncMock, return_value=new_note), \
         patch('tools.notes.crud.get_session_user_id_from_participant', return_value=session_user_id):
        result = await bot_create_note(room_url, "TODO", "# TODO", "work", mock_forwarder, None)
        
        assert result is not None
        assert result["success"] is True
        assert result["note"]["_id"] == "note-new-todo"
        
        # Verify note is now active
        assert await room_state.get_active_note_id(room_url) == "note-new-todo"


@pytest.mark.asyncio
async def test_dual_secret_auth_in_mesh_calls(monkeypatch):
    """
    Verify that mesh_client functions send both secrets
    
    This ensures bot has tenant-wide access to notes
    """
    from services.mesh import _headers
    
    # Set both secrets (automatically restored by monkeypatch)
    monkeypatch.setenv('MESH_SHARED_SECRET', 'test-mesh-secret')
    monkeypatch.setenv('BOT_CONTROL_SHARED_SECRET', 'test-bot-secret')
    
    headers = _headers()
    
    # Verify both headers present
    assert 'x-mesh-secret' in headers
    assert 'x-bot-control-secret' in headers
    assert headers['x-mesh-secret'] == 'test-mesh-secret'
    assert headers['x-bot-control-secret'] == 'test-bot-secret'


@pytest.mark.asyncio
async def test_multi_room_isolation(unique_user_id):
    """
    Test that multiple concurrent rooms maintain separate state
    
    Simulates two different calls with different notes
    """
    import bot
    from tools.notes import bot_open_note
    
    room1 = "https://test.daily.co/room1"
    room2 = "https://test.daily.co/room2"
    
    room_state._room_tenants.clear()
    
    # Set up room 1
    room_state.set_room_tenant_id(room1, "tenant-1")
    await room_state.set_active_note_id(room1, "note-1")
    
    # Set up room 2
    room_state.set_room_tenant_id(room2, "tenant-1")
    await room_state.set_active_note_id(room2, "note-2")
    
    note1 = {"_id": "note-1", "title": "Room 1 Note", "userId": unique_user_id}
    note2 = {"_id": "note-2", "title": "Room 2 Note", "userId": unique_user_id}
    
    # Mock fetch to return different notes (fetch_note_by_id now only takes note_id)
    async def mock_fetch(tenant_id, note_id):
        if tenant_id == "tenant-1":
            if note_id == "note-1":
                return note1
            elif note_id == "note-2":
                return note2
        return FileNotFoundError

    with patch('tools.sharing.utils._is_private_single_user_session', return_value=True):   
        with patch('actions.notes_actions.get_note_by_id', side_effect=mock_fetch):
            with patch('actions.sharing_actions.check_resource_read_permission', new_callable=AsyncMock, return_value=True):
                forwarder = MagicMock()
                forwarder.transport = MagicMock()
                arguments = {"userId": unique_user_id}
                params = FunctionCallParams('bot_open_note', 'tool-call-2', arguments, None, None, None)
                params.room_url = room1
                params.forwarder = forwarder

                result1 = await bot_open_note(room1, params=params)
                result2 = await bot_open_note(room2, params=params)
                
                # bot_open_note returns {"success": True, "note": {...}}
                assert result1["success"] is True
                assert result1["note"]["_id"] == "note-1"
                assert result1["note"]["title"] == "Room 1 Note"
                
                assert result2["success"] is True
                assert result2["note"]["_id"] == "note-2"
                assert result2["note"]["title"] == "Room 2 Note"


@pytest.mark.asyncio
async def test_error_recovery_no_event_on_failure():
    """
    Test that errors don't emit refresh events
    
    If mesh update fails, no event should be sent to interface
    """
    import bot
    from tools.notes import bot_replace_note
    
    room_url = "https://test.daily.co/error-test"
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, "tenant-err")
    await room_state.set_active_note_id(room_url, "note-err")
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()
    
    # Simulate mesh error
    with patch('actions.notes_actions.update_note_content', new_callable=AsyncMock, side_effect=Exception("Network error")):
        result = await bot_replace_note(room_url, "Content", mock_forwarder)
        
        # Should return None on error
        assert result is not None
        assert result["success"] is False
        
        # No event should be emitted
        mock_forwarder._send.assert_not_called()


@pytest.mark.asyncio
async def test_hardcoded_note_scenario(mesh_test_server, registered_tenant, unique_user_id, register_mesh_record):
    """Regression test for the manual integration scenario using real Mesh operations."""
    import bot
    from tools.notes import add_note_content_handler as bot_add_note_content

    room_url = "https://nia.daily.co/test-collaborative-notes"

    room_state._room_tenants.clear()

    tenant_id = registered_tenant
    room_state.set_room_tenant_id(room_url, tenant_id)
    created = await notes_actions.create_note(
        tenant_id=tenant_id,
        user_id=unique_user_id,
        title="Collaborative Test Note",
        content="# Test\n- Existing item",
    )
    register_mesh_record("Notes", created, tenant_id)
    await room_state.set_active_note_id(room_url, created["_id"])

    captured_result: dict[str, Any] | None = None
    async def function_call_result_callback(result: Any, *, properties: Optional[FunctionCallResultProperties] = None):
        nonlocal captured_result
        captured_result = result

    forwarder = RecordingForwarder()
    forwarder.transport = MagicMock()
    arguments = {"content": "test integration", "userId": unique_user_id}
    params = FunctionCallParams('bot_add_note_content', 'tool-call-3', arguments, None, None, result_callback=function_call_result_callback)
    params.room_url = room_url
    params.forwarder = forwarder

    await bot_add_note_content(params)

    assert captured_result is not None
    assert captured_result["success"] is True
    assert captured_result["note"]["_id"] == created["_id"]
    assert "test integration" in captured_result["note"]["content"]

    stored = await notes_actions.get_note_by_id(tenant_id, created["_id"])
    assert "test integration" in stored["content"]

    assert forwarder.calls == []

    refresh_events = [evt for evt in forwarder.tool_events if evt["topic"] == events.NOTES_REFRESH]
    assert len(refresh_events) == 1
    refresh_detail = refresh_events[0]["data"]
    assert refresh_detail["noteId"] == created["_id"]
    assert refresh_detail["action"] == "update"
    assert "timestamp" in refresh_detail


@pytest.mark.asyncio
async def test_event_format_matches_interface_expectations():
    """
    Verify nia.event format matches what browser-window.tsx expects
    
    Interface expects: emit_tool_event(events.NOTES_REFRESH, { noteId, action, timestamp })
    """
    from tools.notes.utils import _emit_refresh_event
    
    mock_forwarder = MagicMock()
    mock_forwarder.emit_tool_event = AsyncMock()
    
    await _emit_refresh_event(mock_forwarder, "note-123", "update")
    
    mock_forwarder.emit_tool_event.assert_awaited_once()
    call_args = mock_forwarder.emit_tool_event.call_args
    assert call_args.args[0] == events.NOTES_REFRESH
    payload = call_args.args[1]
    assert payload["noteId"] == "note-123"
    assert payload["action"] == "update"
    assert isinstance(payload["timestamp"], int)


@pytest.mark.asyncio
async def test_user_id_resolution_fallback():
    """
    Test that create_note falls back to identity file scanning when 
    get_session_user_id_from_participant returns None
    
    This tests the fix for the "No user ID found for participant" error
    """
    import bot
    from tools.notes import bot_create_note
    
    room_url = "https://test.daily.co/user-id-fallback"
    tenant_id = "tenant-fallback"
    owner_participant_id = "participant-fallback-123"
    session_user_id = "user-from-identity-file"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    await room_state.set_active_note_id(room_url, "placeholder", owner=owner_participant_id)
    
    new_note = {
        "_id": "note-created",
        "title": "Fallback Test",
        "content": "",
        "mode": "work"
    }
    
    identity_data = {
        "sessionUserId": session_user_id,
        "sessionUserName": "Test User",
        "sessionUserEmail": "test@example.com"
    }
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()
    mock_forwarder.emit_tool_event = AsyncMock()  # Mock as async
    
    # Primary lookup fails (returns None), but identity file scan succeeds
    # Mock _scan_identity_queue as an attribute (create=True since it's a nested function)
    mock_scan = MagicMock(return_value=identity_data)
    
    with patch('tools.notes.crud.get_session_user_id_from_participant', return_value=None), \
         patch('actions.notes_actions.create_note', new_callable=AsyncMock, return_value=new_note), \
         patch.object(room_state, '_scan_identity_queue', mock_scan, create=True):
        
        result = await bot_create_note(room_url, "Fallback Test", "", "work", mock_forwarder, None)
        
        # Should succeed despite primary lookup failure
        assert result is not None
        assert result["success"] is True
        assert result["note"]["_id"] == "note-created"
        assert "user_message" in result
        
        # Verify fallback was called
        mock_scan.assert_called_once_with(room_url, owner_participant_id)


@pytest.mark.asyncio
async def test_user_id_resolution_complete_failure():
    """
    Test that create_note returns user-friendly error when all user ID 
    resolution methods fail
    """
    import bot
    from tools.notes import bot_create_note
    
    room_url = "https://test.daily.co/user-id-fail"
    tenant_id = "tenant-fail"
    owner_participant_id = "participant-fail-123"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    await room_state.set_active_note_id(room_url, "placeholder", owner=owner_participant_id)
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()
    
    # Both primary and fallback lookups fail
    mock_scan = MagicMock(return_value=None)
    
    with patch('tools.notes.crud.get_session_user_id_from_participant', return_value=None), \
         patch.object(room_state, '_scan_identity_queue', mock_scan, create=True):
        
        result = await bot_create_note(room_url, "Should Fail", "", "work", mock_forwarder, None)
        
        # Should fail gracefully with user message
        assert result is not None
        assert result["success"] is False
        assert result["error"] == "No user ID found"  # Updated to match actual error message
        assert "user_message" in result
        assert "user account" in result["user_message"].lower()
        
        # No mesh call should be made
        # No event should be emitted
        mock_forwarder._send.assert_not_called()


@pytest.mark.asyncio
async def test_retry_logic_on_transient_failure():
    """
    Test that note operations retry on transient failures with exponential backoff
    """
    import bot
    from tools.notes import bot_create_note
    
    room_url = "https://test.daily.co/retry-test"
    tenant_id = "tenant-retry"
    owner_participant_id = "participant-retry"
    session_user_id = "user-retry"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    await room_state.set_active_note_id(room_url, "placeholder", owner=owner_participant_id)
    
    new_note = {
        "_id": "note-retry",
        "title": "Retry Test",
        "content": "",
        "mode": "work"
    }
    
    mock_forwarder = MagicMock()
    mock_forwarder._send = AsyncMock()
    mock_forwarder.emit_tool_event = AsyncMock()  # Mock as async
    
    # First two attempts fail, third succeeds
    call_count = 0
    async def mock_create_with_failures(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count < 3:
            return None  # Simulate transient failure
        return new_note
    
    with patch('tools.notes.crud.get_session_user_id_from_participant', return_value=session_user_id), \
         patch('actions.notes_actions.create_note', side_effect=mock_create_with_failures):
        
        result = await bot_create_note(room_url, "Retry Test", "", "work", mock_forwarder, None)
        
        # Should succeed after retries
        assert result is not None
        assert result["success"] is True
        assert result["note"]["_id"] == "note-retry"
        assert call_count == 3  # Should have retried twice


@pytest.mark.asyncio
async def test_error_messages_include_user_friendly_text(unique_user_id):
    """
    Test that all error conditions return user_message for the LLM to speak
    """
    import bot
    from tools.notes import (
        bot_replace_note,
        bot_add_note_content,
        bot_open_note
    )
    
    room_url = "https://test.daily.co/error-messages"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, "tenant-errors")

    forwarder = MagicMock()
    forwarder.transport = MagicMock()
    arguments = {"userId": unique_user_id}
    params = FunctionCallParams('bot_open_note', 'tool-call-4', arguments, None, None, None)
    params.room_url = room_url
    params.forwarder = forwarder
    
    # Test 1: No active note for bot_open_note (error, has message)
    result = await bot_open_note(room_url, params=params)
    assert result["success"] is False
    assert "note" not in result
    assert "user_message" in result
    assert "no active note" in result["user_message"].lower()
    
    # Test 2: No tenant context
    await room_state.set_active_note_id(room_url, "note-123")
    room_state._room_tenants.clear()
    result = await bot_open_note(room_url, params=params)
    assert result["success"] is False
    assert "user_message" in result
    assert "tenant context" in result["user_message"].lower()
    
    # Test 3: No active note for update
    room_state.set_room_tenant_id(room_url, "tenant-errors")
    params = FunctionCallParams(None, None, {"userId": "test-user"}, None, None, None)
    params.forwarder = forwarder
    params.room_url = room_url
    result = await bot_replace_note(room_url, "New content", None, params=params)
    assert result["success"] is False
    assert "user_message" in result
    # Updated assertion to match new error message that mentions specifying note_id
    msg = result["user_message"].lower()
    assert "open a note first" in msg or "specify which note" in msg or "doesn't exist" in msg
    
    # Test 4: Append
    captured_result: dict[str, Any] | None = None
    async def function_call_result_callback(result: Any, *, properties: Optional[FunctionCallResultProperties] = None):
        nonlocal captured_result
        captured_result = result

    forwarder = RecordingForwarder()
    forwarder.transport = MagicMock()

    arguments = {"content": "New item", "userId": unique_user_id }
    params = FunctionCallParams('bot_add_note_content', 'tool-call-5', arguments, None, None, result_callback=function_call_result_callback)
    params.room_url = room_url
    params.forwarder = forwarder

    # Test 4: No active note for append
    await bot_add_note_content(params)
    assert captured_result["success"] is False
    assert "user_message" in captured_result


@pytest.mark.asyncio
async def test_success_messages_for_user_feedback(unique_user_id):
    """
    Test that successful operations also include user_message for positive feedback
    """
    import bot
    from tools.notes import (
        bot_add_note_content,
        bot_create_note
    )
    
    room_url = "https://test.daily.co/success-msg"
    tenant_id = "tenant-success"
    owner_participant_id = "participant-success"
    
    room_state._room_tenants.clear()
    room_state.set_room_tenant_id(room_url, tenant_id)
    
    # Test successful append
    await room_state.set_active_note_id(room_url, "note-existing")
    
    existing_note = {
        "_id": "note-existing",
        "content": "- Item 1"
    }
    
    updated_note = {
        "_id": "note-existing",
        "content": "- Item 1\n- Item 2"
    }
    with patch('actions.notes_actions.get_note_by_id', new_callable=AsyncMock, side_effect=[existing_note, existing_note, updated_note]), \
        patch('actions.notes_actions.update_note_content', new_callable=AsyncMock, return_value=True), \
        patch('tools.notes.crud.sharing_actions.check_resource_write_permission', new_callable=AsyncMock, return_value=True):

        captured_result: dict[str, Any] | None = None
        async def function_call_result_callback(result: Any, *, properties: Optional[FunctionCallResultProperties] = None):
            nonlocal captured_result
            captured_result = result

        forwarder = RecordingForwarder()
        forwarder.transport = MagicMock()

        arguments = {"content": "- Item 2", "userId": unique_user_id }
        params = FunctionCallParams('bot_add_note_content', 'tool-call-5', arguments, None, None, result_callback=function_call_result_callback)
        params.room_url = room_url
        params.forwarder = forwarder

        await bot_add_note_content(params)

        assert captured_result["success"] is True
        assert "user_message" in captured_result
        assert "Item 2" in captured_result["note"]["content"]
        assert "updated the note" in captured_result["user_message"].lower()
    
    # Test successful create
    await room_state.set_active_note_id(room_url, "placeholder", owner=owner_participant_id)
    
    new_note = {
        "_id": "note-new",
        "title": "Success Note",
        "content": "",
        "mode": "work"
    }
    
    with patch('tools.notes.crud.get_session_user_id_from_participant', return_value=unique_user_id), \
         patch('actions.notes_actions.create_note', new_callable=AsyncMock, return_value=new_note), \
         patch('actions.notes_actions.get_note_by_id', new_callable=AsyncMock, side_effect=[existing_note, updated_note]), \
         patch('actions.notes_actions.update_note_content', new_callable=AsyncMock, return_value=True):
                    
        mock_forwarder = MagicMock()
        mock_forwarder._send = AsyncMock()
        mock_forwarder.emit_tool_event = AsyncMock()

        result = await bot_create_note(room_url, "Success Note", "", "work", mock_forwarder, None)
        
        assert result["success"] is True
        assert "user_message" in result
        assert "Success Note" in result["user_message"]
        assert "created" in result["user_message"].lower()
