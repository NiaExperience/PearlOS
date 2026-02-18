from __future__ import annotations

import asyncio
import time
import uuid
import copy
from typing import Any, Dict, Optional, List, Mapping, cast, Iterable
from pipecat_flows import FlowManager
from pipecat_flows.types import NodeConfig
from pipecat.frames.frames import LLMMessagesAppendFrame
from core.config import BOT_WRAPUP_SYSTEM_MESSAGE

from .types import ADMIN_NODE_NAME, WRAPUP_NODE_NAME, DEFAULT_SUMMARY_PROMPT
from .sanitization import (
    _sanitize_admin_prompt,
    _normalize_admin_mode,
    _sanitize_sender_name,
    _sanitize_sender_id,
    _normalize_timestamp,
    _coerce_start_time
)
from .messages import _format_admin_task_message_content


def _queue_flow_frames(flow_manager: Optional[FlowManager], frames: list[Any]) -> bool:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    task = getattr(flow_manager, "task", None)
    if task is None or not hasattr(task, "queue_frames"):
        return False

    async def _queue() -> None:
        await task.queue_frames(frames)

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        loop.create_task(_queue())
        return True

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_queue())
        return True
    except Exception:
        return False
    finally:
        loop.close()


def _extract_node_name(candidate: Any) -> Optional[str]:
    if isinstance(candidate, str):
        trimmed = candidate.strip()
        return trimmed or None

    if isinstance(candidate, Mapping):
        name = candidate.get("name")
        if isinstance(name, str):
            trimmed = name.strip()
            if trimmed:
                return trimmed

    return None


def _get_active_node_name(flow_manager: Optional[FlowManager]) -> Optional[str]:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    current = getattr(flow_manager, "current_node", None)
    active_name = _extract_node_name(current)
    if active_name:
        return active_name

    flow_state = getattr(flow_manager, "state", None)
    if not isinstance(flow_state, dict):
        return None

    candidate_keys = (
        "active_node",
        "active_node_name",
        "current_node",
        "current_node_name",
        "node",
    )

    for key in candidate_keys:
        candidate = flow_state.get(key)
        name = _extract_node_name(candidate)
        if name:
            return name

    return None


def _reapply_flow_node_if_active(
    flow_manager: Optional[FlowManager],
    node_config: Optional[Dict[str, Any]],
) -> bool:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"
    if not isinstance(node_config, dict):
        return False

    node_name = _extract_node_name(node_config)
    if node_name is None:
        return False

    active_name = _get_active_node_name(flow_manager)
    if active_name != node_name:
        return False

    async def _set_node() -> None:
        await flow_manager.set_node_from_config(cast(NodeConfig, node_config))

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None and loop.is_running():
        loop.create_task(_set_node())
        return True

    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(_set_node())
        return True
    except Exception:
        return False
    finally:
        loop.close()


def append_admin_task_message_to_context(
    flow_manager: Optional[FlowManager],
    task_message: Dict[str, Any] | None,
) -> bool:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    if not isinstance(task_message, dict):
        return False

    frame = LLMMessagesAppendFrame(messages=[task_message])
    return _queue_flow_frames(flow_manager, [frame])


def _ensure_admin_state(flow_state: Dict[str, Any]) -> Dict[str, Any]:
    admin_state = flow_state.setdefault("admin", {})
    admin_state.setdefault("queue", [])
    admin_state.setdefault("history", [])
    admin_state.setdefault("task_messages", [])
    return admin_state


def _append_admin_task_message(flow_state: Dict[str, Any], instruction: Dict[str, Any]) -> None:
    nodes = flow_state.get("nodes")
    if not isinstance(nodes, dict):
        return

    conversation_key = flow_state.get("next_node_after_boot", "conversation")
    conversation_node = nodes.get(conversation_key)
    if not isinstance(conversation_node, dict):
        return

    task_messages = conversation_node.setdefault("task_messages", [])
    task_messages.append(instruction["task_message"])

    admin_state = _ensure_admin_state(flow_state)
    admin_state["task_messages"].append({
        "id": instruction["id"],
        "message": instruction["task_message"],
    })


def _remove_admin_task_message(flow_state: Dict[str, Any], instruction_id: str) -> None:
    admin_state = _ensure_admin_state(flow_state)
    tracked = admin_state.get("task_messages", [])
    message_entry: Optional[Dict[str, Any]] = None
    for index, entry in enumerate(list(tracked)):
        if entry.get("id") == instruction_id:
            message_entry = tracked.pop(index)
            break

    if message_entry is None:
        return

    message = message_entry.get("message")
    if message is None:
        return

    nodes = flow_state.get("nodes")
    if not isinstance(nodes, dict):
        return

    conversation_key = flow_state.get("next_node_after_boot", "conversation")
    conversation_node = nodes.get(conversation_key)
    if not isinstance(conversation_node, dict):
        return

    task_messages = conversation_node.get("task_messages")
    if isinstance(task_messages, list) and message in task_messages:
        task_messages.remove(message)


