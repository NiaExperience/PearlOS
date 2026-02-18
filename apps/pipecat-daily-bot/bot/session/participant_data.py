from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from tools.logging_utils import bind_context_logger

from actions import profile_actions
from core.config import BOT_PID

log = bind_context_logger(tag="[participants]").bind(botPid=BOT_PID)

STEALTH_SESSION_USER_ID = "nia-stealth-user"


def first_token(name: str) -> str:
    try:
        token = name.strip().split()[0]
        return token or name.strip()
    except Exception:
        return name


def is_stealth_participant(pid: str, pname: str | None, pctx: Any = None) -> bool:
    """
    Detect stealth participants using multiple methods:
    1. Username pattern: 'stealth-user' prefix (immediate detection)
    2. Session metadata: stealth flag (requires context)
    3. Session metadata: session_user_id equals the shared stealth sentinel
    """
    # Method 1: Username pattern detection (immediate, no context needed)
    if pname and str(pname).startswith('stealth-user'):
        log.debug('[stealth-detect] %s (%s) is stealth via username pattern' % (pid, pname))
        return True

    # Method 2: Session metadata detection (requires context from bot)
    if pctx and isinstance(pctx, dict):
        session_metadata = pctx.get('session_metadata')
        if session_metadata and isinstance(session_metadata, dict):
            stealth_flag = session_metadata.get('stealth')
            if stealth_flag:
                log.debug(
                    '[stealth-detect] %s (%s) is stealth via metadata flag: %s'
                    % (pid, pname, stealth_flag)
                )
                return True
            session_user_id = session_metadata.get('session_user_id')
            if isinstance(session_user_id, str):
                normalized_id = session_user_id.strip().lower()
                if normalized_id == STEALTH_SESSION_USER_ID:
                    log.debug(
                        '[stealth-detect] %s (%s) is stealth via session_user_id sentinel'
                        % (pid, pname)
                    )
                    return True
    
    return False


def extract_raw_name(obj: Any) -> str | None:
    """Extract a raw name string from common Daily-like participant shapes.

    Prefers obj.info.userName if present, then common flat keys.
    Returns None if no plausible name is found.
    """
    try:
        if not isinstance(obj, dict):
            return None
        info = obj.get("info")
        if isinstance(info, dict):
            nm = info.get("userName") or info.get("username")
            if isinstance(nm, str) and nm.strip():
                return nm.strip()
        for key in ("user_name", "userName", "name", "display_name", "displayName"):
            v = obj.get(key)
            if isinstance(v, str) and v.strip():
                return v.strip()
    except Exception:
        pass
    return None


def derive_name_and_context(
    pid: str | None,
    participant: dict[str, Any] | None,
    meta_lookup: Callable[[str], dict[str, Any] | None] | None = None,
) -> tuple[str | None, dict[str, Any] | None]:
    """Derive (friendly_name, context) from event payload with optional meta lookup.

    - Friendly name is the first token of any discovered name string.
    - Context is a compact dict limited to a stable subset of keys.
    - If participant lacks a name/context, we consult meta_lookup(pid) when provided.
    """
    pname: str | None = None
    pctx: dict[str, Any] | None = None

    try:
        if isinstance(participant, dict):
            info_block = participant.get("info") if isinstance(participant.get("info"), dict) else None
            pname = None
            if info_block:
                pname = (
                    info_block.get("userName")
                    or info_block.get("name")
                    or info_block.get("username")
                )
            
            # Validate pname if found in info_block
            if isinstance(pname, str) and not pname.strip():
                pname = None

            if not pname:
                pname = participant.get("user_name") or participant.get("name")
                # Validate pname if found in participant root
                if isinstance(pname, str) and not pname.strip():
                    pname = None
                
                if not pname:
                    pname = extract_raw_name(participant)

            keys = [k for k in ("user_id", "user_name", "name", "joined_at") if k in participant]
            if keys:
                pctx = {k: participant[k] for k in keys}

        if (not pname or pctx is None) and pid and callable(meta_lookup):
            meta = meta_lookup(pid)
            if isinstance(meta, dict):
                if not pname:
                    pname = meta.get("user_name") or meta.get("name")
                    if isinstance(pname, str) and not pname.strip():
                        pname = None
                    if not pname:
                        pname = extract_raw_name(meta)
                if pctx is None:
                    keys = [k for k in ("user_id", "user_name", "name", "joined_at") if k in meta]
                    if keys:
                        pctx = {k: meta[k] for k in keys}

        if isinstance(pname, str):
            pname = pname.strip()
            if pname:
                pname = first_token(pname)
            else:
                pname = None
    except Exception:
        pass

    return pname, pctx


