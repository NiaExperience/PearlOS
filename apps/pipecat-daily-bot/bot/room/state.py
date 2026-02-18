import os
import json
from typing import Any, Dict
from loguru import logger
from core.config import BOT_PID
from services.redis import RedisClient

# Global forwarder registry (room_url → AppMessageForwarder instance)
_room_forwarders: Dict[str, Any] = {}

# Tenant tracking (process-local)
_room_tenants: Dict[str, str] = {}  # room_url → tenant_id

# Local fallback for active note/applet state when Redis is disabled/unavailable
_local_active_notes: Dict[str, Dict[str, str]] = {}
_local_active_applets: Dict[str, Dict[str, str]] = {}

# Redis client
_redis = RedisClient()


def _room_logger(room_url: str):
    session_id = os.getenv("BOT_SESSION_ID")
    user_id = os.getenv("BOT_SESSION_USER_ID")
    user_name = os.getenv("BOT_SESSION_USER_NAME")
    return logger.bind(roomUrl=room_url, sessionId=session_id, userId=user_id, userName=user_name)


def get_forwarder(room_url: str) -> Any | None:
    """Get the AppMessageForwarder instance for a room."""
    return _room_forwarders.get(room_url)


def set_forwarder(room_url: str, forwarder: Any) -> None:
    """Set the AppMessageForwarder instance for a room."""
    _room_forwarders[room_url] = forwarder


def remove_forwarder(room_url: str) -> None:
    """Remove the AppMessageForwarder instance for a room."""
    _room_forwarders.pop(room_url, None)


async def get_active_note_id(room_url: str) -> str | None:
    """Get the active note ID for a room from Redis, falling back to in-memory."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        data = await client.get(f"room:{room_url}:active_note")
        if data:
            return json.loads(data).get("note_id")
    except Exception as e:
        log.debug(f"[{BOT_PID}] [state] Redis unavailable for active note ({e}); using local fallback")
    # Always check local fallback when Redis fails or returns nothing
    fallback = _local_active_notes.get(room_url)
    if fallback:
        return fallback.get("note_id")
    return None


async def get_active_note_owner(room_url: str) -> str | None:
    """Get the participant ID of who opened the active note, falling back to in-memory."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        data = await client.get(f"room:{room_url}:active_note")
        if data:
            return json.loads(data).get("owner")
    except Exception as e:
        log.debug(f"[{BOT_PID}] [state] Redis unavailable for note owner ({e}); using local fallback")
    # Always check local fallback when Redis fails or returns nothing
    fallback = _local_active_notes.get(room_url)
    if fallback:
        return fallback.get("owner")
    return None


async def set_active_note_id(room_url: str, note_id: str | None, owner: str | None = None) -> None:
    """Set or clear the active note ID for a room in Redis.
    
    Args:
        room_url: The room URL
        note_id: The note ID to set, or None to clear
        owner: The participant ID who is opening the note (required when setting)
    """
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        key = f"room:{room_url}:active_note"
        if note_id is None:
            await client.delete(key)
            log.info(f"[{BOT_PID}] [state] Cleared active note for room: {room_url}")
        else:
            await client.set(key, json.dumps({
                'note_id': note_id,
                'owner': owner or 'unknown'
            }))
            # Set expiry to 24 hours to prevent stale state
            await client.expire(key, 86400)
            log.info(f"[{BOT_PID}] [state] Set active note for room {room_url}: {note_id} (owner: {owner})")
    except Exception as e:
        log.error(f"[{BOT_PID}] [state] Failed to set active note for {room_url}: {e}")
        # Fallback to in-memory storage so tests and local runs without Redis still work
        if note_id is None:
            _local_active_notes.pop(room_url, None)
        else:
            _local_active_notes[room_url] = {
                "note_id": note_id,
                "owner": owner or "unknown"
            }


async def get_active_applet_id(room_url: str) -> str | None:
    """Get the active applet ID for a room, falling back to in-memory."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        data = await client.get(f"room:{room_url}:active_applet")
        if data:
            return json.loads(data).get("applet_id")
    except Exception as e:
        log.debug(f"[{BOT_PID}] [state] Redis unavailable for active applet ({e}); using local fallback")
    fallback = _local_active_applets.get(room_url)
    if fallback:
        return fallback.get("applet_id")
    return None


async def get_active_applet_owner(room_url: str) -> str | None:
    """Get the participant ID of who opened the active applet, falling back to in-memory."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        data = await client.get(f"room:{room_url}:active_applet")
        if data:
            return json.loads(data).get("owner")
    except Exception as e:
        log.debug(f"[{BOT_PID}] [state] Redis unavailable for applet owner ({e}); using local fallback")
    fallback = _local_active_applets.get(room_url)
    if fallback:
        return fallback.get("owner")
    return None


