"""Tests for Discord-to-PearlOS user memory helpers."""

from __future__ import annotations

import pytest

from actions import profile_actions


@pytest.fixture(scope="session", autouse=True)
def mesh_test_server():
    """These helper tests mock Mesh directly and do not need the test server."""
    yield


@pytest.mark.asyncio
async def test_get_discord_dm_link_returns_active_link(monkeypatch):
    calls: list[tuple[str, str, dict | None, dict | None]] = []

    async def fake_request(method, path, params=None, json_body=None):
        calls.append((method, path, params, json_body))
        return {
            "success": True,
            "data": [
                {
                    "_id": "revoked",
                    "userId": "old-user",
                    "discordUserId": "698983049660203018",
                    "revokedAt": "2026-01-01T00:00:00.000Z",
                },
                {
                    "_id": "active",
                    "userId": "steph-user",
                    "discordUserId": "698983049660203018",
                    "revokedAt": None,
                },
            ],
        }

    monkeypatch.setattr(profile_actions.mesh_client, "request", fake_request)

    link = await profile_actions.get_discord_dm_link_by_discord_id("698983049660203018")

    assert link is not None
    assert link["_id"] == "active"
    assert calls[0][0] == "GET"
    assert calls[0][1] == "/content/DiscordDmLink"
    assert "698983049660203018" in calls[0][2]["where"]


def test_build_discord_profile_context_includes_private_memory():
    profile = {
        "userId": "steph-user",
        "email": "stephanie@niaxp.com",
        "first_name": "Stephanie",
        "publicPersona": {"displayName": "ImmersiveRiggs", "interests": ["PearlOS"]},
        "privateMemory": {
            "personalNotes": "Max is Steph's daughter, a human child, not a dog.",
            "preferences": {"discord": {"username": "immersiveriggs"}},
        },
    }

    block = profile_actions.build_discord_profile_context(
        profile,
        discord_user_id="698983049660203018",
    )

    assert "Linked PearlOS User Profile" in block
    assert "stephanie@niaxp.com" in block
    assert "Max is Steph's daughter" in block
    assert "698983049660203018" in block


def test_build_web_profile_context_prioritizes_authenticated_profile():
    profile = {
        "userId": "blair-user",
        "email": "blair@example.com",
        "first_name": "Blair",
        "metadata": {"name": "Blair Erickson", "phone": "555-0100"},
        "publicPersona": {
            "displayName": "Blair Erickson",
            "bio": "Founder working on PearlOS.",
            "interests": ["AI", "games"],
            "isPublic": True,
        },
        "privateMemory": {
            "relationshipContext": "Prefers direct, candid replies.",
            "personalNotes": "Current owner of this PearlOS account.",
            "preferences": {"tone": "direct"},
            "sensitiveData": {"secret": "do not include"},
        },
        "sessionHistory": [{"action": "old"}],
    }

    block = profile_actions.build_web_profile_context(
        profile,
        session_user_id="blair-user",
        session_email="blair@example.com",
        session_name="Stephanie",
    )

    assert "Current Authenticated PearlOS User Profile" in block
    assert "First name: Blair" in block
    assert "Full name: Blair Erickson" in block
    assert "Lower-priority session display name: Stephanie" in block
    assert "Prefers direct, candid replies." in block
    assert "Founder working on PearlOS." in block
    assert "sensitiveData" not in block
    assert "do not include" not in block
    assert "sessionHistory" not in block


@pytest.mark.asyncio
async def test_record_discord_profile_touch_merges_memory(monkeypatch):
    requests: list[tuple[str, str, dict | None, dict | None]] = []

    async def fake_get_user_profile(user_id):
        assert user_id == "steph-user"
        return {
            "_id": "profile-id",
            "userId": "steph-user",
            "privateMemory": {
                "preferences": {
                    "existing": True,
                    "discord": {"firstLinkedAt": "2026-01-01T00:00:00.000Z"},
                }
            },
            "sessionHistory": [{"time": "old", "action": "old", "sessionId": "old"}],
        }

    async def fake_request(method, path, params=None, json_body=None):
        requests.append((method, path, params, json_body))
        return {"success": True, "data": json_body["content"]}

    monkeypatch.setattr(profile_actions, "get_user_profile", fake_get_user_profile)
    monkeypatch.setattr(profile_actions.mesh_client, "request", fake_request)

    updated = await profile_actions.record_discord_profile_touch(
        "steph-user",
        discord_user_id="698983049660203018",
        discord_username="immersiveriggs",
        guild_id="guild-1",
        channel_id="channel-1",
        channel_name="general",
        message_preview="hello from Discord",
    )

    assert updated is not None
    method, path, params, body = requests[0]
    assert method == "PATCH"
    assert path == "/content/UserProfile/profile-id"
    assert params == {"tenant": "any"}
    memory = body["content"]["privateMemory"]
    assert memory["preferences"]["existing"] is True
    assert memory["preferences"]["discord"]["firstLinkedAt"] == "2026-01-01T00:00:00.000Z"
    assert memory["preferences"]["discord"]["username"] == "immersiveriggs"
    assert "sessionHistory" not in body["content"]
    assert requests[1][3]["content"]["sessionHistory"][0]["sessionId"] == "discord:guild-1:channel-1"


@pytest.mark.asyncio
async def test_remember_user_profile_fact_appends_personal_note(monkeypatch):
    requests: list[tuple[str, str, dict | None, dict | None]] = []

    async def fake_get_user_profile(user_id):
        assert user_id == "steph-user"
        return {
            "_id": "profile-id",
            "userId": "steph-user",
            "privateMemory": {"personalNotes": "Existing note."},
            "sessionHistory": [],
        }

    async def fake_request(method, path, params=None, json_body=None):
        requests.append((method, path, params, json_body))
        return {"success": True, "data": json_body["content"]}

    monkeypatch.setattr(profile_actions, "get_user_profile", fake_get_user_profile)
    monkeypatch.setattr(profile_actions.mesh_client, "request", fake_request)

    updated = await profile_actions.remember_user_profile_fact(
        "steph-user",
        "Max is Steph's daughter, a human child, not a dog.",
        source="discord",
    )

    assert updated is not None
    body = requests[0][3]
    notes = body["content"]["privateMemory"]["personalNotes"]
    assert "Existing note." in notes
    assert "Max is Steph's daughter" in notes
    assert "sessionHistory" not in body["content"]