def _get_user_data(participant: dict[str, Any] | None) -> dict[str, Any] | None:
    """Return Daily userData dict from a participant-like dict or None."""
    if not isinstance(participant, dict):
        return None
    try:
        # Helper to normalize user_data (handle stringified JSON)
        def normalize(ud: Any) -> dict[str, Any] | None:
            if isinstance(ud, dict):
                return ud
            if isinstance(ud, str):
                try:
                    parsed = json.loads(ud)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    pass
            return None

        user_data = normalize(participant.get("userData"))
        if user_data:
            return user_data

        # Try top-level user_data (snake_case)
        user_data = normalize(participant.get("user_data"))
        if user_data:
            return user_data

        info = participant.get("info") if isinstance(participant.get("info"), dict) else None
        if isinstance(info, dict):
            user_data = normalize(info.get("userData"))
            if user_data:
                return user_data
            # Try info.user_data
            user_data = normalize(info.get("user_data"))
            if user_data:
                return user_data
    except Exception:
        pass
    return None


def _parse_user_data(user_data: dict[str, Any]) -> dict[str, Any]:
    """Parse selected metadata from user_data including optional stealth and private flags."""
    md: dict[str, Any] = {}
    try:
        sid = user_data.get("sessionUserId")
        if isinstance(sid, str) and sid.strip():
            md["session_user_id"] = sid.strip()
        sname = user_data.get("sessionUserName")
        if isinstance(sname, str) and sname.strip():
            md["session_user_name"] = sname.strip()
        semail = user_data.get("sessionUserEmail")
        if isinstance(semail, str) and semail.strip():
            md["session_user_email"] = semail.strip()
        tenant_id = user_data.get("tenantId") or user_data.get("tenant_id")
        if isinstance(tenant_id, str) and tenant_id.strip():
            md["tenant_id"] = tenant_id.strip()
        st = user_data.get("stealth")
        if isinstance(st, bool):
            md["stealth"] = bool(st)
        elif isinstance(st, str):
            v = st.strip().lower()
            md["stealth"] = v in ("1", "true", "yes", "on")
        priv = user_data.get("private")
        if isinstance(priv, bool):
            md["private"] = bool(priv)
        elif isinstance(priv, str):
            v = priv.strip().lower()
            md["private"] = v in ("1", "true", "yes", "on")
    except Exception:
        # ignore malformed fields
        pass
    return md


def extract_user_metadata(
    participant: dict[str, Any] | None,
    meta_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    pid: str | None = None
) -> dict[str, Any] | None:
    """Extract user metadata from Daily participant userData field.

    Expected userData structure from interface:
    {
        "sessionUserId": "user123",
        "sessionUserName": "John Doe",
        "sessionUserEmail": "john@example.com",
        "stealth": true,
        "private": true
    }

    Args:
        participant: Participant data from Daily event
        meta_lookup: Optional metadata lookup function to get additional participant data
        pid: Participant ID (required if using meta_lookup)
    """
    try:
        # First try to get userData from the participant event directly
        user_data = _get_user_data(participant)
        if isinstance(user_data, dict):
            md = _parse_user_data(user_data)
            if md:
                return md

        # If no userData found and we have a lookup function, try to get it from metadata
        if meta_lookup and callable(meta_lookup) and pid:
            try:
                meta = meta_lookup(pid)
                if isinstance(meta, dict):
                    user_data = _get_user_data(meta)
                    if isinstance(user_data, dict):
                        md = _parse_user_data(user_data)
                        if md:
                            return md
            except Exception:
                pass

        return None
    except Exception:
        return None


def _filter_profile_data(profile_data: dict[str, Any]) -> dict[str, Any]:
    """Filter profile data to exclude heavy fields like sessionHistory."""
    if not isinstance(profile_data, dict):
        return profile_data
    
    # Create a shallow copy to avoid modifying the original if it's cached
    filtered = profile_data.copy()
    
    allowed_keys = {
        "userId",
        "email",
        "first_name",
        "metadata",
        "lastConversationSummary"
    }
    # only allow the Keys in allowed_keys
    for key in list(filtered.keys()):
        if key not in allowed_keys:
            del filtered[key]
        
    return filtered


