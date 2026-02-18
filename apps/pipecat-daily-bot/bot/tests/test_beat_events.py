"""Tests for bot conversation pacing beat events."""

import asyncio

from eventbus import bus as eb
from handlers import register_default_handlers
from flows import create_conversation_node


class DummyTask:
    async def queue_frames(self, context):
        await asyncio.sleep(0)


class DummyContextAgg:
    def __init__(self, aggregator=None):
        self._multi_user_agg = aggregator

    def get_context(self):
        return {}


class DummyTransport:
    async def capture_participant_transcription(self, pid):
        await asyncio.sleep(0)


async def _run_handlers_with_beats(
    monkeypatch,
    grace,
    beats,
    *,
    beat_repeat_interval=60.0,
    flow_manager=None,
    multi_user_agg=None,
):
    monkeypatch.setenv("BOT_GREETING_GRACE_SECS", str(grace))
    monkeypatch.setenv("BOT_WRAPUP_AFTER_SECS", "0")  # disable wrapup
    monkeypatch.setenv("BOT_BEAT_REPEAT_INTERVAL_SECS", str(beat_repeat_interval))
    monkeypatch.setenv("BOT_EVENT_BUS", "memory")  # ensure in-memory backend
    monkeypatch.setenv("USE_REDIS", "false")  # ensure Redis is disabled for test isolation
    

    messages = []
    task = DummyTask()
    ctx = DummyContextAgg(aggregator=multi_user_agg)
    transport = DummyTransport()

    # Capture published events
    captured = []
    unsub_greeting = eb.subscribe("bot.conversation.greeting", lambda t, p: captured.append((t, p)))
    unsub_beat = eb.subscribe("bot.conversation.pacing.beat", lambda t, p: captured.append((t, p)))

    # Create personality record with beats
    personality_record = {
        "beats": beats
    }

    # Default a FlowManager if none provided (Flow-only architecture)
    if flow_manager is None:
        class DummyFlowManager:
            def __init__(self):
                self.state = {}
                self.task = task
        flow_manager = DummyFlowManager()

    unsub_handlers = register_default_handlers(
        room_url="test-room",
        task=task,
        context_agg=ctx,
        messages=messages,
        transport=transport,
        personality_record=personality_record,
        flow_manager=flow_manager,
    )

    # Trigger greeting to start beat scheduling
    # First join starts timers, regular join triggers greeting with profile
    eb.emit_first_participant_join("test-room", "p1", name="Alice")
    eb.emit_participant_join("test-room", "p1", name="Alice")

    # Allow grace window to elapse and beats to trigger
    await asyncio.sleep(max(grace * 1.2, 0.2))

    unsub_greeting()
    unsub_beat()
    unsub_handlers()
    return messages, captured


def test_beat_events_scheduling(monkeypatch):
    """Test that beat events are scheduled and triggered correctly."""
    # Ensure Redis is disabled at the module level for test isolation
    monkeypatch.setenv("USE_REDIS", "false")

    grace = 0.05
    beats = [
        {"message": "First beat message", "start_time": 0.02},
        {"message": "Second beat message", "start_time": 0.08},
    ]

    _messages, events = asyncio.run(_run_handlers_with_beats(monkeypatch, grace, beats))

    # Check that greeting event was captured
    greeting_events = [e for e in events if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting event"

    # Check that beat events were captured
    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) == 2, f"Expected 2 beat events, got {len(beat_events)}"

    # Check beat event payloads
    beat_events.sort(key=lambda x: x[1].get('start_time', 0))

    first_beat = beat_events[0][1]
    assert first_beat['message'] == "First beat message"
    assert first_beat['start_time'] == 0.02
    assert first_beat['room'] == "test-room"
    assert first_beat['repeat_count'] == 0  # First emission

    second_beat = beat_events[1][1]
    assert second_beat['message'] == "Second beat message"
    assert second_beat['start_time'] == 0.08
    assert second_beat['room'] == "test-room"
    assert second_beat['repeat_count'] == 0  # First emission


def test_beat_events_with_redis_enabled(monkeypatch):
    """Test that beat events work correctly when Redis is enabled but unavailable (fallback scenario)."""
    # Enable Redis but it won't be available (testing fallback)
    monkeypatch.setenv("USE_REDIS", "true")

    grace = 0.05
    beats = [
        {"message": "Redis test beat", "start_time": 0.03},
    ]

    _messages, events = asyncio.run(_run_handlers_with_beats(monkeypatch, grace, beats))

    # Should still work via file-based fallback
    greeting_events = [e for e in events if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting event even with Redis fallback"

    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) == 1, f"Expected 1 beat event with Redis fallback, got {len(beat_events)}"

    beat = beat_events[0][1]
    assert beat['message'] == "Redis test beat"
    assert beat['start_time'] == 0.03
    assert beat['room'] == "test-room"


def test_beat_events_empty_beats(monkeypatch):
    """Test that empty beats list doesn't cause errors."""
    grace = 0.05
    beats = []

    _messages, events = asyncio.run(_run_handlers_with_beats(monkeypatch, grace, beats))

    # Should still have greeting event
    greeting_events = [e for e in events if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting event"

    # Should have no beat events
    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) == 0, f"Expected 0 beat events, got {len(beat_events)}"


