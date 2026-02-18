"""Onboarding Tool Functions.

Tools for managing the onboarding process.
"""

import json
import os

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from actions import profile_actions
from room.state import get_desktop_mode
from services.redis import RedisClient
from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events

# Built-in fallback descriptions
DEFAULT_ONBOARDING_TOOL_PROMPTS: dict[str, str] = {
    'bot_onboarding_complete': (
        "CRITICAL: Call this tool IMMEDIATELY when the onboarding flow is finished or if the user asks to skip. This is the ONLY way to exit onboarding mode. Do not just say you are done; you MUST call this function."
    ),
}


# ============================================================================
# Onboarding Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_onboarding_complete",
    description=DEFAULT_ONBOARDING_TOOL_PROMPTS["bot_onboarding_complete"],
    feature_flag="onboarding",
    parameters={
        "type": "object",
        "properties": {},
        "required": []
    }
)
async def bot_onboarding_complete(
    params: FunctionCallParams
) -> FunctionCallResultProperties:
    """Signal that onboarding is complete."""
    log = bind_tool_logger(params, tag="[onboarding]")
    log.info("Onboarding complete signal received")
    
    # Extract forwarder from params (injected by toolbox wrapper)
    forwarder = getattr(params, "forwarder", None)
    context = getattr(params, 'handler_context', params.context)
    
    if not forwarder:
        log.error("AppMessageForwarder missing in bot_onboarding_complete params")
        return None

    # Update user profile to mark onboarding as complete
    try:
        # Get user_id from context
        user_id = context.user_id() if context and hasattr(context, 'user_id') else None
        if not user_id:
            user_id = os.environ.get('BOT_SESSION_USER_ID')
        
        if user_id:
            log.bind(userId=user_id).info("Marking onboarding as complete")
            await profile_actions.upsert_user_profile(
                user_id=user_id,
                data={
                    "onboardingComplete": True
                }
            )
        else:
            log.warning("No user_id found in context, cannot persist onboarding status")
            
    except Exception as e:
        log.error("Failed to update onboarding status in DB", exc_info=True)
        # Continue to emit event even if DB update fails, so UI can update

    # Emit event to Interface
    await events.emit_nia_event(
        forwarder,
        "onboarding.complete",
        {}
    )

    # Trigger personality update based on current desktop mode
    # This ensures that if we are in a specific mode (e.g. Work) but were using default personality
    # during onboarding, we now switch to the correct personality for that mode.
    try:
        if hasattr(forwarder, "room_url") and forwarder.room_url:
            room_url = forwarder.room_url
            current_mode = await get_desktop_mode(room_url)
            
            log.bind(mode=current_mode).info("Onboarding complete. Triggering personality update")
            
            # Publish config update to Redis to trigger config_listener
            redis_client = RedisClient()
            client = await redis_client._get_redis()
            channel = f"bot:config:room:{room_url}"
            
            await client.publish(channel, json.dumps({
                "mode": current_mode,
                "source": "onboarding_complete"
            }))
    except Exception as e:
        log.error("Failed to trigger personality update after onboarding", exc_info=True)

    await params.result_callback({
        "success": True,
        "user_message": "Onboarding marked as complete"
    }, properties=FunctionCallResultProperties(run_llm=True))
    return