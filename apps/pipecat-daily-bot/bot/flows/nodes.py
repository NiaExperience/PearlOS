from __future__ import annotations

import copy
from typing import Any, Dict, Optional, Mapping, cast
from pipecat_flows import FlowManager, ContextStrategy, ContextStrategyConfig
from pipecat_flows.types import NodeConfig, ActionConfig
from eventbus import publish, events

from .types import DEFAULT_SUMMARY_PROMPT, WRAPUP_NODE_NAME, ADMIN_NODE_NAME
from .messages import (
    _build_participant_context_message,
    _build_participant_summary_message,
    _build_greeting_policy_message,
    _build_role_messages
)
from .utils import (
    _wrapup_prompt,
    consume_admin_instruction,
    get_pending_admin_instruction,
    get_wrapup_prompt_from_state
)


def create_boot_node(
    *,
    personality_message: Optional[dict[str, Any]] = None,
    flow_state: Optional[Dict[str, Any]] = None,
) -> NodeConfig:
    """Initial node that defers speaking until the conversation loop begins."""

    task_messages = [
        {
            "role": "system",
            "content": (
                "You are preparing to host a conversation. \n"
                "You are ready to speak as soon as participants are present."
            ),
        }
    ]

    state_snapshot = flow_state or {}
    participant_context = _build_participant_context_message(state_snapshot)
    participant_summary = _build_participant_summary_message(state_snapshot)
    policy_message = _build_greeting_policy_message(state_snapshot)
    role_messages = _build_role_messages(
        personality_message, participant_context, participant_summary, policy_message
    )

    return cast(
        NodeConfig,
        {
            "name": "boot",
            "role_messages": role_messages,
            "task_messages": task_messages,
            "respond_immediately": False,
            "context_strategy": ContextStrategyConfig(strategy=ContextStrategy.APPEND),
        },
    )


def create_conversation_node(
    *,
    personality_message: Optional[dict[str, Any]] = None,
    flow_state: Optional[Dict[str, Any]] = None,
    opening_prompt: Optional[str] = None,
    context_strategy: Optional[ContextStrategyConfig] = None,
) -> NodeConfig:
    """Baseline conversation node that preserves future compatibility."""

    task_messages: list[Dict[str, Any]] = []

    task_messages.append(
        {
            "role": "system",
            "content": (
                "Engage participants naturally, following existing personality guidance."
            ),
        }
    )

    state_snapshot = flow_state or {}
    participant_context = _build_participant_context_message(state_snapshot)
    participant_summary = _build_participant_summary_message(state_snapshot)
    policy_message = _build_greeting_policy_message(state_snapshot)
    role_messages = _build_role_messages(
        personality_message, participant_context, participant_summary, policy_message
    )

    # Include opening guidance in task messages (not role) to avoid re-greet conflicts
    # Only add opening prompt if no one has been greeted yet (first interaction)
    # Append to task_messages to keep it ephemeral rather than persistent in role_messages
    try:
        greeted_any = False
        rooms = state_snapshot.get("greeting_rooms")
        if isinstance(rooms, dict):
            for state in rooms.values():
                if isinstance(state, dict):
                    greeted = state.get("greeted_ids", set())
                    if isinstance(greeted, (set, list, tuple)) and len(greeted) > 0:
                        greeted_any = True
                        break
        if not greeted_any:
            greeted_ids = state_snapshot.get("greeted_ids")
            if isinstance(greeted_ids, (set, list, tuple)) and len(greeted_ids) > 0:
                greeted_any = True

        if not greeted_any and isinstance(opening_prompt, str):
            trimmed_opening = opening_prompt.strip()
            if trimmed_opening:
                # Append to task_messages (ephemeral) not role_messages (persistent)
                task_messages.append({"role": "system", "content": trimmed_opening})
    except Exception:
        if isinstance(opening_prompt, str) and opening_prompt.strip():
            # Fallback: still add to task_messages, not role_messages
            task_messages.append({"role": "system", "content": opening_prompt.strip()})
    if context_strategy is None:
        context_strategy = ContextStrategyConfig(
            strategy=ContextStrategy.RESET_WITH_SUMMARY,
            summary_prompt=DEFAULT_SUMMARY_PROMPT,
        ) 
    return cast(
        NodeConfig,
        {
            "name": "conversation",
            "role_messages": role_messages,
            "task_messages": task_messages,
            "respond_immediately": True,
            "context_strategy": context_strategy,
        },
    )


def create_beat_node(
    *,
    personality_message: Optional[dict[str, Any]] = None,
    flow_state: Optional[Dict[str, Any]] = None,
    beat_message: str,
) -> NodeConfig:
    """Create a node that represents a single beat with RESET_WITH_SUMMARY strategy."""

    task_messages: list[Dict[str, Any]] = [
        {
            "role": "system",
            "content": beat_message.strip(),
        },
        {
            "role": "system",
            "content": (
                "Engage participants naturally, following existing personality guidance."
            ),
        },
    ]

    state_snapshot = flow_state or {}
    participant_context = _build_participant_context_message(state_snapshot)
    participant_summary = _build_participant_summary_message(state_snapshot)
    policy_message = _build_greeting_policy_message(state_snapshot)
    role_messages = _build_role_messages(
        personality_message, participant_context, participant_summary, policy_message
    )

    return cast(
        NodeConfig,
        {
            "name": "beat",
            "role_messages": role_messages,
            "task_messages": task_messages,
            "respond_immediately": False,
            "context_strategy": ContextStrategyConfig(
                strategy=ContextStrategy.RESET_WITH_SUMMARY,
                summary_prompt=DEFAULT_SUMMARY_PROMPT,
            ),
        },
    )


