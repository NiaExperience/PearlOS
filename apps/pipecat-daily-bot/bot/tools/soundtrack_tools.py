"""Soundtrack Tool Functions.

Tools for controlling the background soundtrack playback and volume.
These tools emit events that the frontend SoundtrackProvider listens to.
"""

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events


# In-memory soundtrack state updated by frontend via soundtrack.state events
_current_soundtrack_state: dict = {
    "is_playing": False,
    "track_title": None,
    "track_artist": None,
}


def update_soundtrack_state(state: dict) -> None:
    """Update the in-memory soundtrack state from frontend events."""
    global _current_soundtrack_state
    if "is_playing" in state:
        _current_soundtrack_state["is_playing"] = state["is_playing"]
    if "track_title" in state:
        _current_soundtrack_state["track_title"] = state["track_title"]
    if "track_artist" in state:
        _current_soundtrack_state["track_artist"] = state["track_artist"]


# Built-in fallback descriptions
DEFAULT_SOUNDTRACK_TOOL_PROMPTS: dict[str, str] = {
    'bot_play_soundtrack': (
        "Start playing background soundtrack music from the curated collection. "
        "The soundtrack plays ambient/instrumental music that automatically ducks during conversation."
    ),
    'bot_stop_soundtrack': (
        "Stop the background soundtrack completely."
    ),
    'bot_next_soundtrack_track': (
        "Skip to the next track in the soundtrack playlist."
    ),
    'bot_set_soundtrack_volume': (
        "Set the soundtrack volume to a specific level (0.0 to 1.0, where 0.5 = 50%). "
        "This sets the base volume that will be used for normal playback and ducking calculations."
    ),
    'bot_adjust_soundtrack_volume': (
        "Adjust the soundtrack volume relative to current level. "
        "Use 'increase' or 'decrease' direction with 0.15 (15%) step size. "
        "This affects the base volume used for normal playback and ducking."
    ),
    'bot_get_current_soundtrack': (
        "Get information about the currently playing soundtrack track, including "
        "the song title, artist, and whether music is currently playing. "
        "Use this when the user asks what song is playing or about the background music."
    ),
}


