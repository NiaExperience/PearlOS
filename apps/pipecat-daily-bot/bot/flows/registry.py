"""Process-local registry for FlowManager instances keyed by room URL.

Allows components (e.g., tool handlers) to look up the FlowManager for a room
without tight coupling to the builder/orchestrator wiring.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from loguru import logger

# In-memory map: room_url -> FlowManager
_flow_managers: Dict[str, Any] = {}


def register_flow_manager(room_url: str, flow_manager: Any) -> None:
    """Register a FlowManager for a room."""
    if not room_url or flow_manager is None:
        return
    _flow_managers[room_url] = flow_manager
    logger.debug(f"[flow-registry] Registered FlowManager for room={room_url}")


def get_flow_manager(room_url: str) -> Optional[Any]:
    """Fetch FlowManager for a room, if present."""
    if not room_url:
        return None
    return _flow_managers.get(room_url)


def unregister_flow_manager(room_url: str) -> None:
    """Remove FlowManager mapping for a room."""
    if not room_url:
        return
    removed = _flow_managers.pop(room_url, None)
    if removed is not None:
        logger.debug(f"[flow-registry] Unregistered FlowManager for room={room_url}")


def clear_flow_managers() -> None:
    """Clear all FlowManager registrations (mainly for tests)."""
    _flow_managers.clear()
    logger.debug("[flow-registry] Cleared all FlowManager registrations")
