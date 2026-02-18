import pytest

from bot.actions import personality_actions


@pytest.mark.asyncio
async def test_resolve_personality_backfills_sprite_primary_prompt_from_original_request(monkeypatch):
    tenant_id = "tenant-1"
    sprite_id = "sprite-123"

    async def fake_get_personality_by_id(_tenant_id: str, _personality_id: str):
        return None

    async def fake_get_sprite_by_id(_sprite_id: str):
        return {
            "_id": sprite_id,
            "name": "Unicorn robot",
            "originalRequest": "Unicorn robot",
            "voiceProvider": "kokoro",
            "voiceId": "bm_fable",
            "voiceParameters": {"speed": 1.0},
        }

    monkeypatch.setattr(personality_actions, "get_personality_by_id", fake_get_personality_by_id)
    monkeypatch.setattr(personality_actions, "get_sprite_by_id", fake_get_sprite_by_id)

    resolved = await personality_actions.resolve_personality(tenant_id, sprite_id)

    assert resolved is not None
    assert resolved["type"] == "Sprite"
    assert resolved["_id"] == sprite_id
    assert resolved["voiceProvider"] == "kokoro"
    assert resolved["voiceId"] == "bm_fable"
    assert resolved["voiceParameters"] == {"speed": 1.0}
    assert resolved["name"] == "Unicorn robot"
    assert "You are a pixel sprite character" in resolved["primaryPrompt"]
    assert "Character description: Unicorn robot" in resolved["primaryPrompt"]


@pytest.mark.asyncio
async def test_resolve_personality_does_not_override_existing_sprite_primary_prompt(monkeypatch):
    tenant_id = "tenant-1"
    sprite_id = "sprite-456"
    existing_prompt = "EXISTING PROMPT"

    async def fake_get_personality_by_id(_tenant_id: str, _personality_id: str):
        return None

    async def fake_get_sprite_by_id(_sprite_id: str):
        return {
            "_id": sprite_id,
            "name": "Funky salamander",
            "primaryPrompt": existing_prompt,
            "voiceProvider": "11labs",
            "voiceId": "abc123",
        }

    monkeypatch.setattr(personality_actions, "get_personality_by_id", fake_get_personality_by_id)
    monkeypatch.setattr(personality_actions, "get_sprite_by_id", fake_get_sprite_by_id)

    resolved = await personality_actions.resolve_personality(tenant_id, sprite_id)

    assert resolved is not None
    assert resolved["type"] == "Sprite"
    assert resolved["primaryPrompt"] == existing_prompt