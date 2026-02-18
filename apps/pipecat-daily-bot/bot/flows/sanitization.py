from __future__ import annotations

from typing import Any, Dict, Optional, Set
from core.config import BOT_SANITIZE_FLOW_PROFILE_FIELDS

PROFILE_FIELD_WHITELIST: set[str] = {
    "bio",
    "city",
    "company",
    "country",
    "department",
    "expertise",
    "first_name",
    "full_name",
    "headline",
    "hobbies",
    "interests",
    "job_title",
    "last_name",
    "lastConversationSummary",
    "location",
    "name",
    "organization",
    "preferred_name",
    "pronouns",
    "role",
    "state",
    "summary",
    "team",
    "tenure",
    "time_zone",
    "timezone",
    "title",
}

_EMAIL_KEY_BLOCKLIST: set[str] = {"email", "email_address", "user_email"}


def _sanitize_scalar_mapping(
    data: Optional[Dict[str, Any]],
    *,
    allowed_keys: Optional[set[str]] = None,
    is_private_session: bool = False,
) -> Dict[str, Any]:
    if not isinstance(data, dict):
        return {}

    sanitized: Dict[str, Any] = {}
    for key, value in data.items():
        if allowed_keys is not None and key not in allowed_keys:
            continue
        if isinstance(value, str):
            trimmed = value.strip()
            if not trimmed:
                continue
            sanitized[key] = trimmed
        elif isinstance(value, (int, float, bool)):
            sanitized[key] = value
        elif key == "lastConversationSummary" and isinstance(value, dict) and is_private_session:
            # Only preserve lastConversationSummary in private sessions to avoid sharing conversation history
            sanitized[key] = value
    return sanitized


def _sanitize_context_scalar(value: Any) -> Any:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, (int, float, bool)):
        return value
    return None


def _sanitize_profile_data(profile: Any, is_private_session: bool = False) -> Dict[str, Any]:
    """Extract metadata children, first_name, email, and lastConversationSummary from profile.
    
    Respects BOT_SANITIZE_FLOW_PROFILE_FIELDS to apply whitelist filtering to metadata.
    Always includes first_name and email from top-level profile if present.
    Always excludes sessionHistory and other top-level profile fields.
    """
    if not isinstance(profile, dict):
        return {}

    result: Dict[str, Any] = {}
    
    # Include first_name from top-level profile if present
    first_name = profile.get("first_name")
    if isinstance(first_name, str):
        sanitized_first_name = first_name.strip()
        if sanitized_first_name:
            result["first_name"] = sanitized_first_name
    
    # Include email from top-level profile if present
    email = profile.get("email")
    if isinstance(email, str):
        sanitized_email = email.strip()
        if sanitized_email:
            result["email"] = sanitized_email
    
    # Extract metadata children (respecting whitelist if enabled)
    metadata = profile.get("metadata")
    if isinstance(metadata, dict):
        if BOT_SANITIZE_FLOW_PROFILE_FIELDS():
            # Apply whitelist filtering to metadata children
            sanitized_metadata = _sanitize_scalar_mapping(
                metadata, 
                allowed_keys=PROFILE_FIELD_WHITELIST,
                is_private_session=is_private_session
            )
            if sanitized_metadata:
                result.update(sanitized_metadata)
        else:
            # Include all metadata children (still filtering out emails, but preserve nested objects)
            for key, value in metadata.items():
                if not isinstance(key, str) or key.lower() in _EMAIL_KEY_BLOCKLIST:
                    continue
                # When whitelist is disabled, preserve all values including nested objects
                sanitized = _sanitize_context_scalar(value)
                if sanitized is not None:
                    result[key] = sanitized
                elif isinstance(value, (dict, list)):
                    # Preserve nested structures when not using whitelist
                    result[key] = value
    
    # Include lastConversationSummary only in private sessions
    if is_private_session:
        last_convo = profile.get("lastConversationSummary")
        if isinstance(last_convo, dict):
            result["lastConversationSummary"] = last_convo
    
    return result


def _sanitize_admin_prompt(prompt: Any) -> Optional[str]:
    if not isinstance(prompt, str):
        return None
    trimmed = prompt.strip()
    return trimmed or None


