import asyncio
from typing import Any, Dict, List

import pytest

from eventbus import events
from flows import FlowPacingController


class DummyFlowManager:
    def __init__(self) -> None:
        self.state: Dict[str, Any] = {}


@pytest.mark.asyncio
async def test_wrapup_schedule_updates_state_and_emits():
    flow_manager = DummyFlowManager()
    published: List[tuple[str, Dict[str, Any]]] = []
    wrapup_callbacks: List[str] = []

    flow_manager.state["wrapup_prompt_override"] = "  Farewell, folks!  "

    def publish(topic: str, payload: Dict[str, Any]) -> None:
        published.append((topic, payload))

    controller = FlowPacingController(flow_manager=flow_manager, publish=publish, room="room-w")

    async def _on_wrapup() -> None:
        wrapup_callbacks.append("called")

    controller.schedule_wrapup(delay=0.01, on_wrapup=_on_wrapup)
    await asyncio.sleep(0.03)

    pacing_state = flow_manager.state.get("pacing", {})
    wrapup_state = pacing_state.get("wrapup", {})
    assert wrapup_state.get("active") is False
    assert wrapup_state.get("delay") == pytest.approx(0.01, rel=0.1)
    assert wrapup_state.get("has_callback") is True
    assert wrapup_state.get("prompt") == "Farewell, folks!"
    assert wrapup_callbacks, "Expected wrapup callback to execute"
    assert published and published[0][0] == events.BOT_CONVO_WRAPUP
    assert published[0][1]["room"] == "room-w"
    assert published[0][1]["wrapup_prompt"] == "Farewell, folks!"
    controller.cancel_all()


@pytest.mark.asyncio
async def test_wrapup_prompt_uses_wrapup_node_when_override_missing():
    flow_manager = DummyFlowManager()
    flow_manager.state["nodes"] = {
        "wrapup": {
            "task_messages": [{"role": "system", "content": "Custom closing statement."}],
        }
    }
    published: List[tuple[str, Dict[str, Any]]] = []

    def publish(topic: str, payload: Dict[str, Any]) -> None:
        published.append((topic, payload))

    controller = FlowPacingController(flow_manager=flow_manager, publish=publish, room="room-x")

    controller.schedule_wrapup(delay=0.01)
    await asyncio.sleep(0.03)

    pacing_state = flow_manager.state.get("pacing", {})
    wrapup_state = pacing_state.get("wrapup", {})
    assert wrapup_state.get("prompt") == "Custom closing statement."
    assert published and published[0][1]["wrapup_prompt"] == "Custom closing statement."
    controller.cancel_all()


@pytest.mark.asyncio
async def test_beat_schedule_emits_and_tracks_state():
    flow_manager = DummyFlowManager()
    published: List[tuple[str, Dict[str, Any]]] = []

    def publish(topic: str, payload: Dict[str, Any]) -> None:
        published.append((topic, payload))

    controller = FlowPacingController(flow_manager=flow_manager, publish=publish, room="room-b")

    personality = {
        "beats": [
            {"message": "Check-in", "start_time": 0.01},
            {"message": "Shareupdate", "start_time": 0.03},
        ]
    }

    controller.schedule_beats(personality_record=personality, repeat_interval=0.02)
    await asyncio.sleep(0.08)

    beat_events = [entry for entry in published if entry[0] == events.BOT_CONVO_PACING_BEAT]
    assert beat_events, "Expected pacing beat events"
    pacing_state = flow_manager.state.get("pacing", {})
    beats_state = pacing_state.get("beats", {})
    assert beats_state.get("repeat_interval") == pytest.approx(0.02, rel=0.1)
    plans = beats_state.get("plans", [])
    assert len(plans) == 2
    assert plans[0]["message"] == "Check-in"
    controller.cancel_all()


