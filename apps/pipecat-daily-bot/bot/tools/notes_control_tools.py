"""Notes control tools for LLM — scroll, highlight, and rich display.

Gives Pearl control over the notes/canvas display during voice sessions:
- Scroll to positions, sections, top/bottom
- Highlight text to draw attention
- Clear highlights
"""
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.logging_utils import bind_tool_logger


@bot_tool(
    name="bot_scroll_note",
    description=(
        "Scroll the currently open note to a specific position. "
        "Use this to guide the user's attention to different parts of a note while discussing it. "
        "Triggers: 'scroll to the top', 'go to the bottom', 'scroll down', 'show me the section about X'. "
        "Supports: position ('top', 'bottom', 'up', 'down'), section heading text, or percentage (0-100)."
    ),
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "position": {
                "type": "string",
                "description": (
                    "Where to scroll. Values: 'top', 'bottom', 'up' (page up), 'down' (page down). "
                    "Or a percentage like '50' for middle of the document."
                )
            },
            "section": {
                "type": "string",
                "description": (
                    "Heading text to scroll to (e.g., 'Introduction', 'Budget Summary'). "
                    "The frontend will find the nearest heading matching this text and scroll to it."
                )
            },
            "search_text": {
                "type": "string",
                "description": (
                    "Arbitrary text to find and scroll to. Use when there's no heading but you want "
                    "to scroll to a specific paragraph or sentence."
                )
            }
        }
    },
    passthrough=True
)
async def bot_scroll_note(params: FunctionCallParams):
    """Scroll the current note to a position, section, or text match."""
    log = bind_tool_logger(params, tag="[notes_control]")
    forwarder = params.forwarder
    arguments = params.arguments

    position = arguments.get("position")
    section = arguments.get("section")
    search_text = arguments.get("search_text")

    log.info(f"[bot_scroll_note] position={position}, section={section}, search_text={search_text}")

    if forwarder:
        await forwarder.emit_tool_event(events.NOTE_SCROLL, {
            "position": position,
            "section": section,
            "searchText": search_text,
        })

    target = section or search_text or position or "requested position"
    await params.result_callback({
        "success": True,
        "user_message": f"Scrolling to {target}."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_highlight_note",
    description=(
        "Highlight specific text in the currently open note to draw the user's attention. "
        "Use this while discussing a specific part of a note — the highlighted text will pulse/glow "
        "so the user can see exactly what you're referring to. "
        "Triggers: 'look at this part', 'notice the budget line', 'pay attention to paragraph 2'. "
        "Also auto-scrolls to the highlighted text."
    ),
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "text": {
                "type": "string",
                "description": (
                    "The text to highlight. Can be a keyword, phrase, sentence, or paragraph. "
                    "The frontend will find and highlight all occurrences."
                )
            },
            "section": {
                "type": "string",
                "description": (
                    "A section heading to highlight entirely. Highlights the heading and its content "
                    "until the next heading of the same or higher level."
                )
            },
            "color": {
                "type": "string",
                "description": "Highlight color. Options: 'yellow' (default), 'blue', 'green', 'pink', 'orange'.",
                "enum": ["yellow", "blue", "green", "pink", "orange"]
            },
            "duration_seconds": {
                "type": "number",
                "description": "How long the highlight should stay visible (default: 8 seconds). Set to 0 for persistent."
            }
        }
    },
    passthrough=True
)
async def bot_highlight_note(params: FunctionCallParams):
    """Highlight text in the current note."""
    log = bind_tool_logger(params, tag="[notes_control]")
    forwarder = params.forwarder
    arguments = params.arguments

    text = arguments.get("text")
    section = arguments.get("section")
    color = arguments.get("color", "yellow")
    duration = arguments.get("duration_seconds", 8)

    log.info(f"[bot_highlight_note] text={text}, section={section}, color={color}, duration={duration}")

    if forwarder:
        await forwarder.emit_tool_event(events.NOTE_HIGHLIGHT, {
            "text": text,
            "section": section,
            "color": color,
            "durationSeconds": duration,
        })

    target = text or section or "content"
    await params.result_callback({
        "success": True,
        "user_message": f"Highlighting {target}."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_clear_note_highlights",
    description=(
        "Clear all highlights from the currently open note. "
        "Use this when you're done discussing a section and want to remove visual emphasis. "
        "Triggers: 'clear highlights', 'remove highlighting', 'done with that section'."
    ),
    feature_flag="notes",
    parameters={},
    passthrough=True
)
async def bot_clear_note_highlights(params: FunctionCallParams):
    """Clear all highlights from the current note."""
    log = bind_tool_logger(params, tag="[notes_control]")
    forwarder = params.forwarder

    log.info("[bot_clear_note_highlights] Clearing all highlights")

    if forwarder:
        await forwarder.emit_tool_event(events.NOTE_HIGHLIGHT_CLEAR, {})

    await params.result_callback({
        "success": True,
        "user_message": "Clearing highlights."
    }, properties=FunctionCallResultProperties(run_llm=False))
