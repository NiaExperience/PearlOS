import asyncio
import copy

import eventbus as eb
from handlers import register_default_handlers


class DummyFlowManager:
    def __init__(self) -> None:
        self.state = {}
        self.task = None
    
    async def set_node_from_config(self, node_config):
        """Mock method for flow node transitions required by wrapup."""
        # Store the transition request but don't actually do anything
        await asyncio.sleep(0)


class DummyTask:
    async def queue_frames(self, frames):
        # simulate async frame queuing
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


async def _run_handlers(monkeypatch, grace, wrapup_after):
    monkeypatch.setenv("BOT_GREETING_GRACE_SECS", str(grace))
    monkeypatch.setenv("BOT_WRAPUP_AFTER_SECS", str(wrapup_after))
    monkeypatch.setenv("BOT_EVENT_BUS", "memory")  # ensure in-memory backend
    # Ensure beats scheduling is enabled for pacing plans
    monkeypatch.setenv("BOT_BEAT_REPEAT_INTERVAL_SECS", "0.05")

    messages = []
    task = DummyTask()
    ctx = DummyContextAgg()
    transport = DummyTransport()
    flow_manager = DummyFlowManager()
    flow_manager.task = task
    personality_record = {
        "beats": [
            {"message": "Check in", "start_time": grace / 2},
        ]
    }

    # Capture published events
    captured = []
    unsub_local = eb.subscribe("bot.conversation.greeting", lambda t,p: captured.append((t,p)))
    unsub_wrap = eb.subscribe("bot.conversation.wrapup", lambda t,p: captured.append((t,p)))

    unsub_handlers = register_default_handlers(
        room_url="roomX",
        task=task,
        context_agg=ctx,
        messages=messages,
        transport=transport,
        personality_record=personality_record,
        flow_manager=flow_manager,
    )

    # Emit first join and one extra join shortly after to trigger pair greeting
    eb.emit_first_participant_join("roomX", "p1", name="Alice")
    eb.emit_participant_join("roomX", "p1", name="Alice")
    await asyncio.sleep(grace/2.0)
    eb.emit_participant_join("roomX", "p2", name="Bob")

    # Allow grace window + wrapup to fire
    await asyncio.sleep(max(grace + wrapup_after, 0.2))

    pacing_snapshot = (
        copy.deepcopy(flow_manager.state.get("pacing"))
        if flow_manager.state.get("pacing") is not None
        else None
    )

    unsub_local()
    unsub_wrap()
    unsub_handlers()
    return messages, captured, flow_manager, pacing_snapshot

def test_greeting_grace_and_pacing_and_wrapup(monkeypatch):
    # fast intervals for test
    grace = 0.05
    wrapup_after = 0.12

    messages, events, flow_manager, pacing_snapshot = asyncio.run(
        _run_handlers(monkeypatch, grace, wrapup_after)
    )

    # Expect greeting event
    greeting_events = [e for e in events if e[0] == "bot.conversation.greeting"]
    assert greeting_events, "Expected a greeting semantic event"
    mode = greeting_events[0][1].get("mode")
    # Two participants joined within grace -> pair greeting
    assert mode == "pair", f"Expected pair greeting mode, got {mode}"

    # Wrapup event
    wrapup_events = [e for e in events if e[0] == "bot.conversation.wrapup"]
    assert wrapup_events, "Expected a wrapup event"

    # Messages should include wrapup system directive; greeting content is handled via Flow node
    system_msgs = [m for m in messages if m.get('role') == 'system']
    assert any('wrap-up' in m.get('content','') or 'wrap up' in m.get('content','') for m in system_msgs), "Missing wrapup system message"

    # Flow-only: pacing state recorded
    assert flow_manager is not None
    pacing_state = pacing_snapshot or {}
    wrapup_state = pacing_state.get("wrapup", {})
    assert isinstance(wrapup_state.get("delay"), (int, float))
    beats_state = pacing_state.get("beats", {})
    assert beats_state.get("plans"), "Expected beat plans recorded in Flow state"