# ============================================================================
# Soundtrack Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_play_soundtrack",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_play_soundtrack"],
    feature_flag="soundtrack",
    parameters={},
    passthrough=True
)
async def bot_play_soundtrack(params: FunctionCallParams):
    """Start playing background soundtrack."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[soundtrack_tools]")
    
    try:
        log.info("Starting soundtrack playback")
        
        # Emit soundtrack control event via CustomEvent (frontend handles this)
        # We'll use a custom event name that browser-window can listen to
        if forwarder:
            # Use APP_OPEN to trigger soundtrack, or emit a custom event
            # Since soundtrack doesn't have a dedicated event in events.py yet,
            # we'll emit it as a tool event that browser-window will handle
            await forwarder.emit_tool_event("soundtrack.control", {
                "action": "play"
            })
        
        await params.result_callback({
            "success": True,
            "user_message": "Playing background music."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error starting soundtrack", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to start soundtrack"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_stop_soundtrack",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_stop_soundtrack"],
    feature_flag="soundtrack",
    parameters={},
    passthrough=True
)
async def bot_stop_soundtrack(params: FunctionCallParams):
    """Stop the background soundtrack."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[soundtrack_tools]")
    
    try:
        log.info("Stopping soundtrack playback")
        
        if forwarder:
            await forwarder.emit_tool_event("soundtrack.control", {
                "action": "stop"
            })
        
        await params.result_callback({
            "success": True,
            "user_message": "Stopped background music."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error stopping soundtrack", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to stop soundtrack"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_next_soundtrack_track",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_next_soundtrack_track"],
    feature_flag="soundtrack",
    parameters={},
    passthrough=True
)
async def bot_next_soundtrack_track(params: FunctionCallParams):
    """Skip to the next soundtrack track."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[soundtrack_tools]")
    
    try:
        log.info("Skipping to next soundtrack track")
        
        if forwarder:
            await forwarder.emit_tool_event("soundtrack.control", {
                "action": "next"
            })
        
        await params.result_callback({
            "success": True,
            "user_message": "Skipping to next track."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error skipping track", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to skip track"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_set_soundtrack_volume",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_set_soundtrack_volume"],
    feature_flag="soundtrack",
    parameters={
        "type": "object",
        "properties": {
            "volume": {
                "type": "number",
                "description": "Volume level from 0.0 to 1.0 (e.g., 0.5 = 50%, 0.3 = 30%, 1.0 = 100%)",
                "minimum": 0.0,
                "maximum": 1.0
            }
        },
        "required": ["volume"]
    },
    passthrough=True
)
async def bot_set_soundtrack_volume(params: FunctionCallParams):
    """Set soundtrack volume to a specific level."""
    arguments = params.arguments
    forwarder = params.forwarder
    
    volume = arguments.get("volume")
    log = bind_tool_logger(params, tag="[soundtrack_tools]").bind(volume=volume)
    
    try:
        if volume is None:
            await params.result_callback({
                "success": False,
                "error": "Volume parameter required",
                "user_message": "Volume level is required (0.0 to 1.0)"
            }, properties=FunctionCallResultProperties(run_llm=True))
            return
        
        # Clamp volume to valid range
        volume = max(0.0, min(1.0, float(volume)))
        
        log.info("Setting soundtrack volume")
        
        if forwarder:
            await forwarder.emit_tool_event("soundtrack.control", {
                "action": "volume",
                "volume": volume
            })
        
        volume_percent = int(volume * 100)
        await params.result_callback({
            "success": True,
            "volume": volume,
            "user_message": f"Set soundtrack volume to {volume_percent}%."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error setting volume", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to set soundtrack volume"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_adjust_soundtrack_volume",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_adjust_soundtrack_volume"],
    feature_flag="soundtrack",
    parameters={
        "type": "object",
        "properties": {
            "direction": {
                "type": "string",
                "description": "Direction to adjust volume: 'increase' or 'decrease'",
                "enum": ["increase", "decrease"]
            },
            "step": {
                "type": "number",
                "description": "Step size for adjustment (default 0.15 = 15%)",
                "default": 0.15,
                "minimum": 0.0,
                "maximum": 1.0
            }
        },
        "required": ["direction"]
    },
    passthrough=True
)
async def bot_adjust_soundtrack_volume(params: FunctionCallParams):
    """Adjust soundtrack volume relative to current level."""
    arguments = params.arguments
    forwarder = params.forwarder
    
    direction = arguments.get("direction", "").lower()
    step = arguments.get("step", 0.15)
    log = bind_tool_logger(params, tag="[soundtrack_tools]").bind(direction=direction, step=step)
    
    try:
        if direction not in ["increase", "decrease"]:
            await params.result_callback({
                "success": False,
                "error": "Invalid direction",
                "user_message": "Direction must be 'increase' or 'decrease'"
            }, properties=FunctionCallResultProperties(run_llm=True))
            return
        
        # Clamp step to valid range
        step = max(0.0, min(1.0, float(step)))
        
        log.info("Adjusting soundtrack volume")
        
        if forwarder:
            await forwarder.emit_tool_event("soundtrack.control", {
                "action": "adjustVolume",
                "direction": direction,
                "step": step
            })
        
        direction_text = "increased" if direction == "increase" else "decreased"
        step_percent = int(step * 100)
        await params.result_callback({
            "success": True,
            "direction": direction,
            "step": step,
            "user_message": f"Volume {direction_text} by {step_percent}%."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error adjusting volume", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to adjust soundtrack volume"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_get_current_soundtrack",
    description=DEFAULT_SOUNDTRACK_TOOL_PROMPTS["bot_get_current_soundtrack"],
    feature_flag="soundtrack",
    parameters={},
    passthrough=True
)
async def bot_get_current_soundtrack(params: FunctionCallParams):
    """Get info about the currently playing soundtrack track."""
    log = bind_tool_logger(params, tag="[soundtrack_tools]")

    try:
        state = _current_soundtrack_state.copy()
        log.info("Returning soundtrack state", state=state)

        if state.get("is_playing") and state.get("track_title"):
            await params.result_callback({
                "success": True,
                "is_playing": True,
                "track_title": state["track_title"],
                "track_artist": state.get("track_artist", "Unknown"),
                "user_message": f'Now playing: "{state["track_title"]}" by {state.get("track_artist", "Unknown")}.'
            }, properties=FunctionCallResultProperties(run_llm=True))
        elif state.get("is_playing"):
            await params.result_callback({
                "success": True,
                "is_playing": True,
                "track_title": None,
                "track_artist": None,
                "user_message": "Music is playing but track info is not available yet."
            }, properties=FunctionCallResultProperties(run_llm=True))
        else:
            await params.result_callback({
                "success": True,
                "is_playing": False,
                "track_title": None,
                "track_artist": None,
                "user_message": "No soundtrack is currently playing."
            }, properties=FunctionCallResultProperties(run_llm=True))

    except Exception as e:
        log.error("Error getting soundtrack state", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to get soundtrack info"
        }, properties=FunctionCallResultProperties(run_llm=True))

