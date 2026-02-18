from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from loguru import logger as base_logger

from actions import personality_actions
from core.config import BOT_PID
from tools import toolbox
from room.state import set_room_tenant_id

@dataclass
class SessionConfig:
    personality_record: dict[str, Any] | None
    preloaded_prompt_payload: dict[str, str] | None
    tenant_id: str | None

async def initialize_session_config(
    room_url: str,
    personality_id: str,
    tenant_id: str | None = None,
) -> SessionConfig:
    """Initialize session configuration, fetching personality and prompts."""
    logger = base_logger.bind(
        roomUrl=room_url,
        sessionId=os.getenv("BOT_SESSION_ID"),
        userId=os.getenv("BOT_SESSION_USER_ID"),
        userName=os.getenv("BOT_SESSION_USER_NAME"),
    )
    
    # Store tenant_id for note operations
    if tenant_id:
        set_room_tenant_id(room_url, tenant_id)
        logger.info(f"[{BOT_PID}] [notes] Set tenant_id for room: {tenant_id}")
    
    # Use pre-fetched personality record from server startup cache (if available)
    personality_record: dict[str, Any] | None = None
    preloaded_personality_json = os.getenv("BOT_PERSONALITY_RECORD")
    if preloaded_personality_json:
        try:
            loaded_record = json.loads(preloaded_personality_json)
            # Check if ID matches requested personality_id
            # If personality_id is not provided, we assume the pre-fetched one is correct (legacy behavior)
            if not personality_id or loaded_record.get('_id') == personality_id:
                personality_record = loaded_record
                logger.info(
                    f"[{BOT_PID}] [personality] Using pre-fetched personality record: {personality_record.get('name')} (id={personality_record.get('_id')})"
                )
            else:
                logger.info(
                    f"[{BOT_PID}] [personality] Pre-fetched personality ({loaded_record.get('_id')}) does not match requested ({personality_id}). Ignoring."
                )
        except Exception as e:
            logger.error(f"[{BOT_PID}] [personality] Failed to parse pre-fetched personality record: {e}")
    
    # Fallback to DB query only if no pre-fetched record available
    if not personality_record and tenant_id and personality_id:
        try:
            personality_record = await personality_actions.get_personality_by_id(tenant_id, personality_id)
            if personality_record:
                logger.warning(
                    f"[{BOT_PID}] [personality] Fetched from DB (fallback): {personality_record.get('name')} - pre-fetch may have failed"
                )
        except Exception as e:
            logger.error(f"[{BOT_PID}] [personality] Failed to get personality from DB fallback: {e}")
    
    if not personality_record:
        if not tenant_id:
            logger.warning(f"[{BOT_PID}] [personality] No tenantId provided; cannot resolve personality")
        elif not personality_id:
            logger.warning(f"[{BOT_PID}] [personality] No personalityId provided; cannot resolve personality")
        else:
            logger.warning(f"[{BOT_PID}] [personality] No personality record available for id={personality_id}")
    
    preloaded_prompt_payload = toolbox.parse_prompt_payload(os.getenv("BOT_FUNCTIONAL_PROMPTS"))
    if preloaded_prompt_payload:
        logger.info(
            f"[{BOT_PID}] [toolbox] Parsed %d preloaded functional prompts from environment" % len(preloaded_prompt_payload),
        )

    return SessionConfig(
        personality_record=personality_record,
        preloaded_prompt_payload=preloaded_prompt_payload,
        tenant_id=tenant_id
    )