def enqueue_admin_instruction(
    flow_manager: Optional[FlowManager],
    *,
    prompt: Any,
    sender_id: Any = None,
    sender_name: Any = None,
    mode: Any = None,
    timestamp: Any = None,
) -> Optional[Dict[str, Any]]:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return None

    sanitized_prompt = _sanitize_admin_prompt(prompt)
    if not sanitized_prompt:
        return None

    normalized_mode = _normalize_admin_mode(mode)
    normalized_sender_name = _sanitize_sender_name(sender_name)
    normalized_sender_id = _sanitize_sender_id(sender_id)
    normalized_timestamp = _normalize_timestamp(timestamp)

    admin_state = _ensure_admin_state(flow_state)

    instruction_id = uuid.uuid4().hex
    task_message = {
        "role": "system",
        "content": _format_admin_task_message_content(
            sanitized_prompt,
            normalized_sender_name,
            normalized_mode,
        ),
    }

    instruction: Dict[str, Any] = {
        "id": instruction_id,
        "prompt": sanitized_prompt,
        "mode": normalized_mode,
        "sender": {
            "id": normalized_sender_id,
            "name": normalized_sender_name,
        },
        "timestamp": normalized_timestamp,
        "enqueued_at": time.time(),
        "task_message": task_message,
    }

    admin_state["queue"].append(instruction)
    _append_admin_task_message(flow_state, instruction)

    append_admin_task_message_to_context(flow_manager, instruction.get("task_message"))

    return instruction


def consume_admin_instruction(flow_manager: Optional[FlowManager]) -> Optional[Dict[str, Any]]:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return None

    admin_state = _ensure_admin_state(flow_state)
    queue = admin_state.get("queue", [])
    if not queue:
        return None

    instruction = queue.pop(0)

    _remove_admin_task_message(flow_state, instruction.get("id"))

    history_entry = {
        key: value
        for key, value in instruction.items()
        if key not in {"task_message"}
    }
    admin_state.setdefault("history", []).append(history_entry)

    return instruction


def get_pending_admin_instruction(flow_manager: Optional[FlowManager]) -> Optional[Dict[str, Any]]:
    # Flow-only mode: FlowManager must be present
    assert flow_manager is not None, "FlowManager is required in Flow-only mode"

    flow_state = flow_manager.state
    if not isinstance(flow_state, dict):
        return None

    admin_state = _ensure_admin_state(flow_state)
    queue = admin_state.get("queue")
    if not queue:
        return None

    return copy.deepcopy(queue[0])


def _opening_prompt_from_personality(personality_record: Optional[Mapping[str, Any]]) -> Optional[str]:
    if not isinstance(personality_record, Mapping):
        return None

    beats = personality_record.get("beats")
    if not isinstance(beats, Iterable):
        return None

    for beat in beats:
        if not isinstance(beat, Mapping):
            continue

        start_time = beat.get("start_time")
        if start_time is None:
            start_time = beat.get("startTime")
        start_value = _coerce_start_time(start_time)
        if start_value and start_value != 0:
            continue

        message = beat.get("message")
        if isinstance(message, str):
            trimmed = message.strip()
            if trimmed:
                return trimmed

    return None


def _wrapup_prompt() -> str:
    raw = BOT_WRAPUP_SYSTEM_MESSAGE() or "Offer a warm, concise wrap-up and thank participants for joining."
    if "wrap up" not in raw and "wrap-up" not in raw.lower():
        return raw + " Please wrap up the conversation and thank everyone."
    return raw


def get_default_wrapup_prompt() -> str:
    """Expose the configured wrap-up prompt for callers outside this module."""

    return _wrapup_prompt()


def _wrapup_prompt_from_personality(personality_record: Optional[Mapping[str, Any]]) -> Optional[str]:
    if not isinstance(personality_record, Mapping):
        return None

    beats = personality_record.get("beats")
    if not isinstance(beats, Iterable):
        return None

    beat_entries = [beat for beat in beats if isinstance(beat, Mapping)]
    for beat in reversed(beat_entries):
        message = beat.get("message")
        if isinstance(message, str):
            trimmed = message.strip()
            if trimmed:
                return trimmed

    return None


def get_wrapup_prompt_from_state(flow_state: Mapping[str, Any]) -> str:
    prompt: Optional[str] = None

    override = flow_state.get("wrapup_prompt_override")
    if isinstance(override, str) and override.strip():
        prompt = override.strip()
    else:
        nodes = flow_state.get("nodes")
        if isinstance(nodes, Mapping):
            wrapup_node = nodes.get(WRAPUP_NODE_NAME)
            if isinstance(wrapup_node, Mapping):
                task_messages = wrapup_node.get("task_messages")
                if isinstance(task_messages, list):
                    for entry in task_messages:
                        if not isinstance(entry, Mapping):
                            continue
                        content = entry.get("content")
                        if isinstance(content, str) and content.strip():
                            prompt = content.strip()
                            break

    return prompt or get_default_wrapup_prompt()
