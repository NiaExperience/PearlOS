from __future__ import annotations

from typing import Any, Dict, Optional, Mapping, cast, Iterable
from pipecat_flows import FlowManager, ContextStrategy, ContextStrategyConfig
from pipecat_flows.types import NodeConfig, ActionConfig
from .types import DailyBotFlowState, TimerSettings, WRAPUP_NODE_NAME, ADMIN_NODE_NAME
from .nodes import create_conversation_node, create_boot_node, create_wrapup_node, create_beat_node, create_admin_instruction_node
from .utils import _wrapup_prompt_from_personality, _opening_prompt_from_personality, _coerce_start_time, get_pending_admin_instruction, _wrapup_prompt
from .messages import _build_participant_context_message, _build_participant_summary_message, _build_role_messages
from .operations import refresh_conversation_role_messages


async def initialize_base_flow(
    flow_manager: FlowManager,
    *,
    personality_message: Optional[dict[str, Any]] = None,
    timer_settings: Optional[TimerSettings] = None,
    personality_record: Optional[Mapping[str, Any]] = None,
    room: Optional[str] = None,
    is_private_session: bool = False,
) -> DailyBotFlowState:
    """Warm up the FlowManager and persist baseline state for later phases."""

    state = DailyBotFlowState(
        timers=(timer_settings.as_dict() if timer_settings else {}),
    )
    wrapup_prompt_override = _wrapup_prompt_from_personality(personality_record)
    opening_prompt = _opening_prompt_from_personality(personality_record)
    state.wrapup_prompt = wrapup_prompt_override
    state.room = room
    state.admin_state = {"queue": [], "history": [], "task_messages": []}
    state.opening_prompt = opening_prompt
    base_summary_state = {
        "participants": state.participants,
        "participant_contexts": state.participant_contexts,
        "last_joined_participant": state.last_joined_participant,
        "stealth_participants": state.stealth_participants,
    }

    conversation_node = create_conversation_node(
        personality_message=personality_message,
        flow_state=base_summary_state,
        opening_prompt=opening_prompt,
    )
    boot_node = create_boot_node(
        personality_message=personality_message,
        flow_state=base_summary_state,
    )
    wrapup_node = create_wrapup_node(
        personality_message=personality_message,
        flow_state=base_summary_state,
        wrapup_prompt=wrapup_prompt_override,
    )
    state.nodes = {
        "boot": boot_node,
        state.next_node_after_boot: conversation_node,
        WRAPUP_NODE_NAME: wrapup_node,
    }

    # Create nodes per beat (when beats exist) and set the first beat as the next node after boot
    beat_nodes_index: list[Dict[str, Any]] = []
    if isinstance(personality_record, Mapping):
        beats = personality_record.get("beats")
        if isinstance(beats, Iterable):
            beat_list = [beat for beat in beats if isinstance(beat, Mapping)]
            for idx, beat in enumerate(beat_list):
                message = beat.get("message")
                start_time = beat.get("start_time")
                if start_time is None:
                    start_time = beat.get("startTime")
                start_value = _coerce_start_time(start_time)
                if not isinstance(message, str) or not message.strip():
                    continue
                node = create_beat_node(
                    personality_message=personality_message,
                    flow_state=base_summary_state,
                    beat_message=message.strip(),
                )
                # CRITICAL: beat_0 ALWAYS uses APPEND to preserve boot context and tools.
                # For private sessions, ALL beats use APPEND to maintain full context continuity.
                # For non-private sessions, only beat_0 uses APPEND; subsequent beats use RESET_WITH_SUMMARY.
                # This ensures consistent behavior regardless of when the flow is initialized.
                if is_private_session or idx == 0:
                    node["context_strategy"] = ContextStrategyConfig(
                        strategy=ContextStrategy.APPEND
                    )
                node_name = f"beat_{idx}"
                node["name"] = node_name
                state.nodes[node_name] = node
                beat_nodes_index.append(
                    {
                        "name": node_name,
                        "start_time": float(start_value) if start_value is not None else float(idx),
                        "message": message.strip(),
                    }
                )
            if beat_nodes_index:
                # Set first beat as the next node after boot
                state.next_node_after_boot = beat_nodes_index[0]["name"]

    # Persist into the manager's shared state dict but only if empty to avoid clobbering
    flow_state = flow_manager.state
    flow_state.setdefault("timers", state.timers)
    flow_state.setdefault("nodes", state.nodes)
    flow_state.setdefault("next_node_after_boot", state.next_node_after_boot)
    flow_state.setdefault("participants", state.participants)
    flow_state.setdefault("participant_contexts", state.participant_contexts)
    flow_state.setdefault("stealth_participants", state.stealth_participants)
    flow_state.setdefault("last_joined_participant", state.last_joined_participant)
    flow_state.setdefault("greeting_rooms", state.greeting_rooms)
    flow_state.setdefault("is_private_session", is_private_session)
    if beat_nodes_index:
        flow_state.setdefault("beat_nodes", beat_nodes_index)
    if personality_message:
        flow_state.setdefault("personality_message", personality_message)
    if wrapup_prompt_override:
        flow_state.setdefault("wrapup_prompt_override", wrapup_prompt_override)
    if opening_prompt:
        flow_state.setdefault("opening_prompt", opening_prompt)
    if room:
        flow_state.setdefault("room", room)
    flow_state.setdefault("admin", state.admin_state)

    refresh_conversation_role_messages(flow_manager)

    await flow_manager.initialize(initial_node=boot_node)

    return state


