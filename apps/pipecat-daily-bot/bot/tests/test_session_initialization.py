import json

import pytest

from session.initialization import initialize_session_config


@pytest.mark.asyncio
async def test_stale_preloaded_personality_is_fallback_when_db_misses(monkeypatch):
    fallback = {
        "_id": "pearl-default",
        "name": "Pearl",
        "primaryPrompt": "You are Pearl.",
    }
    monkeypatch.setenv("BOT_PERSONALITY_RECORD", json.dumps(fallback))

    async def fake_get_personality_by_id(_tenant_id: str, _personality_id: str):
        return None

    monkeypatch.setattr(
        "actions.personality_actions.get_personality_by_id",
        fake_get_personality_by_id,
    )

    config = await initialize_session_config(
        "https://daily.test/voice-room",
        "missing-personality",
        "tenant-1",
    )

    assert config.personality_record == fallback


@pytest.mark.asyncio
async def test_requested_db_personality_wins_over_stale_preloaded_record(monkeypatch):
    fallback = {
        "_id": "pearl-default",
        "name": "Pearl",
        "primaryPrompt": "You are Pearl.",
    }
    requested = {
        "_id": "requested-personality",
        "name": "Requested Pearl",
        "primaryPrompt": "You are the requested Pearl.",
    }
    monkeypatch.setenv("BOT_PERSONALITY_RECORD", json.dumps(fallback))

    async def fake_get_personality_by_id(_tenant_id: str, _personality_id: str):
        return requested

    monkeypatch.setattr(
        "actions.personality_actions.get_personality_by_id",
        fake_get_personality_by_id,
    )

    config = await initialize_session_config(
        "https://daily.test/voice-room",
        "requested-personality",
        "tenant-1",
    )

    assert config.personality_record == requested
