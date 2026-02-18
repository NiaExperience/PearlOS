"""Personality content management business logic.

Provides helpers for listing and fetching Personality content items from the
Mesh content API. These helpers wrap ``mesh_client.request`` so callers do not
need to issue raw HTTP requests.

Also supports Sprite content type for personality switching with voice configuration.
"""

from __future__ import annotations

import json
import os
import sys
from typing import Optional

from loguru import logger

# Ensure mesh_client can be imported when executing within actions package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import mesh as mesh_client
from services.mesh import MeshClientError


async def list_personalities(limit: int = 50) -> list[dict]:
    """Return Personality content items for a tenant."""
    where = {}
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": str(limit),
    }

    response = await mesh_client.request("GET", "/content/Personality", params=params)

    if not response.get("success"):
        raise MeshClientError(response.get("error") or "Failed to list personalities")

    data = response.get("data")
    if isinstance(data, list):
        logger.debug(
            f"[personality_actions] Listed {len(data)} personalities"
        )
        return data

    logger.warning(
        f"[personality_actions] Unexpected payload when listing personalities: {data}"
    )
    return []


async def get_personality_by_name(tenant_id: str, name: str) -> Optional[dict]:
    """Fetch a single Personality by name within a tenant."""
    where = {
        "parent_id": {"eq": tenant_id},
        "indexer": {"path": "name", "equals": name},
    }
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/Personality", params=params)

    if not response.get("success"):
        raise MeshClientError(response.get("error") or "Failed to fetch personality by name")

    data = response.get("data")
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data

    logger.debug(
        f"[personality_actions] Personality named {name} not found for tenant {tenant_id}"
    )
    return None


async def get_personality_by_id(tenant_id: str, personality_id: str) -> Optional[dict]:
    """Fetch a single Personality by page_id (personalityId is unique system-wide)."""
    where = {"page_id": {"eq": personality_id}}
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/Personality", params=params)

    if not response.get("success"):
        raise MeshClientError(response.get("error") or "Failed to fetch personality by id")

    data = response.get("data")
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data

    logger.debug(
        f"[personality_actions] Personality {personality_id} not found"
    )
    return None


async def get_sprite_by_id(sprite_id: str) -> Optional[dict]:
    """Fetch a single Sprite by page_id.
    
    Returns Sprite record with voice configuration for personality switching.
    """
    where = {"page_id": {"eq": sprite_id}}
    params = {
        "where": json.dumps(where, separators=(",", ":")),
        "limit": "1",
    }

    response = await mesh_client.request("GET", "/content/Sprite", params=params)

    if not response.get("success"):
        # Sprite content type may not exist yet - graceful fallback
        error = response.get("error", "")
        if "not found" in str(error).lower():
            logger.debug(f"[personality_actions] Sprite content type not available")
            return None
        raise MeshClientError(response.get("error") or "Failed to fetch sprite by id")

    data = response.get("data")
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict) and data:
        return data

    logger.debug(f"[personality_actions] Sprite {sprite_id} not found")
    return None


async def resolve_personality(tenant_id: str, personality_id: str) -> Optional[dict]:
    """Resolve personality from either Personality or Sprite content type.
    
    Tries Personality first, then falls back to Sprite.
    Returns a normalized dict with at least 'primaryPrompt' and optionally voice config.
    """
    # Try Personality first
    personality = await get_personality_by_id(tenant_id, personality_id)
    if personality:
        logger.debug(f"[personality_actions] Resolved as Personality: {personality_id}")
        return personality
    
    # Try Sprite
    sprite = await get_sprite_by_id(personality_id)
    if sprite:
        logger.debug(f"[personality_actions] Resolved as Sprite: {personality_id}")
        
        # Generate primaryPrompt from originalRequest if missing (backfill for old sprites)
        primary_prompt = sprite.get("primaryPrompt")
        if not primary_prompt:
            original_request = sprite.get("originalRequest") or sprite.get("description") or sprite.get("name")
            if original_request:
                # Generate a personality prompt from the original request
                primary_prompt = _generate_sprite_personality_prompt(original_request, sprite.get("name"))
                logger.info(f"[personality_actions] Generated primaryPrompt for sprite {personality_id} from originalRequest")
        
        # Return Sprite with voice config for config_listener to use
        return {
            "type": "Sprite",
            "primaryPrompt": primary_prompt,
            "voiceProvider": sprite.get("voiceProvider"),
            "voiceId": sprite.get("voiceId"),
            "voiceParameters": sprite.get("voiceParameters"),
            "botConfig": sprite.get("botConfig"),
            "name": sprite.get("name"),
            "_id": sprite.get("_id") or sprite.get("page_id"),
        }
    
    logger.warning(f"[personality_actions] Could not resolve personality: {personality_id}")
    return None


def _generate_sprite_personality_prompt(original_request: str, name: Optional[str] = None) -> str:
    """Generate a personality prompt for a sprite from its original request.
    
    This provides a backfill for old sprites that don't have a primaryPrompt.
    Mirrors the TypeScript generateSpritePersonalityPrompt() in summon-ai-sprite/route.ts.
    """
    return f"""You are a pixel sprite character brought to life by the user's imagination.

Character description: {original_request}

Guidelines:
- Stay fully in character based on your description
- Be playful, creative, and engaging
- Keep responses conversational and concise (1-3 sentences for voice)
- React with personality appropriate to your character
- If you're a doctor, speak with medical authority; if a wizard, speak with mystical flair; etc.
- Never break character or mention being an AI"""


__all__ = [
    "list_personalities",
    "get_personality_by_name",
    "get_personality_by_id",
    "get_sprite_by_id",
    "resolve_personality",
]