async def transition_to_admin_node(flow_manager: Optional[FlowManager]) -> None:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return

    pending_instruction = get_pending_admin_instruction(flow_manager)
    if pending_instruction is None:
        return

    admin_node = create_admin_instruction_node(
        flow_state=flow_state,
        instruction=pending_instruction,
    )

    nodes = flow_state.setdefault("nodes", {})
    nodes[ADMIN_NODE_NAME] = admin_node

    await flow_manager.set_node_from_config(cast(NodeConfig, admin_node))


async def transition_to_wrapup_node(flow_manager: Optional[FlowManager]) -> None:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return

    nodes = flow_state.setdefault("nodes", {})
    personality = flow_state.get("personality_message")
    personality_dict = personality if isinstance(personality, dict) else None
    wrapup_node = nodes.get(WRAPUP_NODE_NAME)
    wrapup_prompt_override = flow_state.get("wrapup_prompt_override")
    if isinstance(wrapup_prompt_override, str):
        wrapup_prompt_override = wrapup_prompt_override.strip() or None
    else:
        wrapup_prompt_override = None

    if not isinstance(wrapup_node, dict):
        wrapup_node = create_wrapup_node(
            personality_message=personality_dict,
            flow_state=flow_state,
            wrapup_prompt=wrapup_prompt_override,
        )
        nodes[WRAPUP_NODE_NAME] = wrapup_node
    else:
        participant_context = _build_participant_context_message(flow_state)
        participant_summary = _build_participant_summary_message(flow_state)
        wrapup_node["role_messages"] = _build_role_messages(
            personality_dict,
            participant_context if participant_context else None,
            participant_summary if participant_summary else None,
        )
        prompt_to_apply = wrapup_prompt_override or _wrapup_prompt()
        task_messages = wrapup_node.get("task_messages")
        if isinstance(task_messages, list) and task_messages:
            first_entry = task_messages[0]
            if isinstance(first_entry, dict):
                first_entry["content"] = prompt_to_apply
            else:
                wrapup_node["task_messages"] = [
                    {"role": "system", "content": prompt_to_apply}
                ]
        else:
            wrapup_node["task_messages"] = [
                {"role": "system", "content": prompt_to_apply}
            ]

    await flow_manager.set_node_from_config(cast(NodeConfig, wrapup_node))
