import asyncio

import eventbus as eb
from eventbus import events
import pytest
from pipecat.frames.frames import LLMRunFrame
from handlers import register_default_handlers


class DummyTask:
    def __init__(self):
        self.queued_frames = []

    async def queue_frames(self, frames):
        self.queued_frames.append(frames)
        await asyncio.sleep(0)


class DummyContextFrameSrc:
    def get_context_frame(self):
        return {"type": "context", "data": "frame"}


class DummyContextAgg:
    def user(self):
        return DummyContextFrameSrc()


class DummyTransport:
    async def capture_participant_transcription(self, pid):
        await asyncio.sleep(0)


class DummyFlowManager:
    def __init__(self, task=None):
        self.state = {}
        self.task = task
    
    async def set_node_from_config(self, node_config):
        """Mock method for flow node transitions required by wrapup."""
        await asyncio.sleep(0)


async def _setup(monkeypatch, *, grace=0.05):
    monkeypatch.setenv("BOT_GREETING_GRACE_SECS", str(grace))
    monkeypatch.setenv("BOT_WRAPUP_AFTER_SECS", "0")  # disable wrapup
    monkeypatch.setenv("BOT_EVENT_BUS", "memory")
    # Reduce speak gate so queued LLMRunFrame appears quickly in tests
    monkeypatch.setenv("BOT_SPEAK_GATE_DELAY_SECS", "0.01")
    # Disable user idle gating in tests so LLM runs are scheduled immediately
    monkeypatch.setenv("BOT_BEAT_USER_IDLE_SECS", "0")
    monkeypatch.setenv("BOT_BEAT_USER_IDLE_TIMEOUT_SECS", "0")
    monkeypatch.setenv("BOT_USE_FLOWS", "1")
    message_buffer = []
    task = DummyTask()
    ctx = DummyContextAgg()
    transport = DummyTransport()
    captured = []
    unsub = eb.subscribe("bot.conversation.greeting", lambda t, p: captured.append(p))
    flow_manager = DummyFlowManager(task=task)

    unsub_handlers = register_default_handlers(
        room_url="roomR",
        task=task,
        context_agg=ctx,
        messages=message_buffer,
        transport=transport,
        flow_manager=flow_manager,
    )
    return captured, unsub, unsub_handlers, flow_manager, task

async def _teardown(unsub_list):
    for u in unsub_list:
        try:
            u()
        except Exception:
            pass


@pytest.mark.asyncio
async def test_regreet_single_rejoin(monkeypatch):
    captured, unsub, unsub_handlers, flow_manager, _task = await _setup(monkeypatch)

    # First participant joins -> start grace
    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    # In real flow, bot.py emits JOIN after profile loads. Tests must emit both.
    eb.emit_participant_join("roomR", "p1", name="Alice")
    # Allow a bit more time for node transition + queued LLM run in Flow-only mode
    await asyncio.sleep(0.15)
    assert len(captured) == 1
    assert captured[0]['mode'] == 'single'

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p1'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p1']

    # Participant leaves and rejoins -> should trigger a new greeting window
    eb.emit_participant_left("roomR", "p1")
    await asyncio.sleep(0)
    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == set()
    assert flow_manager.state.get('participants') == []
    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p1", name="Alice")
    await asyncio.sleep(0.07)
    # Expect second single greeting
    assert len(captured) == 2
    assert all(c['mode'] == 'single' for c in captured)

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p1'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p1']

    await _teardown([unsub, unsub_handlers])


@pytest.mark.asyncio
async def test_single_greeting_queues_pipeline_run(monkeypatch):
    captured, unsub, unsub_handlers, _flow_manager, task = await _setup(monkeypatch)

    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p1", name="Alice")
    # Allow time for greeting + node transition
    await asyncio.sleep(0.1)

    assert captured and captured[0]['mode'] == 'single'
    # Flow-only: LLMRunFrame may be queued slightly after; poll briefly to avoid flake
    found = False
    for _ in range(10):
        if any(
            isinstance(frame, LLMRunFrame)
            for batch in task.queued_frames
            for frame in batch
        ):
            found = True
            break
        await asyncio.sleep(0.02)
    assert found, "Expected at least one LLMRunFrame to be queued"

    await _teardown([unsub, unsub_handlers])


