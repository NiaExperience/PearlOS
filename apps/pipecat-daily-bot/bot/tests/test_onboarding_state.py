from types import SimpleNamespace

import pytest

from core import prompts
from tools import onboarding_tools


class _Context:
    def __init__(self, user_id: str = "user-a"):
        self._user_id = user_id

    def user_id(self):
        return self._user_id


class _Params(SimpleNamespace):
    def __init__(self, *, arguments=None, user_id="user-a", forwarder=None):
        super().__init__(
            arguments=arguments or {},
            context=_Context(user_id),
            handler_context=_Context(user_id),
            forwarder=forwarder,
            results=[],
        )

    async def result_callback(self, payload, properties=None):
        self.results.append((payload, properties))


@pytest.mark.asyncio
async def test_onboarding_prompt_loads_dashboard_functional_prompt(monkeypatch):
    async def fake_fetch(feature_key):
        assert feature_key == "onboarding"
        return "DASHBOARD ONBOARDING PROMPT"

    monkeypatch.setattr(
        "actions.functional_prompt_actions.fetch_functional_prompt",
        fake_fetch,
    )

    note = await prompts.build_onboarding_system_note_async("web chat")

    assert "DASHBOARD ONBOARDING PROMPT" in note
    assert "web chat" in note


@pytest.mark.asyncio
async def test_onboarding_prompt_falls_back_when_dashboard_lookup_fails(monkeypatch):
    async def fail_fetch(_feature_key):
        raise RuntimeError("mesh unavailable")

    monkeypatch.setattr(
        "actions.functional_prompt_actions.fetch_functional_prompt",
        fail_fetch,
    )
    monkeypatch.setenv("PEARL_ONBOARDING_PROMPT", "LOCAL FALLBACK PROMPT")

    prompt = await prompts.load_onboarding_prompt_async()

    assert prompt == "LOCAL FALLBACK PROMPT"


@pytest.mark.asyncio
async def test_onboarding_progress_persists_required_action(monkeypatch):
    calls = []

    async def fake_get_profile(_user_id):
        return {"onboardingState": {"completedBeats": ["beat_1"]}}

    async def fake_upsert(user_id, data):
        calls.append((user_id, data))
        return {"onboardingState": data["onboardingState"]}

    monkeypatch.setattr(onboarding_tools.profile_actions, "get_user_profile", fake_get_profile)
    monkeypatch.setattr(onboarding_tools.profile_actions, "upsert_user_profile", fake_upsert)

    params = _Params(arguments={"currentBeat": 2, "completedBeat": "beat_2", "action": "profileUpdated"})

    await onboarding_tools.bot_onboarding_progress(params)

    assert calls[0][0] == "user-a"
    state = calls[0][1]["onboardingState"]
    assert state["currentBeat"] == 2
    assert state["completedBeats"] == ["beat_1", "beat_2"]
    assert state["requiredActions"]["profileUpdated"] is True
    assert params.results[0][0]["success"] is True


@pytest.mark.asyncio
async def test_onboarding_complete_blocks_missing_required_actions(monkeypatch):
    async def fake_get_profile(_user_id):
        return {"onboardingComplete": False, "onboardingState": {"requiredActions": {"profileUpdated": True}}}

    async def fail_upsert(*_args, **_kwargs):
        raise AssertionError("completion must not persist")

    monkeypatch.setattr(onboarding_tools.profile_actions, "get_user_profile", fake_get_profile)
    monkeypatch.setattr(onboarding_tools.profile_actions, "upsert_user_profile", fail_upsert)

    params = _Params(arguments={"reason": "completed"}, forwarder=SimpleNamespace(room_url="room-a"))

    await onboarding_tools.bot_onboarding_complete(params)

    payload = params.results[0][0]
    assert payload["success"] is False
    assert payload["error"] == "required_actions_missing"
    assert payload["missingActions"] == ["welcomeNoteCreated"]


@pytest.mark.asyncio
async def test_onboarding_complete_allows_explicit_skip(monkeypatch):
    persisted = []
    emitted = []

    async def fake_get_profile(_user_id):
        return {"onboardingComplete": False, "onboardingState": {}}

    async def fake_upsert(user_id, data):
        persisted.append((user_id, data))
        return data

    async def fake_emit(_forwarder, event, payload):
        emitted.append((event, payload))

    async def noop_trigger(_forwarder, _log):
        return None

    monkeypatch.setattr(onboarding_tools.profile_actions, "get_user_profile", fake_get_profile)
    monkeypatch.setattr(onboarding_tools.profile_actions, "upsert_user_profile", fake_upsert)
    monkeypatch.setattr(onboarding_tools.events, "emit_nia_event", fake_emit)
    monkeypatch.setattr(onboarding_tools, "_trigger_personality_update", noop_trigger)

    params = _Params(arguments={"reason": "skip"}, forwarder=SimpleNamespace(room_url="room-a"))

    await onboarding_tools.bot_onboarding_complete(params)

    assert persisted[0][1]["onboardingComplete"] is True
    assert emitted == [("onboarding.complete", {})]
    assert params.results[0][0]["success"] is True


@pytest.mark.asyncio
async def test_onboarding_complete_requires_user_id(monkeypatch):
    async def fail_emit(*_args, **_kwargs):
        raise AssertionError("completion event must not emit without persisted state")

    monkeypatch.delenv("BOT_SESSION_USER_ID", raising=False)
    monkeypatch.setattr(onboarding_tools.events, "emit_nia_event", fail_emit)

    params = _Params(arguments={"reason": "skip"}, user_id="", forwarder=SimpleNamespace(room_url="room-a"))

    await onboarding_tools.bot_onboarding_complete(params)

    payload = params.results[0][0]
    assert payload["success"] is False
    assert payload["error"] == "user_id_required"


@pytest.mark.asyncio
async def test_onboarding_complete_does_not_emit_when_persist_fails(monkeypatch):
    async def fake_get_profile(_user_id):
        return {
            "onboardingComplete": False,
            "onboardingState": {
                "requiredActions": {
                    "profileUpdated": True,
                    "welcomeNoteCreated": True,
                }
            },
        }

    async def fail_upsert(*_args, **_kwargs):
        raise RuntimeError("db down")

    async def fail_emit(*_args, **_kwargs):
        raise AssertionError("completion event must not emit when persistence fails")

    monkeypatch.setattr(onboarding_tools.profile_actions, "get_user_profile", fake_get_profile)
    monkeypatch.setattr(onboarding_tools.profile_actions, "upsert_user_profile", fail_upsert)
    monkeypatch.setattr(onboarding_tools.events, "emit_nia_event", fail_emit)

    params = _Params(arguments={"reason": "completed"}, forwarder=SimpleNamespace(room_url="room-a"))

    await onboarding_tools.bot_onboarding_complete(params)

    payload = params.results[0][0]
    assert payload["success"] is False
    assert payload["error"] == "persist_failed"
