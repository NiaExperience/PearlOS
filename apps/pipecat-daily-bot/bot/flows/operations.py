from __future__ import annotations

from typing import Optional, Dict, Any, Mapping
from pipecat_flows import FlowManager
from .messages import (
    _build_role_messages,
    _build_participant_context_message,
    _build_participant_summary_message,
    _build_greeting_policy_message
)
from .utils import _reapply_flow_node_if_active
from .types import WRAPUP_NODE_NAME


def refresh_conversation_role_messages(flow_manager: Optional[FlowManager]) -> None:
    """Rebuild role messages using stored personality prompt and Flow state snapshots."""

    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return

    nodes = flow_state.get("nodes")
    if not isinstance(nodes, dict):
        return

    personality_message = flow_state.get("personality_message")
    personality_dict = personality_message if isinstance(personality_message, dict) else None
    participant_context = _build_participant_context_message(flow_state)
    participant_summary = _build_participant_summary_message(flow_state)
    policy_message = _build_greeting_policy_message(flow_state)
    opening_prompt_value = flow_state.get("opening_prompt")

    conversation_key = flow_state.get("next_node_after_boot", "conversation")
    conversation_node = nodes.get(conversation_key)
    if isinstance(conversation_node, dict):
        role_messages = _build_role_messages(
            personality_dict,
            participant_context,
            participant_summary,
            policy_message,
        )
        # Pre-greeting, include opening prompt in role_messages; after greeting, omit to avoid repeats
        try:
            greeted_any = False
            rooms = flow_state.get("greeting_rooms")
            if isinstance(rooms, dict):
                for state in rooms.values():
                    if isinstance(state, dict):
                        greeted = state.get("greeted_ids", set())
                        if isinstance(greeted, (set, list, tuple)) and len(greeted) > 0:
                            greeted_any = True
                            break
            if not greeted_any:
                greeted_ids = flow_state.get("greeted_ids")
                if isinstance(greeted_ids, (set, list, tuple)) and len(greeted_ids) > 0:
                    greeted_any = True

            if not greeted_any and isinstance(opening_prompt_value, str):
                trimmed_opening = opening_prompt_value.strip()
                if trimmed_opening:
                    role_messages.append({"role": "system", "content": trimmed_opening})
        except Exception:
            if isinstance(opening_prompt_value, str) and opening_prompt_value.strip():
                role_messages.append({"role": "system", "content": opening_prompt_value.strip()})

        if conversation_node.get("role_messages") != role_messages:
            conversation_node["role_messages"] = role_messages
            _reapply_flow_node_if_active(flow_manager, conversation_node)

    boot_node = nodes.get("boot")
    if isinstance(boot_node, dict):
        new_role_messages = _build_role_messages(
            personality_dict,
            participant_context if participant_context else None,
            participant_summary if participant_summary else None,
            policy_message,
        )
        if boot_node.get("role_messages") != new_role_messages:
            boot_node["role_messages"] = new_role_messages
            _reapply_flow_node_if_active(flow_manager, boot_node)

    wrapup_node = nodes.get(WRAPUP_NODE_NAME)
    if isinstance(wrapup_node, dict):
        new_role_messages = _build_role_messages(
            personality_dict,
            participant_context if participant_context else None,
            participant_summary if participant_summary else None,
            policy_message,
        )
        if wrapup_node.get("role_messages") != new_role_messages:
            wrapup_node["role_messages"] = new_role_messages
            _reapply_flow_node_if_active(flow_manager, wrapup_node)

    # Also refresh beat node role messages if present
    try:
        beat_index = flow_state.get("beat_nodes", [])
        if isinstance(beat_index, list):
            for entry in beat_index:
                if not isinstance(entry, dict):
                    continue
                name = entry.get("name")
                if not isinstance(name, str):
                    continue
                node = nodes.get(name)
                if not isinstance(node, dict):
                    continue
                new_role_messages = _build_role_messages(
                    personality_dict,
                    participant_context if participant_context else None,
                    participant_summary if participant_summary else None,
                    policy_message,
                )
                if node.get("role_messages") != new_role_messages:
                    node["role_messages"] = new_role_messages
                    _reapply_flow_node_if_active(flow_manager, node)
    except Exception:
        pass
