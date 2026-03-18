"""View-control tools for notes: scroll, highlight, navigate headings."""
from __future__ import annotations

from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger, bind_context_logger

from .prompts import DEFAULT_NOTE_TOOL_PROMPTS
from .utils import _get_room_state

_log = bind_context_logger(tag="[notes_view_control]")

# ============================================================================
# Tool Handlers
# ============================================================================


@bot_tool(
    name="bot_scroll_note",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_scroll_note"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "position": {
                "type": "string",
                "description": "Scroll target: 'top', 'bottom', or 'heading:<heading text>' to scroll to a specific heading.",
                "enum": ["top", "bottom"],
            },
            "heading": {
                "type": "string",
                "description": "If scrolling to a heading, the heading text to scroll to (case-insensitive fuzzy match).",
            },
        },
        "required": [],
    },
)
async def scroll_note_handler(params: FunctionCallParams):
    """Handle bot_scroll_note tool call."""
    log = bind_tool_logger(params, tag="[notes_view_control]")
    forwarder = params.forwarder
    arguments = params.arguments
    position = arguments.get("position", "top")
    heading = arguments.get("heading")

    result = await bot_scroll_note(position=position, heading=heading, forwarder=forwarder, log=log)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_highlight_note_text",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_highlight_note_text"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": "The text passage to highlight in the currently open note (case-insensitive match).",
            },
            "clear": {
                "type": "boolean",
                "description": "If true, clear all current highlights instead of adding one.",
                "default": False,
            },
        },
        "required": [],
    },
)
async def highlight_note_text_handler(params: FunctionCallParams):
    """Handle bot_highlight_note_text tool call."""
    log = bind_tool_logger(params, tag="[notes_view_control]")
    forwarder = params.forwarder
    arguments = params.arguments
    text = arguments.get("text", "")
    clear = arguments.get("clear", False)

    result = await bot_highlight_note_text(text=text, clear=clear, forwarder=forwarder, log=log)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_navigate_note_heading",
    description=DEFAULT_NOTE_TOOL_PROMPTS["bot_navigate_note_heading"],
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "heading": {
                "type": "string",
                "description": "The heading text to navigate to (case-insensitive fuzzy match).",
            },
            "direction": {
                "type": "string",
                "description": "Navigate to the 'next' or 'previous' heading relative to current position.",
                "enum": ["next", "previous"],
            },
        },
        "required": [],
    },
)
async def navigate_note_heading_handler(params: FunctionCallParams):
    """Handle bot_navigate_note_heading tool call."""
    log = bind_tool_logger(params, tag="[notes_view_control]")
    forwarder = params.forwarder
    arguments = params.arguments
    heading = arguments.get("heading")
    direction = arguments.get("direction")

    result = await bot_navigate_note_heading(heading=heading, direction=direction, forwarder=forwarder, log=log)
    await params.result_callback(result, properties=FunctionCallResultProperties(run_llm=False))


# ============================================================================
# Implementation
# ============================================================================


async def bot_scroll_note(
    position: str = "top",
    heading: str | None = None,
    forwarder=None,
    log=None,
) -> dict[str, Any]:
    """Scroll the note view to a specific position.

    Args:
        position: 'top', 'bottom', or ignored when heading is set.
        heading: Optional heading text to scroll to.
        forwarder: AppMessageForwarder for emitting events.
    """
    try:
        if not forwarder:
            return {"success": False, "error": "No forwarder", "user_message": "Cannot scroll without an active session."}

        from tools import events

        payload: dict[str, Any] = {}
        if heading:
            payload["heading"] = heading
        else:
            payload["position"] = position

        await forwarder.emit_tool_event(events.NOTE_SCROLL, payload)
        target = f"heading '{heading}'" if heading else position
        return {"success": True, "user_message": f"Scrolled to {target}."}
    except Exception as e:
        (log or _log).error(f"[notes_view_control] Error scrolling: {e}")
        return {"success": False, "error": str(e), "user_message": "Failed to scroll note."}


async def bot_highlight_note_text(
    text: str = "",
    clear: bool = False,
    forwarder=None,
    log=None,
) -> dict[str, Any]:
    """Highlight a text passage in the currently open note, or clear highlights."""
    try:
        if not forwarder:
            return {"success": False, "error": "No forwarder", "user_message": "Cannot highlight without an active session."}

        from tools import events

        payload: dict[str, Any] = {"clear": clear}
        if not clear:
            if not text:
                return {"success": False, "error": "No text provided", "user_message": "Please specify what text to highlight."}
            payload["text"] = text

        await forwarder.emit_tool_event(events.NOTE_HIGHLIGHT, payload)
        if clear:
            return {"success": True, "user_message": "Cleared highlights."}
        return {"success": True, "user_message": f"Highlighted the text."}
    except Exception as e:
        (log or _log).error(f"[notes_view_control] Error highlighting: {e}")
        return {"success": False, "error": str(e), "user_message": "Failed to highlight text."}


async def bot_navigate_note_heading(
    heading: str | None = None,
    direction: str | None = None,
    forwarder=None,
    log=None,
) -> dict[str, Any]:
    """Navigate to a specific heading or next/previous heading in the note."""
    try:
        if not forwarder:
            return {"success": False, "error": "No forwarder", "user_message": "Cannot navigate without an active session."}

        if not heading and not direction:
            return {"success": False, "error": "No heading or direction", "user_message": "Please specify a heading or direction (next/previous)."}

        from tools import events

        payload: dict[str, Any] = {}
        if heading:
            payload["heading"] = heading
        if direction:
            payload["direction"] = direction

        await forwarder.emit_tool_event(events.NOTE_NAVIGATE_HEADING, payload)
        target = f"heading '{heading}'" if heading else f"{direction} heading"
        return {"success": True, "user_message": f"Navigated to {target}."}
    except Exception as e:
        (log or _log).error(f"[notes_view_control] Error navigating: {e}")
        return {"success": False, "error": str(e), "user_message": "Failed to navigate note."}
