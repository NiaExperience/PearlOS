"""Vision tools — allow Pearl to request on-demand vision captures.

These tools let Pearl explicitly "look" at a user through their camera
when the conversation calls for it (e.g., "let me see what you're showing me",
"let me take a look", etc.).

Only registered when BOT_VISION_ENABLED is true.
The tool uses the global vision processor reference set by the pipeline builder.
"""

from __future__ import annotations

import asyncio
from typing import Any

from loguru import logger

from core.config import BOT_PID, BOT_VISION_ENABLED
from tools.decorators import bot_tool


# Global reference to the vision processor — set by the pipeline builder
_vision_processor: Any = None


def set_vision_processor(processor: Any):
    """Set the global vision processor reference for tool access."""
    global _vision_processor
    _vision_processor = processor
    logger.info(f"[{BOT_PID}] [vision-tool] Vision processor reference set: {processor is not None}")


def get_vision_processor() -> Any:
    """Get the global vision processor reference."""
    return _vision_processor


@bot_tool(
    name="bot_look_at_user",
    description=(
        "Look at the user through their camera to see what they look like, "
        "what they're doing, or what they're showing you. Use this when the user "
        "asks you to look at something, describe what you see, or when visual "
        "context would enhance the conversation."
    ),
    feature_flag="vision",
    parameters={
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "Brief reason for looking (e.g., 'user asked me to look at their outfit')",
            },
        },
        "required": [],
    },
)
async def bot_look_at_user_handler(
    function_name: str,
    tool_call_id: str,
    args: dict,
    llm: Any,
    context: Any,
    result_callback: Any,
    **kwargs,
):
    """Handle the bot_look_at_user tool call.
    
    Requests a fresh frame capture from the user's camera, waits for the
    vision LLM analysis to complete, and returns the description.
    """
    reason = args.get("reason", "user request")
    
    if not _vision_processor:
        logger.warning(f"[{BOT_PID}] [vision-tool] No vision processor available")
        await result_callback("Vision is not available right now. I can't see through the camera at the moment.")
        return
    
    # Get the first active participant
    active = list(_vision_processor._active_participants)
    if not active:
        logger.warning(f"[{BOT_PID}] [vision-tool] No active participants to capture")
        await result_callback("I don't see anyone with their camera on right now.")
        return
    
    participant_id = active[0]
    logger.info(f"[{BOT_PID}] [vision-tool] On-demand look at {participant_id}, reason: {reason}")
    
    # Request a frame and wait for the analysis to complete
    try:
        # Snapshot the current description so we know when a new one arrives
        original_desc = _vision_processor._last_description
        
        await _vision_processor.request_frame(participant_id, text=reason)
        
        # Wait for the analysis to be processed (with timeout)
        # The VisionProcessor will inject the result into context automatically
        start_time = asyncio.get_event_loop().time()
        timeout = 15.0
        
        while asyncio.get_event_loop().time() - start_time < timeout:
            await asyncio.sleep(0.5)
            if _vision_processor._last_description != original_desc:
                # New description available
                await result_callback(
                    f"I can see: {_vision_processor._last_description}"
                )
                return
        
        # Timeout — return most recent description if available
        if _vision_processor._last_description:
            await result_callback(
                f"Based on my most recent view: {_vision_processor._last_description}"
            )
        else:
            await result_callback(
                "I'm having trouble seeing the camera right now. The user's camera might be off."
            )
    except Exception as e:
        logger.error(f"[{BOT_PID}] [vision-tool] Error during on-demand capture: {e}")
        await result_callback("Something went wrong while trying to see through the camera.")
