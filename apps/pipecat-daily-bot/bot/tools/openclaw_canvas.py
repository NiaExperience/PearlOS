"""OpenClaw Canvas tools — push workspace files and content to PearlOS Notes/Canvas.

These tools allow Pearl (via OpenClaw) to display files, documents, and generated
content in the PearlOS UI during voice sessions. They write directly to Mesh and
emit real-time events so the UI updates immediately.

Requires feature flag: openclawBridge
"""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger

import logging
logger = logging.getLogger(__name__)


async def _push_and_notify(
    params: FunctionCallParams,
    title: str,
    content: str,
    mode: str = "work",
) -> dict[str, Any]:
    """Push content to Mesh and emit UI refresh event.

    Returns the result dict for the tool callback.
    """
    log = bind_tool_logger(params, tag="[openclaw_canvas]")

    try:
        from services.openclaw_mesh_bridge import push_content_to_notes
    except ImportError as exc:
        log.error(f"[canvas] Failed to import mesh bridge: {exc}")
        return {
            "success": False,
            "error": "Mesh bridge not available",
            "user_message": "I can't push to the canvas right now — the bridge module isn't loaded.",
        }

    # Ensure env vars are set for the bridge
    if not os.getenv("MESH_API_ENDPOINT"):
        os.environ["MESH_API_ENDPOINT"] = "http://localhost:2000/api"
    if not os.getenv("MESH_SHARED_SECRET"):
        mesh_secret = os.getenv("MESH_SHARED_SECRET", "")
        if not mesh_secret:
            log.error("[canvas] MESH_SHARED_SECRET not set")
            return {
                "success": False,
                "error": "Mesh secret not configured",
                "user_message": "The canvas connection isn't configured yet.",
            }

    try:
        note = await push_content_to_notes(title, content, mode=mode)
        note_id = note.get("_id") or note.get("page_id")
        log.info(f"[canvas] Created note '{title}' (id={note_id})")

        # Emit refresh + open events so the UI shows it immediately
        forwarder = params.forwarder
        if forwarder and note_id:
            from tools import events
            from tools.notes.utils import _emit_refresh_event

            await _emit_refresh_event(forwarder, note_id, "create", mode)

            # Also emit NOTE_OPEN so the UI navigates to it
            try:
                payload = {
                    "noteId": note_id,
                    "title": title,
                    "mode": mode,
                    "timestamp": int(time.time() * 1000),
                }
                await forwarder.emit_tool_event(events.NOTE_OPEN, payload)
                log.info(f"[canvas] Emitted NOTE_OPEN for {note_id}")
            except Exception as e:
                log.warning(f"[canvas] Failed to emit NOTE_OPEN: {e}")

        return {
            "success": True,
            "note_id": note_id,
            "title": title,
            "user_message": f"I've put '{title}' on your screen.",
        }

    except Exception as exc:
        log.error(f"[canvas] Error pushing content: {exc}", exc_info=True)
        return {
            "success": False,
            "error": str(exc),
            "user_message": f"I had trouble displaying that — {str(exc)[:80]}",
        }


# ---------------------------------------------------------------------------
# Tool: show content / document on canvas
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show",
    description=(
        "Display content on the user's screen as a Canvas document. "
        "Use this to show formatted text, markdown, code snippets, lists, "
        "summaries, or any content the user should see visually. "
        "Content supports full markdown including headings, lists, code blocks, "
        "bold, italic, and links."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Title for the document shown on screen",
            },
            "content": {
                "type": "string",
                "description": "Markdown content to display. Supports headings, lists, code blocks, etc.",
            },
        },
        "required": ["title", "content"],
    },
)
async def canvas_show_handler(params: FunctionCallParams):
    """Show content on the user's canvas/screen."""
    args = params.arguments
    title = args.get("title", "Untitled")
    content = args.get("content", "")

    result = await _push_and_notify(params, title, content)
    await params.result_callback(
        result, properties=FunctionCallResultProperties(run_llm=True)
    )


# ---------------------------------------------------------------------------
# Tool: show a file from the workspace
# ---------------------------------------------------------------------------

@bot_tool(
    name="bot_canvas_show_file",
    description=(
        "Display a file from the workspace on the user's screen. "
        "Supports text files (code, markdown, config), images (jpg, png, gif), "
        "and videos (mp4, mov, webm). Files are rendered with proper formatting — "
        "code gets syntax highlighting, images display inline, videos play inline."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file to display (absolute or relative to workspace)",
            },
            "title": {
                "type": "string",
                "description": "Optional title override. Defaults to the filename.",
            },
        },
        "required": ["file_path"],
    },
)
async def canvas_show_file_handler(params: FunctionCallParams):
    """Show a workspace file on the user's canvas/screen."""
    log = bind_tool_logger(params, tag="[openclaw_canvas]")
    args = params.arguments
    file_path = args.get("file_path", "")
    title = args.get("title")

    path = Path(file_path)
    if not path.is_absolute():
        # Try workspace paths
        for base in [
            Path("/workspace/OpenClaw/workspace"),
            Path("/workspace/nia-universal"),
            Path.cwd(),
        ]:
            candidate = base / file_path
            if candidate.exists():
                path = candidate
                break

    if not path.exists():
        result = {
            "success": False,
            "error": f"File not found: {file_path}",
            "user_message": f"I couldn't find the file '{file_path}'.",
        }
        await params.result_callback(
            result, properties=FunctionCallResultProperties(run_llm=True)
        )
        return

    try:
        from services.openclaw_mesh_bridge import _file_to_markdown
    except ImportError:
        result = {
            "success": False,
            "error": "Mesh bridge not available",
            "user_message": "The canvas bridge isn't loaded.",
        }
        await params.result_callback(
            result, properties=FunctionCallResultProperties(run_llm=True)
        )
        return

    display_title = title or path.name
    content = _file_to_markdown(path)
    log.info(f"[canvas] Rendering file {path} ({len(content)} chars) as '{display_title}'")

    result = await _push_and_notify(params, display_title, content)
    await params.result_callback(
        result, properties=FunctionCallResultProperties(run_llm=True)
    )
