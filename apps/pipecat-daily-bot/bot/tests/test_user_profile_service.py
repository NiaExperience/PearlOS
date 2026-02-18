"""Tests for UserProfileService functionality."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from services.user_profile import UserProfileService, get_profile_service


@pytest.mark.asyncio
async def test_user_profile_service_basic_flow():
    """Test basic profile loading flow."""
    service = UserProfileService()

    # Mock successful profile loading
    mock_profile = {"id": "user123", "name": "Test User", "email": "test@example.com"}
    service._fetch_profile = AsyncMock(return_value=mock_profile)

    profile = await service.load_user_profile("user123")

    assert profile == mock_profile
    assert service.get_cached_profile("user123") == mock_profile
    service._fetch_profile.assert_awaited_once_with("user123")


@pytest.mark.asyncio
async def test_user_profile_service_caching():
    """Test that profiles are cached to avoid duplicate requests."""
    service = UserProfileService()

    mock_profile = {"id": "user456", "name": "Cached User"}
    service._fetch_profile = AsyncMock(return_value=mock_profile)

    # First call should fetch
    profile1 = await service.load_user_profile("user456")
    assert profile1 == mock_profile

    # Second call should use cache
    profile2 = await service.load_user_profile("user456")
    assert profile2 == mock_profile

    # Should only have called fetch once
    service._fetch_profile.assert_awaited_once_with("user456")


@pytest.mark.asyncio
async def test_user_profile_service_error_handling():
    """Test error handling during profile loading."""
    service = UserProfileService()

    service._fetch_profile = AsyncMock(side_effect=Exception("Network error"))

    profile = await service.load_user_profile("user789")

    assert profile is None
    # Error results should also be cached
    assert service.get_cached_profile("user789") is None


@pytest.mark.asyncio
async def test_user_profile_service_invalid_input():
    """Test handling of invalid user IDs."""
    service = UserProfileService()
    
    assert await service.load_user_profile("") is None
    assert await service.load_user_profile(None) is None
    assert await service.load_user_profile("   ") is None
    assert await service.load_user_profile(123) is None


@pytest.mark.asyncio
async def test_user_profile_service_mesh_client_unavailable():
    """Test behavior when mesh_client is not available."""
    service = UserProfileService()

    with patch('services.user_profile.profile_actions', None):
        profile = await service.load_user_profile("user999")

        assert profile is None
        assert service.get_cached_profile("user999") is None


def test_user_profile_service_get_cached_profile():
    """Test get_cached_profile method."""
    service = UserProfileService()
    
    # Empty cache
    assert service.get_cached_profile("user123") is None
    
    # Add to cache manually
    service._profile_cache["user123"] = {"id": "user123", "name": "Test"}
    
    assert service.get_cached_profile("user123") == {"id": "user123", "name": "Test"}
    assert service.get_cached_profile("nonexistent") is None


def test_user_profile_service_clear_cache():
    """Test cache clearing functionality."""
    service = UserProfileService()
    
    # Add some cached data
    service._profile_cache["user1"] = {"id": "user1"}
    service._profile_cache["user2"] = {"id": "user2"}
    
    assert len(service._profile_cache) == 2
    
    service.clear_cache()
    
    assert len(service._profile_cache) == 0


def test_get_profile_service_singleton():
    """Test that get_profile_service returns the same instance."""
    service1 = get_profile_service()
    service2 = get_profile_service()
    
    assert service1 is service2
    assert isinstance(service1, UserProfileService)


@pytest.mark.asyncio
async def test_concurrent_requests_handling():
    """Test handling of concurrent requests for the same user."""
    service = UserProfileService()

    # Mock a slow profile fetch
    async def slow_fetch(user_id):
        await asyncio.sleep(0.1)  # Simulate network delay
        return {"id": user_id, "name": "Slow User"}

    service._fetch_profile = slow_fetch

    # Start two concurrent requests
    task1 = asyncio.create_task(service.load_user_profile("concurrent_user"))
    task2 = asyncio.create_task(service.load_user_profile("concurrent_user"))
    
    results = await asyncio.gather(task1, task2)
    
    # Both should get the same result
    assert results[0] == results[1]
    assert results[0]["id"] == "concurrent_user"