def test_beat_events_invalid_beats(monkeypatch):
    """Test that invalid beat entries are handled gracefully."""
    grace = 0.05
    beats = [
        {"message": "Valid beat", "start_time": 0.02},
        {"message": "", "start_time": 0.05},  # empty message
        {"start_time": 0.08},  # missing message
        {"message": "Negative time", "start_time": -1},  # negative time
        "invalid_beat",  # not a dict
    ]

    _messages, events = asyncio.run(_run_handlers_with_beats(monkeypatch, grace, beats))

    # Should only have one valid beat event
    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) == 1, f"Expected 1 beat event, got {len(beat_events)}"

    # Check the valid beat
    valid_beat = beat_events[0][1]
    assert valid_beat['message'] == "Valid beat"
    assert valid_beat['start_time'] == 0.02


async def _run_handlers_no_personality(monkeypatch, grace):
    """Helper function to run handlers without personality record."""
    monkeypatch.setenv("BOT_GREETING_GRACE_SECS", str(grace))
    monkeypatch.setenv("BOT_WRAPUP_AFTER_SECS", "0")
    monkeypatch.setenv("BOT_EVENT_BUS", "memory")

    messages = []
    task = DummyTask()
    ctx = DummyContextAgg()
    transport = DummyTransport()
    
    class DummyFlowManager:
        def __init__(self, task):
            self.state = {}
            self.task = task

    captured = []
    unsub_greeting = eb.subscribe("bot.conversation.greeting", lambda t, p: captured.append((t, p)))
    unsub_beat = eb.subscribe("bot.conversation.pacing.beat", lambda t, p: captured.append((t, p)))

    # No personality record
    unsub_handlers = register_default_handlers(
        room_url="test-room",
        task=task,
        context_agg=ctx,
        messages=messages,
        transport=transport,
        personality_record=None,
        flow_manager=DummyFlowManager(task),
    )

    # First join starts timers, regular join triggers greeting
    eb.emit_first_participant_join("test-room", "p1", name="Alice")
    eb.emit_participant_join("test-room", "p1", name="Alice")
    await asyncio.sleep(max(grace * 1.2, 0.1))

    unsub_greeting()
    unsub_beat()
    unsub_handlers()
    return messages, captured


def test_beat_events_no_personality_record(monkeypatch):
    """Test that missing personality record doesn't cause errors."""
    grace = 0.05
    _messages, captured = asyncio.run(_run_handlers_no_personality(monkeypatch, grace))

    # Should have greeting but no beats
    greeting_events = [e for e in captured if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting event"

    beat_events = [e for e in captured if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) == 0, f"Expected 0 beat events, got {len(beat_events)}"


def test_beat_events_repeat_behavior(monkeypatch):
    """Test that beats repeat every interval until next beat."""
    grace = 0.05
    beats = [
        {"message": "First beat", "start_time": 0.02},
        {"message": "Second beat", "start_time": 0.12},  # 0.1 seconds after first
    ]

    # Use a short repeat interval for testing
    _messages, events = asyncio.run(
        _run_handlers_with_beats(monkeypatch, grace, beats, beat_repeat_interval=0.03)
    )

    # Check that greeting event was captured
    greeting_events = [e for e in events if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting event"

    # Check that beat events were captured
    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) >= 2, f"Expected at least 2 beat events, got {len(beat_events)}"

    # Check that first beat repeats
    first_beat_events = [e for e in beat_events if e[1]['message'] == "First beat"]
    assert len(first_beat_events) >= 2, f"Expected first beat to repeat, got {len(first_beat_events)} events"

    # Check repeat counts
    first_beat_events.sort(key=lambda x: x[1].get('repeat_count', 0))
    assert first_beat_events[0][1]['repeat_count'] == 0  # First emission
    assert first_beat_events[1][1]['repeat_count'] == 1  # First repeat

    # Check that second beat starts
    second_beat_events = [e for e in beat_events if e[1]['message'] == "Second beat"]
    assert len(second_beat_events) >= 1, f"Expected second beat to start, got {len(second_beat_events)} events"
    assert second_beat_events[0][1]['repeat_count'] == 0  # First emission of second beat


def test_beat_events_single_beat_repeats_forever(monkeypatch):
    """Test that a single beat repeats indefinitely."""
    grace = 0.05
    beats = [
        {"message": "Only beat", "start_time": 0.02},
    ]

    # Use a short repeat interval for testing
    _messages, events = asyncio.run(
        _run_handlers_with_beats(monkeypatch, grace, beats, beat_repeat_interval=0.03)
    )

    # Check that beat events were captured
    beat_events = [e for e in events if e[0] == "bot.conversation.pacing.beat"]
    assert len(beat_events) >= 3, f"Expected multiple beat events, got {len(beat_events)}"

    # Check that all events are from the same beat
    only_beat_events = [e for e in beat_events if e[1]['message'] == "Only beat"]
    assert len(only_beat_events) == len(beat_events), "All events should be from the only beat"

    # Check repeat counts are incrementing
    only_beat_events.sort(key=lambda x: x[1].get('repeat_count', 0))
    for i, event in enumerate(only_beat_events):
        assert event[1]['repeat_count'] == i, f"Expected repeat_count {i}, got {event[1]['repeat_count']}"


class DummyMultiUserAggregator:
    def __init__(self):
        self.calls = 0

    def render_text_summary(self):
        self.calls += 1
        return "Conversation summary"


class DummyBeatFlowManager:
    def __init__(self):
        personality = {"role": "system", "content": "Persona."}
        self.state = {
            "nodes": {
                "conversation": create_conversation_node(personality_message=personality),
            },
            "next_node_after_boot": "conversation",
        }
        self.applied_nodes = []

    async def set_node_from_config(self, node_config):  # noqa: D401 - test stub
        self.applied_nodes.append(node_config)

    async def initialize(self, *_, **__):  # noqa: D401 - test stub
        return None