@pytest.mark.asyncio
async def test_regreet_pair_separate_windows(monkeypatch):
    captured, unsub, unsub_handlers, flow_manager, _task = await _setup(monkeypatch)

    # Window 1: pair greeting
    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p2", name="Bob")
    await asyncio.sleep(0.02)
    assert len(captured) == 1
    assert captured[0]['mode'] == 'pair'

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p1', 'p2'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p1', 'p2']

    # Both leave -> reset
    eb.emit_participant_left("roomR", "p1")
    eb.emit_participant_left("roomR", "p2")
    await asyncio.sleep(0)
    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == set()
    assert flow_manager.state.get('participants') == []

    # Window 2: another pair greeting with different participant + returning one
    eb.emit_first_participant_join("roomR", "p2", name="Bob")
    eb.emit_participant_join("roomR", "p2", name="Bob")
    eb.emit_participant_join("roomR", "p3", name="Cara")
    await asyncio.sleep(0.02)
    assert len(captured) >= 2
    assert all(c['mode'] == 'pair' for c in captured)

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p2', 'p3'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p2', 'p3']

    await _teardown([unsub, unsub_handlers])


@pytest.mark.asyncio
async def test_identity_updates_flow_state(monkeypatch):
    captured, unsub, unsub_handlers, flow_manager, _task = await _setup(monkeypatch)

    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p1", name="Alice")
    await asyncio.sleep(0.02)

    identity_payload = {
        "room": "roomR",
        "participant": "p1",
        "sessionUserId": "user-123",
        "sessionUserName": "Alice Smith",
        "sessionUserEmail": "alice@example.com",
    }
    eb.publish(events.DAILY_PARTICIPANT_IDENTITY, identity_payload)

    await asyncio.sleep(0.02)

    assert captured == []

    greeting_state = flow_manager.state["greeting_rooms"]["roomR"]
    assert greeting_state["grace_participants"]["p1"] == "Alice Smith"
    assert greeting_state["participant_contexts"]["p1"]["identity"]["sessionUserEmail"] == "alice@example.com"

    flow_entry = flow_manager.state["participant_contexts"]["p1"]
    assert flow_entry["display_name"] == "Alice Smith"
    assert flow_entry["context"]["identity"]["sessionUserName"] == "Alice Smith"

    await _teardown([unsub, unsub_handlers])


@pytest.mark.asyncio
async def test_group_greeting_then_regreet(monkeypatch):
    captured, unsub, unsub_handlers, flow_manager, _task = await _setup(monkeypatch)

    # Group of three triggers immediate group greeting
    eb.emit_first_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p1", name="Alice")
    eb.emit_participant_join("roomR", "p2", name="Bob")
    eb.emit_participant_join("roomR", "p3", name="Cara")
    await asyncio.sleep(0.01)
    assert len(captured) == 1
    assert captured[0]['mode'] == 'group'

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p1', 'p2', 'p3'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p1', 'p2', 'p3']

    # All leave
    eb.emit_participant_left("roomR", "p1")
    eb.emit_participant_left("roomR", "p2")
    eb.emit_participant_left("roomR", "p3")
    await asyncio.sleep(0)
    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == set()
    assert flow_manager.state.get('participants') == []

    # New single window
    eb.emit_first_participant_join("roomR", "p4", name="Dan")
    eb.emit_participant_join("roomR", "p4", name="Dan")
    await asyncio.sleep(0.07)
    assert len(captured) >= 2
    assert captured[1]['mode'] == 'single'

    greeting_state = flow_manager.state['greeting_rooms']['roomR']
    assert greeting_state['participants'] == {'p4'}
    # Note: greeted_ids was removed, we only track greeted_user_ids for actual user_ids
    assert flow_manager.state.get('participants') == ['p4']

    await _teardown([unsub, unsub_handlers])
