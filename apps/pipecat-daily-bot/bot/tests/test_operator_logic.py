import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from bot_operator import BotOperator

@pytest.mark.asyncio
@patch("bot_operator.config")
@patch("bot_operator.client")
async def test_dispatch_to_warm_pool_retries(mock_client, mock_config):
    # Mock Redis
    mock_redis = AsyncMock()
    # First call returns bad_url, second returns good_url, third returns None (empty)
    mock_redis.rpop.side_effect = ["http://bad:8080", "http://good:8080", None]

    # Mock Operator
    operator = BotOperator()
    operator.redis = mock_redis
    
    # Mock aiohttp ClientSession
    with patch("aiohttp.ClientSession") as mock_session_cls:
        mock_session = AsyncMock()
        mock_session_cls.return_value = mock_session
        mock_session.__aenter__.return_value = mock_session
        
        # Mock post response
        # session.post is NOT async itself, it returns a context manager
        # We must replace the AsyncMock child with a MagicMock so it doesn't return a coroutine
        mock_session.post = MagicMock()
        mock_post_cm = MagicMock()
        mock_session.post.return_value = mock_post_cm
        
        # First response (bad)
        bad_resp = AsyncMock()
        bad_resp.status = 500
        
        # Second response (good)
        good_resp = AsyncMock()
        good_resp.status = 200
        
        # __aenter__ is async, so it returns a coroutine that resolves to the response
        # But AsyncMock.__aenter__ returns the return_value.
        # We need __aenter__ to return the response object.
        mock_post_cm.__aenter__.side_effect = [bad_resp, good_resp]
        mock_post_cm.__aexit__.return_value = None
        
        # Run dispatch
        job = {"room_url": "https://test.daily.co/test"}
        result = await operator.dispatch_to_warm_pool(job)
        
        # Verify result
        assert result is True
        
        # Verify Redis calls
        assert mock_redis.rpop.call_count == 2
        
        # Verify aiohttp calls
        # Should have called post twice
        assert mock_session.post.call_count == 2

@pytest.mark.asyncio
@patch("bot_operator.config")
@patch("bot_operator.client")
async def test_dispatch_to_warm_pool_exhausted(mock_client, mock_config):
    # Mock Redis
    mock_redis = AsyncMock()
    # All return bad urls until None
    mock_redis.rpop.side_effect = ["http://bad1:8080", "http://bad2:8080", None]

    # Mock Operator
    operator = BotOperator()
    operator.redis = mock_redis
    
    # Mock aiohttp ClientSession
    with patch("aiohttp.ClientSession") as mock_session_cls:
        mock_session = AsyncMock()
        mock_session_cls.return_value = mock_session
        mock_session.__aenter__.return_value = mock_session
        
        # Mock post response
        mock_session.post = MagicMock()
        mock_post_cm = MagicMock()
        mock_session.post.return_value = mock_post_cm
        
        # All responses bad
        bad_resp = AsyncMock()
        bad_resp.status = 500
        
        mock_post_cm.__aenter__.return_value = bad_resp
        mock_post_cm.__aexit__.return_value = None
        
        # Run dispatch
        job = {"room_url": "https://test.daily.co/test"}
        result = await operator.dispatch_to_warm_pool(job)
        
        # Verify result
        assert result is False
        
        # Verify Redis calls
        assert mock_redis.rpop.call_count == 3 # bad1, bad2, None
