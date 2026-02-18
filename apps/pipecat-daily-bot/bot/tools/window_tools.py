"""Window control tool handlers for LLM.

Provides LLM-callable functions for controlling window positioning and state.
Emits events via AppMessageForwarder that the interface can handle.
"""

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events


DEFAULT_WINDOW_TOOL_PROMPTS: dict[str, str] = {
    'bot_minimize_window': (
        "Minimize the application window to the taskbar or dock."
    ),
    'bot_maximize_window': (
        "Maximize the application window to fill the entire screen."
    ),
    'bot_restore_window': (
        "Restore the window to its default center position and size."
    ),
    'bot_snap_window_left': (
        "Snap the window to the left half of the screen."
    ),
    'bot_snap_window_right': (
        "Snap the window to the right half of the screen."
    ),
    'bot_reset_window_position': (
        "Reset the window to its default center position and size."
    ),
}


# ============================================================================
# Window Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_minimize_window",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_minimize_window"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_minimize_window(params: FunctionCallParams):
    """Minimize the application window."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_minimize_window called")
    
    # Emit window minimize event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_MINIMIZE, {})
        log.info("Emitted window.minimize event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_maximize_window",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_maximize_window"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_maximize_window(params: FunctionCallParams):
    """Maximize the application window."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_maximize_window called")
    
    # Emit window maximize event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_MAXIMIZE, {})
        log.info("Emitted window.maximize event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_restore_window",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_restore_window"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_restore_window(params: FunctionCallParams):
    """Restore the window to previous size."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_restore_window called")
    
    # Emit window restore event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_RESTORE, {})
        log.info("Emitted window.restore event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_snap_window_left",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_snap_window_left"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_snap_window_left(params: FunctionCallParams):
    """Snap window to left half of screen."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_snap_window_left called")
    
    # Emit window snap left event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_SNAP_LEFT, {})
        log.info("Emitted window.snap.left event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_snap_window_right",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_snap_window_right"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_snap_window_right(params: FunctionCallParams):
    """Snap window to right half of screen."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_snap_window_right called")
    
    # Emit window snap right event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_SNAP_RIGHT, {})
        log.info("Emitted window.snap.right event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_reset_window_position",
    description=DEFAULT_WINDOW_TOOL_PROMPTS["bot_reset_window_position"],
    feature_flag="maneuverableWindow",
    parameters={},
    passthrough=True
)
async def bot_reset_window_position(params: FunctionCallParams):
    """Reset window to default center position."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[window_tools]")
    log.info("bot_reset_window_position called")
    
    # Emit window reset event
    if forwarder:
        await forwarder.emit_tool_event(events.WINDOW_RESET, {})
        log.info("Emitted window.reset event")
    
    # Prevent LLM from speaking after tool execution
    await params.result_callback("IN_PROGRESS", properties=FunctionCallResultProperties(run_llm=False))
