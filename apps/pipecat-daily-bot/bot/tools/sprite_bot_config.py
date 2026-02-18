"""Sprite Bot Config runtime helpers.

Provides tool filtering based on the active Sprite's bot configuration.
Bot config is stored per-session (keyed by room_url) to avoid process-global
state clobbering when multiple rooms run concurrently.
"""

from __future__ import annotations

import json
from typing import Any

from loguru import logger

# Per-room bot config store. Keyed by room_url string.
_room_bot_configs: dict[str, str] = {}

# Fallback: current room_url for callers that don't pass one explicitly.
_active_room_url: str | None = None


def set_bot_config(room_url: str, config_json: str) -> None:
    """Store bot config for a specific room."""
    global _active_room_url
    _room_bot_configs[room_url] = config_json
    _active_room_url = room_url


def clear_bot_config(room_url: str) -> None:
    """Remove bot config for a specific room."""
    _room_bot_configs.pop(room_url, None)


def get_active_bot_config(room_url: str | None = None) -> dict[str, Any] | None:
    """Return the active sprite bot config, or None if no sprite bot is active."""
    key = room_url or _active_room_url
    raw = _room_bot_configs.get(key) if key else None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


def get_sprite_tool_whitelist(room_url: str | None = None) -> list[str] | None:
    """Return the tool whitelist from the active sprite bot config.
    
    Returns None if no bot config is active or no tools are specified
    (meaning all tools should be available).
    """
    config = get_active_bot_config(room_url)
    if not config:
        return None
    tools = config.get("tools", [])
    if not tools:
        return None  # Empty whitelist = no filtering
    return tools


def filter_tools_by_sprite_config(
    tools: dict[str, dict[str, Any]],
    room_url: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Filter a tool dict to only include tools whitelisted by the active sprite bot config.
    
    If no sprite bot config is active or no tools are specified, returns all tools.
    Always preserves bot_summon_sprite (sprites should always be able to summon).
    """
    whitelist = get_sprite_tool_whitelist(room_url)
    if whitelist is None:
        return tools
    
    # Always allow these fundamental tools
    always_allowed = {"bot_summon_sprite"}
    allowed = set(whitelist) | always_allowed
    
    filtered = {
        name: meta for name, meta in tools.items()
        if name in allowed
    }
    
    logger.info(
        f"[sprite_bot_config] Filtered tools by sprite whitelist: "
        f"{len(filtered)}/{len(tools)} tools kept "
        f"(whitelist={sorted(whitelist)})"
    )
    
    return filtered


def get_custom_greeting(room_url: str | None = None) -> str | None:
    """Return the custom greeting from the active sprite bot config, if any."""
    config = get_active_bot_config(room_url)
    if not config:
        return None
    greeting = config.get("greeting", "").strip()
    return greeting or None