async def derive_name_and_context_enhanced(
    pid: str | None,
    participant: dict[str, Any] | None,
    meta_lookup: Callable[[str], dict[str, Any] | None] | None = None,
    enable_profile_loading: bool = True,
) -> tuple[str | None, dict[str, Any] | None]:
    """Enhanced version of derive_name_and_context with user profile loading.

    Extends the base functionality to load user profiles when session.user.id
    is available in the participant metadata, enriching context with profile data.

    Args:
        pid: Participant ID
        participant: Participant data from Daily event
        meta_lookup: Optional metadata lookup function
        enable_profile_loading: Whether to attempt profile loading (default True)

    Returns:
        Tuple of (friendly_name, enhanced_context) with potential profile data
    """
    # Start with base name and context extraction
    pname, pctx = derive_name_and_context(pid, participant, meta_lookup)

    # Extract user metadata for potential profile loading
    user_metadata = extract_user_metadata(participant, meta_lookup, pid)
    log.info("[participants.profile] Extracted user_metadata for pid=%s: %s" % (pid, user_metadata))

    # Always add session metadata to context if available
    if user_metadata:
        if pctx is None:
            pctx = {}
        pctx["session_metadata"] = user_metadata

    # If profile loading is disabled, return base results
    if not enable_profile_loading:
        return pname, pctx

    try:
        if user_metadata and user_metadata.get("session_user_id"):
            session_user_id = user_metadata["session_user_id"]
            session_user_email = user_metadata.get("session_user_email")
            log.info(
                "[participants.profile] Starting profile loading for session_user_id=%s, email=%s"
                % (session_user_id, session_user_email)
            )

            # Import here to avoid circular imports
            from services.user_profile import get_profile_service

            profile_service = get_profile_service()
            # Optional: force a profile reload on join when configured (default true)
            try:
                import os as _os
                reload_on_join = (_os.getenv('BOT_PROFILE_RELOAD_ON_JOIN') or 'true').strip().lower() in ('1','true','yes','on')
            except Exception:
                reload_on_join = True
            log.info(
                "[participants.profile] Profile loading config: reload_on_join=%s, has_reload_method=%s"
                % (reload_on_join, hasattr(profile_service, "reload_user_profile"))
            )

            # Only pass email when available to keep call signature compatible with tests/mocks
            if reload_on_join and hasattr(profile_service, 'reload_user_profile'):
                if session_user_email:
                    profile_data = await profile_service.reload_user_profile(session_user_id, session_user_email)  # type: ignore[attr-defined]
                else:
                    profile_data = await profile_service.reload_user_profile(session_user_id)  # type: ignore[attr-defined]
            else:
                if session_user_email:
                    profile_data = await profile_service.load_user_profile(session_user_id, session_user_email)
                else:
                    profile_data = await profile_service.load_user_profile(session_user_id)

            log.info(
                "[participants.profile] Profile loading result for session_user_id=%s: profile_data=%s"
                % (session_user_id, "loaded" if profile_data else "None")
            )

            if profile_data:
                # Enhance context with profile data
                if pctx is None:
                    pctx = {}

                # Add profile information to context (filtered to remove heavy fields)
                pctx["user_profile"] = _filter_profile_data(profile_data)
                pctx["has_user_profile"] = True

                # PRIORITY: Always prefer user profile first_name over parsed User record name
                # This ensures the DailyCall label uses the profile first name
                profile_first_name = profile_data.get("first_name")
                if profile_first_name and isinstance(profile_first_name, str) and profile_first_name.strip():
                    pname = first_token(profile_first_name.strip())
                    log.info("[participants.profile] Using profile first_name '%s' for pid=%s" % (pname, pid))
                # Fallback to profile 'name' field only if first_name not available and no name found yet
                elif not pname and profile_data.get("name"):
                    profile_name = profile_data["name"]
                    if isinstance(profile_name, str) and profile_name.strip():
                        pname = first_token(profile_name.strip())
                        log.info("[participants.profile] Using profile name '%s' for pid=%s" % (pname, pid))
                elif not pname and profile_data.get("metadata") and isinstance(profile_data.get("metadata"), dict):
                    metadata = profile_data.get("metadata")
                    profile_name = metadata.get("name") or metadata.get("first_name")
                    if isinstance(profile_name, str) and profile_name.strip():
                        pname = first_token(profile_name.strip())
                        log.info("[participants.profile] Using profile name '%s' for pid=%s" % (pname, pid))


        # If we don't have a session user id but we do have an email, try email-only lookup
        elif user_metadata and user_metadata.get("session_user_email"):
            email = user_metadata.get("session_user_email")
            try:
                profile_data = await profile_actions.get_user_profile_by_email(email)
            except Exception:
                profile_data = None
            if profile_data:
                if pctx is None:
                    pctx = {}
                # Add profile information to context (filtered to remove heavy fields)
                pctx["user_profile"] = _filter_profile_data(profile_data)
                pctx["has_user_profile"] = True
                # PRIORITY: Prefer profile first_name over parsed name
                try:
                    profile_first_name = profile_data.get("first_name")
                    if profile_first_name and isinstance(profile_first_name, str) and profile_first_name.strip():
                        pname = first_token(profile_first_name.strip())
                        log.info(
                            "[participants.profile] Using profile first_name '%s' from email lookup for pid=%s"
                            % (pname, pid)
                        )
                    # Fallback to 'name' field only if first_name not available
                    elif not pname and profile_data.get("name"):
                        profile_name = profile_data.get("name")
                        if isinstance(profile_name, str) and profile_name.strip():
                            pname = first_token(profile_name.strip())
                            log.info(
                                "[participants.profile] Using profile name '%s' from email lookup for pid=%s"
                                % (pname, pid)
                            )
                    elif not pname and profile_data.get("metadata") and isinstance(profile_data.get("metadata"), dict):
                        metadata = profile_data.get("metadata")
                        profile_name = metadata.get("name") or metadata.get("first_name")
                        if isinstance(profile_name, str) and profile_name.strip():
                            pname = first_token(profile_name.strip())
                            log.info("[participants.profile] Using profile name '%s' for pid=%s" % (pname, pid))
                except Exception:
                    pass

    except Exception as e:
        # Log profile loading errors but don't fail the whole operation
        try:
            log.warning("[participants.profile] error loading profile for pid=%s: %s" % (pid, e))
        except Exception:
            pass

    return pname, pctx