async def _admin_instruction_post_action(action: Dict[str, Any], flow_manager: FlowManager) -> None:
    del action

    # Flow-only mode guarantees FlowManager

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return

    nodes = flow_state.setdefault("nodes", {})
    consumed_instruction = consume_admin_instruction(flow_manager)
    if consumed_instruction is None:
        return

    pending_instruction = get_pending_admin_instruction(flow_manager)
    if pending_instruction is not None:
        admin_node = create_admin_instruction_node(
            flow_state=flow_state,
            instruction=pending_instruction,
        )
        nodes[ADMIN_NODE_NAME] = admin_node
        await flow_manager.set_node_from_config(cast(NodeConfig, admin_node))
        return

    nodes.pop(ADMIN_NODE_NAME, None)

    conversation_key = flow_state.get("next_node_after_boot", "conversation")
    conversation_node = nodes.get(conversation_key)
    if isinstance(conversation_node, dict):
        await flow_manager.set_node_from_config(cast(NodeConfig, conversation_node))


def create_admin_instruction_node(
    *,
    flow_state: Dict[str, Any],
    instruction: Optional[Dict[str, Any]] = None,
) -> NodeConfig:
    personality = flow_state.get("personality_message")
    personality_dict = personality if isinstance(personality, dict) else None
    opening_prompt_value = flow_state.get("opening_prompt")
    opening_prompt = None
    # Suppress opening prompt if participants have already been greeted
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
            stripped = opening_prompt_value.strip()
            if stripped:
                opening_prompt = stripped
    except Exception:
        if isinstance(opening_prompt_value, str):
            stripped = opening_prompt_value.strip()
            if stripped:
                opening_prompt = stripped

    base_node = create_conversation_node(
        personality_message=personality_dict,
        flow_state=flow_state,
        opening_prompt=opening_prompt,
        context_strategy=ContextStrategyConfig(strategy=ContextStrategy.APPEND)
    )

    role_messages = copy.deepcopy(base_node.get("role_messages", []))
    base_task_messages = base_node.get("task_messages")
    task_messages = (
        copy.deepcopy(base_task_messages)
        if isinstance(base_task_messages, list)
        else []
    )

    if instruction is not None:
        task_message = instruction.get("task_message")
        if isinstance(task_message, dict) and task_message not in task_messages:
            task_messages.append(copy.deepcopy(task_message))

    return cast(
        NodeConfig,
        {
            "name": ADMIN_NODE_NAME,
            "role_messages": role_messages,
            "task_messages": task_messages,
            "respond_immediately": True,  # Admin messages should be spoken immediately
            "context_strategy": ContextStrategyConfig(strategy=ContextStrategy.APPEND),
            "post_actions": [
                ActionConfig(
                    type="admin_instruction_consumed",
                    handler=_admin_instruction_post_action,
                )
            ],
        },
    )


async def _wrapup_post_action(action: Dict[str, Any], flow_manager: FlowManager) -> None:
    del action  # Reserved for future action-specific parameters

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return

    pacing_state = flow_state.setdefault("pacing", {})
    wrapup_state = pacing_state.setdefault("wrapup", {})

    if wrapup_state.get("published"):
        return

    prompt = get_wrapup_prompt_from_state(flow_state)
    payload: Dict[str, Any] = {
        "wrapup_prompt": prompt,
    }

    delay = wrapup_state.get("delay")
    after_secs: Optional[float] = None
    if isinstance(delay, (int, float)) and delay >= 0:
        after_secs = float(delay)
    elif isinstance(flow_state.get("timers"), dict):
        timer_delay = flow_state["timers"].get("wrapup_after_secs")
        if isinstance(timer_delay, (int, float)) and timer_delay >= 0:
            after_secs = float(timer_delay)

    if after_secs is not None:
        payload["after_secs"] = after_secs

    room = flow_state.get("room")
    if isinstance(room, str) and room:
        payload["room"] = room

    publish(events.BOT_CONVO_WRAPUP, payload)

    wrapup_state["published"] = True
    wrapup_state["active"] = False


def create_wrapup_node(
    *,
    personality_message: Optional[dict[str, Any]] = None,
    flow_state: Optional[Dict[str, Any]] = None,
    wrapup_prompt: Optional[str] = None,
) -> NodeConfig:
    state_snapshot = flow_state or {}
    participant_context = _build_participant_context_message(state_snapshot)
    participant_summary = _build_participant_summary_message(state_snapshot)
    policy_message = _build_greeting_policy_message(state_snapshot)
    role_messages = _build_role_messages(
        personality_message, participant_context, participant_summary, policy_message
    )
    prompt = wrapup_prompt.strip() if isinstance(wrapup_prompt, str) else None
    if not prompt:
        prompt = _wrapup_prompt()
    task_messages = [
        {
            "role": "system",
            "content": prompt,
        }
    ]

    return cast(
        NodeConfig,
        {
            "name": WRAPUP_NODE_NAME,
            "role_messages": role_messages,
            "task_messages": task_messages,
            "respond_immediately": True,
            "context_strategy": ContextStrategyConfig(
                strategy=ContextStrategy.RESET_WITH_SUMMARY,
                summary_prompt=DEFAULT_SUMMARY_PROMPT,
            ),
            "post_actions": [
                ActionConfig(
                    type="wrapup_event",
                    handler=_wrapup_post_action,
                )
            ],
        },
    )
