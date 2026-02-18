"""
Tests for bot session state management (collaborative notes)

Tests cover:
- get_active_note_id / set_active_note_id
- get_room_tenant_id / set_room_tenant_id
- Session state isolation between rooms
- Tool handler integration
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from room import state

@pytest.fixture(autouse=True)
def mock_redis():
    """Mock RedisClient for all tests in this module."""
    # Create a mock RedisClient instance
    mock_client = AsyncMock()
    
    # Mock storage for get/set
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
    
    # Mock _get_redis to return self (mock_client)
    mock_client._get_redis = AsyncMock(return_value=mock_client)
    
    # Patch the _redis instance in state module
    with patch.object(state, '_redis', mock_client):
        yield mock_client

@pytest.mark.asyncio
async def test_active_note_state_management():
    """Test get/set active note ID for rooms"""
    
    # Initially no note
    assert await state.get_active_note_id("https://test.daily.co/room1") is None
    
    # Set note
    await state.set_active_note_id("https://test.daily.co/room1", "note-123")
    assert await state.get_active_note_id("https://test.daily.co/room1") == "note-123"
    
    # Different room should be empty
    assert await state.get_active_note_id("https://test.daily.co/room2") is None
    
    # Update note
    await state.set_active_note_id("https://test.daily.co/room1", "note-456")
    assert await state.get_active_note_id("https://test.daily.co/room1") == "note-456"
    
    # Clear note (set to None)
    await state.set_active_note_id("https://test.daily.co/room1", None)
    assert await state.get_active_note_id("https://test.daily.co/room1") is None

@pytest.mark.asyncio
async def test_room_tenant_state_management():
    """Test get/set tenant ID for rooms"""
    
    # Initially no tenant
    assert state.get_room_tenant_id("https://test.daily.co/room1") is None
    
    # Set tenant
    state.set_room_tenant_id("https://test.daily.co/room1", "tenant-123")
    assert state.get_room_tenant_id("https://test.daily.co/room1") == "tenant-123"
    
    # Verify local cache was updated
    assert state._room_tenants["https://test.daily.co/room1"] == "tenant-123"
    
    # Different room should be empty
    assert state.get_room_tenant_id("https://test.daily.co/room2") is None
    
    # Update tenant
    state.set_room_tenant_id("https://test.daily.co/room1", "tenant-456")
    assert state.get_room_tenant_id("https://test.daily.co/room1") == "tenant-456"
    assert state._room_tenants["https://test.daily.co/room1"] == "tenant-456"

@pytest.mark.asyncio
async def test_session_isolation():
    """Test that different rooms have isolated state"""
    
    await state.set_active_note_id("https://test.daily.co/room1", "note-1")
    await state.set_active_note_id("https://test.daily.co/room2", "note-2")
    
    state.set_room_tenant_id("https://test.daily.co/room1", "tenant-1")
    state.set_room_tenant_id("https://test.daily.co/room2", "tenant-2")
    
    assert await state.get_active_note_id("https://test.daily.co/room1") == "note-1"
    assert await state.get_active_note_id("https://test.daily.co/room2") == "note-2"
    
    assert state.get_room_tenant_id("https://test.daily.co/room1") == "tenant-1"
    assert state.get_room_tenant_id("https://test.daily.co/room2") == "tenant-2"

@pytest.mark.asyncio
async def test_state_persistence_across_calls():
    """Test that state persists across multiple function calls"""
    
    state._room_tenants.clear()
    
    room = "https://test.daily.co/persist"
    
    # Simulate session lifecycle
    state.set_room_tenant_id(room, "tenant-persist")
    assert state.get_room_tenant_id(room) == "tenant-persist"
    
    # User opens note
    await state.set_active_note_id(room, "note-first")
    assert await state.get_active_note_id(room) == "note-first"
    
    # Multiple operations on same note
    for _ in range(5):
        assert await state.get_active_note_id(room) == "note-first"
    
    # Switch to different note
    await state.set_active_note_id(room, "note-second")
    assert await state.get_active_note_id(room) == "note-second"
    assert state.get_room_tenant_id(room) == "tenant-persist"




@pytest.mark.asyncio
async def test_url_normalization():
    """Test that room URLs are handled consistently"""
    
    # Same logical room with different URL formats
    url1 = "https://test.daily.co/room"
    url2 = "https://test.daily.co/room/"  # trailing slash
    
    # Current implementation uses URLs as-is (no normalization)
    # This test documents current behavior
    await state.set_active_note_id(url1, "note-1")
    
    # These are treated as different keys
    assert await state.get_active_note_id(url1) == "note-1"
    assert await state.get_active_note_id(url2) is None
    
    # Note: If URL normalization is needed, add it to bot.py helpers