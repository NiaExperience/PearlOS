import os
from unittest.mock import AsyncMock, MagicMock

import pytest

from pipeline.builder import build_pipeline


@pytest.fixture(autouse=True)
def mock_redis(monkeypatch):
    """Mock RedisClient for all tests in this module."""
    mock_client = AsyncMock()
    storage = {}
    async def mock_set(key, value, ex=None):
        storage[key] = value
    async def mock_get(key):
        return storage.get(key)
    async def mock_delete(key):
        storage.pop(key, None)
    
    mock_client.set = AsyncMock(side_effect=mock_set)
    mock_client.get = AsyncMock(side_effect=mock_get)
    mock_client.delete = AsyncMock(side_effect=mock_delete)
    
    # Mock the RedisClient wrapper
    mock_redis_wrapper = MagicMock()
    mock_redis_wrapper._get_redis = AsyncMock(return_value=mock_client)
    
    # Patch the _redis instance in room.state
    # We need to patch the module where it's defined/used
    try:
        monkeypatch.setattr("room.state._redis", mock_redis_wrapper)
    except ImportError:
        # Fallback if running from different context
        monkeypatch.setattr("bot.room.state._redis", mock_redis_wrapper)
    return mock_client
@pytest.mark.asyncio
async def test_build_pipeline_returns_expected_tuple(monkeypatch):
    # Provide fake room and personality; just ensure objects returned have expected attrs.
    room_url = "https://example.daily.co/fakeroom"
    personality = "does not exist"

    # If heavy services are not configured properly (missing API keys), we still want this to raise
    # a controlled error rather than hang. Keys can be blank for construction.
    monkeypatch.setenv("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", "test"))
    monkeypatch.setenv("DEEPGRAM_API_KEY", os.getenv("DEEPGRAM_API_KEY", "test"))
    monkeypatch.setenv("ELEVENLABS_API_KEY", os.getenv("ELEVENLABS_API_KEY", "test"))

    # Mock functional prompts (required for toolbox preparation)
    functional_prompts = {
        "bot_replace_note": "Test: Update the note content",
        "bot_create_note": "Test: Create a new note"
    }

    pipeline, task, context_agg, transport, messages, multi_user_aggregator, context, personality_message, _flow_manager, forwarder_ref, tts = await build_pipeline(
        room_url,
        personality,
        "test-id",
        "test-token",
        None,
        preloaded_prompts=functional_prompts,
    )

    # Basic structural assertions
    assert forwarder_ref is not None
    assert isinstance(forwarder_ref, dict)
    assert 'instance' in forwarder_ref
    assert messages[0]["role"] == "system"
    assert 'I am a helpful conversationalist.' in messages[0]["content"]
    assert hasattr(pipeline, "add_processor") or hasattr(pipeline, "_processors")
    assert hasattr(task, "queue_frames")
    assert hasattr(context_agg, "user")
    assert hasattr(transport, "set_log_level")
    assert multi_user_aggregator is not None
    assert hasattr(multi_user_aggregator, "set_participant_name")
    assert hasattr(multi_user_aggregator, "get_participant_name")
    assert context is not None
    assert personality_message is not None
    assert personality_message["role"] == "system"


@pytest.mark.asyncio
async def test_build_pipeline_uses_kokoro_provider(monkeypatch):
    room_url = "https://example.daily.co/kokoro"
    personality = "test"

    monkeypatch.setenv("BOT_TTS_PROVIDER", "kokoro")
    monkeypatch.setenv("KOKORO_TTS_API_KEY", "test-key")
    monkeypatch.setenv("KOKORO_TTS_BASE_URL", "ws://127.0.0.1:65535")
    monkeypatch.setenv("KOKORO_TTS_VOICE_ID", "af_alloy")

    monkeypatch.setenv("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", "test"))
    monkeypatch.setenv("DEEPGRAM_API_KEY", os.getenv("DEEPGRAM_API_KEY", "test"))
    monkeypatch.setenv("ELEVENLABS_API_KEY", os.getenv("ELEVENLABS_API_KEY", "test"))

    functional_prompts = {
        "bot_replace_note": "Update note",
        "bot_create_note": "Create note",
    }

    pipeline, *_, tts_service = await build_pipeline(
        room_url,
        personality,
        "kokoro-id",
        "token",
        None,
        preloaded_prompts=functional_prompts,
    )

    processors = getattr(pipeline, "_processors", None)
    assert processors is not None

    found_kokoro = False
    for proc in processors:
        if proc.__class__.__name__ == "KokoroTTSService" and proc.__class__.__module__.endswith("kokoro"):
            found_kokoro = True
            break
        if proc.__class__.__name__ == "ServiceSwitcher":
            # Check inside switcher
            # Accessing protected member _services for test verification
            print(f"DEBUG: ServiceSwitcher found. Attributes: {dir(proc)}")
            if hasattr(proc, "_services"):
                print(f"DEBUG: _services: {proc._services}")
                for svc in proc._services.values():
                    print(f"DEBUG: Checking service: {svc.__class__.__name__} module: {svc.__class__.__module__}")
                    if svc.__class__.__name__ == "KokoroTTSService" and svc.__class__.__module__.endswith("kokoro"):
                        found_kokoro = True
                        break
            elif hasattr(proc, "services"):
                print(f"DEBUG: services: {proc.services}")
                # ServiceSwitcher.services can be a list or a dict
                services_iter = proc.services.values() if isinstance(proc.services, dict) else proc.services
                for svc in services_iter:
                    if svc.__class__.__name__ == "KokoroTTSService" and svc.__class__.__module__.endswith("kokoro"):
                        found_kokoro = True
                        break
    
    assert found_kokoro, "KokoroTTSService not found in pipeline (checked directly and inside ServiceSwitcher)"
