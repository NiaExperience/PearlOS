"""Sprite summon tool to trigger the interface-side sprite workflow."""

import os

try:
    import aiohttp
except ImportError:
    aiohttp = None  # type: ignore

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events


@bot_tool(
    name="bot_summon_sprite",
    description=(
        "Summon a visual AI sprite character from a user-provided description (e.g., 'panda doctor', 'indian driver'). "
        "Use when the user asks for a character/persona so the sprite can appear and chat."
    ),
    feature_flag="summonSpriteTool",
    parameters={
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Character description for the sprite (e.g., 'panda doctor')",
            }
        },
        "required": ["prompt"],
    },
    passthrough=False,
)
async def bot_summon_sprite(params: FunctionCallParams):
    """Emit an event to summon a sprite on the frontend."""
    log = bind_tool_logger(params, tag="[bot_summon_sprite]")
    arguments = params.arguments
    forwarder = params.forwarder

    prompt = (arguments.get("prompt") or "").strip()
    log.info("bot_summon_sprite invoked", prompt=prompt or None)

    if not prompt:
        log.warning("Prompt missing for bot_summon_sprite")
        await params.result_callback(
            {"success": False, "error": "Prompt is required to summon a sprite."},
            properties=FunctionCallResultProperties(run_llm=False),
        )
        return

    # Emit a tool event so the frontend can call /api/summon-ai-sprite and show the widget.
    event_emitted = False
    if forwarder:
        try:
            log.info("Emitting sprite summon event", prompt=prompt)
            await forwarder.emit_tool_event(events.SPRITE_SUMMON, {"prompt": prompt})
            log.info("Sprite summon event emitted", prompt=prompt)
            event_emitted = True
        except Exception as e:  # pragma: no cover - defensive
            log.warning("Failed to emit sprite summon event", error=str(e), prompt=prompt)

    # Fallback: direct API call if event emission fails
    if not event_emitted:
        log.warning("Event emission failed, attempting direct API call fallback", prompt=prompt)
        
        if aiohttp is None:
            log.error("aiohttp not available, cannot make fallback API call", prompt=prompt)
        else:
            try:
                # Get interface base URL from environment or use localhost default
                interface_base_url = (
                    os.getenv("INTERFACE_BASE_URL") 
                    or os.getenv("NEXT_PUBLIC_INTERFACE_BASE_URL")
                    or "http://localhost:3000"
                ).rstrip("/")
                
                api_url = f"{interface_base_url}/api/summon-ai-sprite"
                log.info("Making fallback API call to summon sprite", url=api_url, prompt=prompt)
                
                async with aiohttp.ClientSession() as session:
                    async with session.post(
                        api_url,
                        json={"prompt": prompt},
                        headers={"Content-Type": "application/json"},
                        timeout=aiohttp.ClientTimeout(total=300),  # 5 min for full ComfyUI workflow
                    ) as response:
                        if response.status >= 200 and response.status < 300:
                            log.info("Fallback API call succeeded", status=response.status, prompt=prompt)
                        else:
                            response_text = await response.text()
                            log.warning(
                                "Fallback API call returned error status",
                                status=response.status,
                                response=response_text[:200],
                                prompt=prompt,
                            )
            except Exception as e:
                log.error("Fallback API call failed", error=str(e), prompt=prompt, exc_info=True)

    await params.result_callback(
        {
            "success": True,
            "user_message": f"Inform the user that you are summoning the sprite for: {prompt}",
        },
        properties=FunctionCallResultProperties(run_llm=False),
    )