def _normalize_admin_mode(mode: Any) -> str:
    if isinstance(mode, str) and mode.strip().lower() == "immediate":
        return "immediate"
    return "queued"


def _sanitize_sender_name(name: Any) -> Optional[str]:
    if isinstance(name, str):
        trimmed = name.strip()
        return trimmed or None
    return None


def _sanitize_sender_id(value: Any) -> Optional[str]:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return None


def _normalize_timestamp(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _coerce_roster(value: Any) -> list[str]:
    if isinstance(value, list):
        return value
    if isinstance(value, (tuple, set)):
        return list(value)
    return []


def _coerce_context_mapping(value: Any) -> Dict[str, Dict[str, Any]]:
    return value if isinstance(value, dict) else {}


def _normalize_stealth_collection(value: Any) -> set[str]:
    if isinstance(value, set):
        return value
    if isinstance(value, (list, tuple)):
        return set(value)
    if isinstance(value, dict):
        return {pid for pid, is_stealth in value.items() if is_stealth}
    return set()


def _coerce_start_time(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        try:
            return float(trimmed)
        except ValueError:
            return None
    return None


def _normalize_greeting_state(state: Dict[str, Any]) -> Dict[str, Any]:
    participants = state.get("participants")
    if isinstance(participants, set):
        pass
    elif isinstance(participants, (list, tuple)):
        state["participants"] = set(participants)
    else:
        state["participants"] = set()

    grace_participants = state.get("grace_participants")
    if not isinstance(grace_participants, dict):
        state["grace_participants"] = {}

    participant_contexts = state.get("participant_contexts")
    if not isinstance(participant_contexts, dict):
        state["participant_contexts"] = {}

    greeted_ids = state.get("greeted_ids")
    if isinstance(greeted_ids, set):
        pass
    elif isinstance(greeted_ids, (list, tuple)):
        state["greeted_ids"] = set(greeted_ids)
    else:
        state["greeted_ids"] = set()

    # Leave grace_task / pair_task as-is; callers manage asyncio.Task lifecycle.
    state.setdefault("grace_task", None)
    state.setdefault("pair_task", None)

    return state


def _extract_session_metadata(context: Dict[str, Any]) -> Dict[str, Any]:
    metadata: Dict[str, Any] = {}

    session_meta = context.get("session_metadata")
    sanitized_session_meta = _sanitize_scalar_mapping(session_meta)
    metadata.update(sanitized_session_meta)

    session_key_mapping = {
        "sessionUserId": "session_user_id",
        "sessionUserName": "session_user_name",
        "sessionUserEmail": "session_user_email",
    }
    for raw_key, normalized_key in session_key_mapping.items():
        raw_value = sanitized_session_meta.get(raw_key)
        if raw_value is None:
            continue
        metadata.setdefault(normalized_key, raw_value)

    identity_meta = context.get("identity")
    if isinstance(identity_meta, dict):
        mapping = {
            "sessionUserId": "session_user_id",
            "sessionUserName": "session_user_name",
            "sessionUserEmail": "session_user_email",
        }
        for raw_key, normalized in mapping.items():
            raw_value = identity_meta.get(raw_key)
            if isinstance(raw_value, (str, int, float, bool)):
                if isinstance(raw_value, str):
                    trimmed = raw_value.strip()
                    if not trimmed:
                        continue
                    metadata.setdefault(normalized, trimmed)
                else:
                    metadata.setdefault(normalized, raw_value)

    return metadata


def _resolve_display_name(
    entry_display_name: Any,
    session_metadata: Dict[str, Any],
    context_dict: Dict[str, Any],
) -> Optional[str]:
    if isinstance(entry_display_name, str):
        trimmed = entry_display_name.strip()
        if trimmed:
            return trimmed

    for key in ("session_user_name", "sessionUserName"):
        candidate = session_metadata.get(key)
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed:
                return trimmed

    identity = context_dict.get("identity")
    if isinstance(identity, dict):
        candidate = identity.get("displayName")
        if isinstance(candidate, str):
            trimmed = candidate.strip()
            if trimmed:
                return trimmed

    return None
