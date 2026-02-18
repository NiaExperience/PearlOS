from __future__ import annotations

from typing import Any, Dict, Optional, List, Set, Tuple
from pipecat_flows import FlowManager
from .sanitization import _coerce_roster, _coerce_context_mapping, _normalize_stealth_collection, _normalize_greeting_state
from .operations import refresh_conversation_role_messages


def _ensure_participant_state_collections(
    flow_state: Dict[str, Any]
) -> tuple[list[str], Dict[str, Dict[str, Any]], set[str]]:
    """Guarantee participant tracking containers exist with consistent types."""

    roster = _coerce_roster(flow_state.get("participants"))
    flow_state["participants"] = roster

    contexts = _coerce_context_mapping(flow_state.get("participant_contexts"))
    flow_state["participant_contexts"] = contexts

    stealth = _normalize_stealth_collection(flow_state.get("stealth_participants"))
    flow_state["stealth_participants"] = stealth

    flow_state.setdefault("last_joined_participant", None)

    return roster, contexts, stealth


def record_participant_join(
    flow_manager: Optional[FlowManager],
    participant_id: Optional[str],
    display_name: Optional[str],
    context: Optional[Dict[str, Any]],
    *,
    stealth: bool = False,
) -> None:
    """Persist participant metadata in Flow state for Flow-driven behaviors."""

    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"
    if not participant_id:
        return

    flow_state = flow_manager.state
    roster, contexts, stealth_set = _ensure_participant_state_collections(flow_state)

    contexts[participant_id] = {
        "display_name": display_name,
        "context": context,
        "stealth": stealth,
    }

    if stealth:
        stealth_set.add(participant_id)
        if participant_id in roster:
            roster.remove(participant_id)
    else:
        stealth_set.discard(participant_id)
        if participant_id in roster:
            roster.remove(participant_id)
        roster.append(participant_id)

    flow_state["last_joined_participant"] = participant_id

    try:
        refresh_conversation_role_messages(flow_manager)
    except Exception:
        pass


def record_participant_leave(
    flow_manager: Optional[FlowManager],
    participant_id: Optional[str],
) -> None:
    """Remove participant metadata from Flow state when they depart."""

    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"
    if not participant_id:
        return

    flow_state = flow_manager.state
    roster, contexts, stealth_set = _ensure_participant_state_collections(flow_state)

    if participant_id in roster:
        roster.remove(participant_id)
    contexts.pop(participant_id, None)
    stealth_set.discard(participant_id)

    if flow_state.get("last_joined_participant") == participant_id:
        flow_state["last_joined_participant"] = None

    try:
        refresh_conversation_role_messages(flow_manager)
    except Exception:
        pass


def get_participant_snapshot(
    flow_manager: Optional[FlowManager],
) -> Dict[str, Any]:
    """Return a copy of Flow-managed participant state for diagnostics/tests."""

    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    roster, contexts, stealth_set = _ensure_participant_state_collections(flow_state)
    return {
        "participants": list(roster),
        "participant_contexts": dict(contexts),
        "stealth_participants": set(stealth_set),
        "last_joined_participant": flow_state.get("last_joined_participant"),
    }


def _default_greeting_state() -> Dict[str, Any]:
    return {
        "participants": set(),
        "grace_participants": {},
        "participant_contexts": {},
        "grace_task": None,
        "pair_task": None,
        "greeted_user_ids": set(),  # Track by stable user_id, not volatile participant_id
        "flow_initialized_private": False,
        "greeting_speech_started": False,  # True only after TTS actually starts speaking the greeting
    }


def reset_flow_greeting_state(flow_manager: FlowManager, room: str) -> Dict[str, Any]:
    """Reset and return the Flow-managed greeting state for a room."""

    rooms = flow_manager.state.setdefault("greeting_rooms", {})
    rooms[room] = _default_greeting_state()
    return rooms[room]


def get_flow_greeting_state(flow_manager: FlowManager, room: str) -> Dict[str, Any]:
    """Fetch the Flow-managed greeting state for a room, normalizing structures."""

    rooms = flow_manager.state.setdefault("greeting_rooms", {})
    state = rooms.get(room)
    if state is None:
        state = _default_greeting_state()
        rooms[room] = state
    return _normalize_greeting_state(state)
