from __future__ import annotations

import json
from typing import Any, Dict, Optional, Mapping
from core.config import BOT_PARTICIPANT_REFRESH_MESSAGE, BOT_PROFILE_INSTRUCTION_MESSAGE
from .sanitization import (
    _sanitize_profile_data,
    _sanitize_context_scalar,
    _resolve_display_name,
    _extract_session_metadata,
)


def _build_role_messages(
    personality_message: Optional[dict[str, Any]] = None,
    participant_context_message: Optional[dict[str, Any]] = None,
    participant_summary: Optional[dict[str, Any]] = None,
    policy_message: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    if personality_message and isinstance(personality_message, dict):
        messages.append(personality_message)
    if participant_context_message and isinstance(participant_context_message, dict):
        messages.append(participant_context_message)
    if participant_summary and isinstance(participant_summary, dict):
        messages.append(participant_summary)
    if policy_message and isinstance(policy_message, dict):
        messages.append(policy_message)
    return messages


def _format_admin_task_message_content(prompt: str, sender_name: Optional[str], mode: str) -> str:
    mode_label = "IMMEDIATE" if mode == "immediate" else "QUEUED"
    sender_suffix = f" from {sender_name}" if sender_name else ""
    return (
        f"ADMIN INSTRUCTION [{mode_label}{sender_suffix}]: {prompt}\n\n"
        "Respond to this instruction right away and keep the assistant tone natural. "
        "Do not mention that the guidance originated from an admin."
    )


def _summarize_single_participant(
    participant_id: str,
    entry: Optional[Dict[str, Any]],
    is_private_session: bool = False,
) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict) or entry.get("stealth"):
        return None

    summary: Dict[str, Any] = {"participant_id": participant_id}

    context_obj = entry.get("context")
    context_dict = context_obj if isinstance(context_obj, dict) else {}

    session_metadata = _extract_session_metadata(context_dict)
    if session_metadata:
        summary["session"] = session_metadata

    normalized_display_name = _resolve_display_name(entry.get("display_name"), session_metadata, context_dict)
    if normalized_display_name:
        summary["display_name"] = normalized_display_name

    profile_source = context_dict.get("user_profile")
    if profile_source is None:
        profile_source = context_dict.get("profile_data")
    profile_data = _sanitize_profile_data(profile_source, is_private_session=is_private_session)
    if profile_data:
        summary["profile"] = profile_data

    has_profile = context_dict.get("has_user_profile")
    if isinstance(has_profile, bool):
        summary["has_user_profile"] = has_profile

    return summary if len(summary) > 1 else None


def _build_participant_summary_message(flow_state: Dict[str, Any]) -> Optional[dict[str, Any]]:
    participants = flow_state.get("participants")
    contexts = flow_state.get("participant_contexts")
    if not isinstance(participants, list) or not isinstance(contexts, dict):
        return None

    is_private_session = flow_state.get("is_private_session", False)
    summaries = [
        summary
        for participant_id in participants
        if (summary := _summarize_single_participant(participant_id, contexts.get(participant_id), is_private_session))
    ]

    if not summaries:
        return None

    most_recent = flow_state.get("last_joined_participant")
    content_parts = [
        "Participant roster snapshot (non-stealth participants only):",
        json.dumps(summaries, indent=2, sort_keys=True),
    ]
    if isinstance(most_recent, str) and most_recent.strip():
        content_parts.append(f"Most recent arrival: {most_recent.strip()}")

    return {
        "role": "system",
        "content": "\n".join(content_parts),
    }


def _build_greeting_policy_message(flow_state: Dict[str, Any]) -> Optional[dict[str, Any]]:
    """If participants have already been greeted, emit a policy to avoid re-greeting.

    This lightweight guard helps clamp repeated greetings when nodes transition or
    summaries reset the context. It does not replace the runtime greeting window
    logic in handlers; it augments model guidance.
    """
    try:
        rooms = flow_state.get("greeting_rooms")
        if isinstance(rooms, dict):
            # If any room has greeted participants, discourage re-greeting.
            for state in rooms.values():
                if isinstance(state, dict):
                    greeted = state.get("greeted_ids", set())
                    if isinstance(greeted, (set, list, tuple)) and len(greeted) > 0:
                        return {
                            "role": "system",
                            "content": (
                                "Policy: Participants who have already been greeted should not be greeted again. "
                                "Acknowledge concisely when appropriate and continue the conversation without repeating welcome lines like "
                                "'So great to see you here', 'It’s great having you here', 'What a pleasure to have you here tonight', "
                                "or 'It’s fantastic to have you here with me'."
                            ),
                        }
        # Fallback: check flat greeted_ids when greeting_rooms unavailable
        greeted_ids = flow_state.get("greeted_ids")
        if isinstance(greeted_ids, (set, list, tuple)) and len(greeted_ids) > 0:
            return {
                "role": "system",
                "content": (
                    "Policy: Participants who have already been greeted should not be greeted again. "
                    "Avoid repeating welcome lines and proceed with normal facilitation."
                ),
            }
    except Exception:
        pass
    return None


def _build_participant_context_entry(
    participant_id: str,
    entry: Optional[Dict[str, Any]],
    is_private_session: bool = False,
) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict) or entry.get("stealth"):
        return None

    context_obj = entry.get("context")
    context_dict = context_obj if isinstance(context_obj, dict) else {}

    session_metadata = _extract_session_metadata(context_dict)
    display_name = _resolve_display_name(entry.get("display_name"), session_metadata, context_dict)
    username = display_name or participant_id
    
    # Keep "anonymous" users unnamed — let the LLM greet naturally without a label
    if isinstance(username, str) and username.lower() == "anonymous":
        username = "there"

    payload: Dict[str, Any] = {"username": username}

    user_profile = context_dict.get("user_profile")
    if user_profile is None:
        user_profile = context_dict.get("profile_data")

    if isinstance(user_profile, Mapping):
        profile_name = user_profile.get("name")
        sanitized_name = _sanitize_context_scalar(profile_name)
        if isinstance(sanitized_name, str) and sanitized_name != username:
            payload["profile_name"] = sanitized_name

        # Use unified sanitization: metadata children + lastConversationSummary only
        sanitized_profile = _sanitize_profile_data(user_profile, is_private_session=is_private_session)
        payload.update(sanitized_profile)

    if len(payload) == 1 and not isinstance(user_profile, dict) and not session_metadata:
        payload["info"] = "Basic participant info only"

    return payload


def _build_participant_context_message(flow_state: Dict[str, Any]) -> Optional[dict[str, Any]]:
    participants = flow_state.get("participants")
    contexts = flow_state.get("participant_contexts")
    if not isinstance(participants, list) or not isinstance(contexts, dict):
        return None

    is_private_session = flow_state.get("is_private_session", False)
    context_entries = [
        entry
        for participant_id in participants
        if (entry := _build_participant_context_entry(participant_id, contexts.get(participant_id), is_private_session))
    ]

    if not context_entries:
        return None

    refresh_marker = BOT_PARTICIPANT_REFRESH_MESSAGE()
    instruction = BOT_PROFILE_INSTRUCTION_MESSAGE()
    content_parts = [
        refresh_marker,
        json.dumps(context_entries, indent=2, sort_keys=True),
    ]

    if isinstance(instruction, str) and instruction.strip():
        content_parts.append("")
        content_parts.append(instruction.strip())

    return {
        "role": "system",
        "content": "\n".join(content_parts).rstrip(),
    }