async def set_active_applet_id(room_url: str, applet_id: str | None, owner: str | None = None) -> None:
    """Set or clear the active applet ID for a room in Redis.
    
    Args:
        room_url: The room URL
        applet_id: The applet ID to set, or None to clear
        owner: The participant ID who is opening the applet (required when setting)
    """
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        key = f"room:{room_url}:active_applet"
        if applet_id is None:
            await client.delete(key)
            log.info(f"[{BOT_PID}] [state] Cleared active applet for room: {room_url}")
        else:
            await client.set(key, json.dumps({
                'applet_id': applet_id,
                'owner': owner or 'unknown'
            }))
            # Set expiry to 24 hours to prevent stale state
            await client.expire(key, 86400)
            log.info(f"[{BOT_PID}] [state] Set active applet for room {room_url}: {applet_id} (owner: {owner})")
    except Exception as e:
        log.error(f"[{BOT_PID}] [state] Failed to set active applet for {room_url}: {e}")
        # Fallback to in-memory storage
        if applet_id is None:
            _local_active_applets.pop(room_url, None)
        else:
            _local_active_applets[room_url] = {
                "applet_id": applet_id,
                "owner": owner or "unknown"
            }


async def get_desktop_mode(room_url: str) -> str:
    """Get the current desktop mode for a room from Redis. Defaults to 'home'."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        data = await client.get(f"room:{room_url}:desktop_mode")
        if data:
            return data
    except Exception as e:
        log.error(f"[{BOT_PID}] [state] Failed to get desktop mode for {room_url}: {e}")
    return "home"


async def set_desktop_mode(room_url: str, mode: str) -> None:
    """Set the current desktop mode for a room in Redis."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        key = f"room:{room_url}:desktop_mode"
        await client.set(key, mode)
        # Set expiry to 24 hours
        await client.expire(key, 86400)
        log.info(f"[{BOT_PID}] [state] Set desktop mode for room {room_url}: {mode}")
    except Exception as e:
        log.error(f"[{BOT_PID}] [state] Failed to set desktop mode for {room_url}: {e}")


async def clear_room_state(room_url: str) -> None:
    """Clear all active state for a room in Redis."""
    log = _room_logger(room_url)
    try:
        client = await _redis._get_redis()
        await client.delete(f"room:{room_url}:active_note")
        await client.delete(f"room:{room_url}:active_applet")
        await client.delete(f"room:{room_url}:desktop_mode")
        log.info(f"[{BOT_PID}] [state] Cleared all active state for room: {room_url}")
    except Exception as e:
        log.error(f"[{BOT_PID}] [state] Failed to clear room state for {room_url}: {e}")


def get_room_tenant_id(room_url: str) -> str | None:
    """Get the tenant ID for a room."""
    log = _room_logger(room_url)
    if os.getenv('DEBUG_BOT'):
        log.debug(f"[{BOT_PID}] [state] get_room_tenant_id called with room_url={room_url}")
        log.debug(f"[{BOT_PID}] [state] _room_tenants dict id: {id(_room_tenants)}")
        log.debug(f"[{BOT_PID}] [state] _room_tenants contents: {_room_tenants}")
    result = _room_tenants.get(room_url)
    if not result:
        log.warning(f"[{BOT_PID}] [state] [notes] No tenant_id found for room {room_url}. Available rooms: {list(_room_tenants.keys())}")
    elif os.getenv('DEBUG_BOT'):
        log.debug(f"[{BOT_PID}] [state] Found tenant_id: {result}")
    return result


def set_room_tenant_id(room_url: str, tenant_id: str) -> None:
    """Set the tenant ID for a room."""
    log = _room_logger(room_url)
    if os.getenv('DEBUG_BOT'):
        log.debug(f"[{BOT_PID}] [state] set_room_tenant_id called with room_url={room_url}, tenant_id={tenant_id}")
        log.debug(f"[{BOT_PID}] [state] _room_tenants dict id BEFORE: {id(_room_tenants)}")
        log.debug(f"[{BOT_PID}] [state] _room_tenants contents BEFORE: {_room_tenants}")
    _room_tenants[room_url] = tenant_id
    if os.getenv('DEBUG_BOT'):
        log.debug(f"[{BOT_PID}] [state] _room_tenants contents AFTER: {_room_tenants}")
    log.info(f"[{BOT_PID}] [state] Set tenant for room {room_url}: {tenant_id}")


def get_current_room_url() -> str | None:
    """Get the current room URL.
    
    Useful for single-room bot instances where we need to recover context.
    Returns the first room URL found in the state, or None.
    """
    if _room_tenants:
        return next(iter(_room_tenants))
    if _room_forwarders:
        return next(iter(_room_forwarders))
    return None

def cleanup_room_state(room_url: str) -> None:
    """Clean up all state for a room."""
    _room_forwarders.pop(room_url, None)
    _room_tenants.pop(room_url, None)
    _local_active_notes.pop(room_url, None)
    _local_active_applets.pop(room_url, None)
    log = _room_logger(room_url)
    log.info(f"[{BOT_PID}] [state] Cleaned up state for room: {room_url}")
