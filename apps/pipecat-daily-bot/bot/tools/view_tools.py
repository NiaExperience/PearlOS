"""View and application management tools for LLM.

Provides tools for:
- Closing views/windows
- Switching desktop modes
- Opening various applications (Gmail, Notes, Terminal, Browser, etc.)

All tools emit events via AppMessageForwarder that the frontend intercepts.
"""
from actions import notes_actions
from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools import events
from tools.news_app_html import build_news_html
from tools.sharing import utils as sharing_tools
from room.state import set_desktop_mode
from tools.logging_utils import bind_tool_logger


# Default functional prompts (fallbacks if no DB entry exists)
DEFAULT_VIEW_TOOL_PROMPTS = {
    'bot_close_browser_window': 'Close specific apps or all windows. Pass "apps" array (e.g. ["notes","terminal"]) or omit to close all. "Closed X" from STT = "close X".',
    'bot_close_applet_creation_engine': 'Close the creation engine window.',
    'bot_close_view': 'Close specific apps (pass "apps" array) or all windows if omitted.',
    'bot_close_terminal': 'Close the terminal.',
    'bot_close_gmail': 'Close Gmail.',
    'bot_close_notes': 'Close the notes app. "Closed notes" from STT = "close notes".',
    'bot_close_google_drive': 'Close Google Drive.',
    'bot_close_youtube': 'Close the YouTube player.',
    'bot_open_browser': 'Open a browser window, optionally to a URL.',
    'bot_open_creation_engine': 'Open the creation engine for HTML content creation.',
    'bot_open_enhanced_browser': 'Open an enhanced browser with dev tools.',
    'bot_open_gmail': 'Open Gmail.',
    'bot_open_google_drive': 'Open Google Drive.',
    'bot_open_notes': 'Open the Notes app. For a SPECIFIC note by name, use bot_open_note instead.',
    'bot_open_files': 'Open FileSpace. If the user describes files naturally, pass query so FileSpace can search and open the relevant folder.',
    'bot_open_terminal': 'Open a terminal/command line.',
    'bot_open_news': 'Open the built-in PearlOS News app with live headlines. Optional category: world, science, politics, entertainment, health, tech. Do NOT generate HTML for news.',
    'bot_open_youtube': 'Open YouTube player. Use bot_search_youtube_videos to find/play videos.',
    'bot_switch_layout_mode': 'Switch UI layout between desktop and mobile viewport. RARELY needed. If user says "home"/"desktop", use bot_switch_desktop_mode instead.',
    'bot_switch_desktop_mode': 'Switch desktop mode: "home" (default home screen) or "desktop" (work surface with app icons). NOT for note privacy (use bot_switch_note_mode).',
}

# Lazy import helper to avoid circular import
def _get_room_tenant_id(room_url: str):
    try:
        from room.state import get_room_tenant_id
    except ImportError:
        from bot.room.state import get_room_tenant_id
    return get_room_tenant_id(room_url)



# ============================================================================
# View Tool Handlers (Decorated)
# ============================================================================


# DISABLED per Blair directive 2026-02-26 — duplicate of bot_close_browser_window
# @bot_tool(name="bot_close_view", ...)
async def _disabled_bot_close_view(params: FunctionCallParams):
    """Close specific apps or all views.
    
    If apps array is provided, closes only those specific apps.
    Otherwise, closes all windows (legacy behavior).
    """
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    arguments = params.arguments
    
    apps = arguments.get("apps")
    request_text = arguments.get("request_text")
    
    # DEBUG: Log what we received
    log.warning(f"🔍 [bot_close_view] Called with arguments: {arguments}")
    log.warning(f"🔍 [bot_close_view] apps={apps}, request_text={request_text}")
    log.warning(f"🔍 [bot_close_view] apps type: {type(apps)}, is list: {isinstance(apps, list)}")
    
    if forwarder:
        # Apps that live on Wonder Canvas rather than in the window manager
        WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content'}

        # If specific apps requested, use apps.close event
        if apps and isinstance(apps, list) and len(apps) > 0:
            log.warning(f"✅ [bot_close_view] EMITTING apps.close event with apps: {apps}")
            await forwarder.emit_tool_event(events.APPS_CLOSE, {
                "apps": apps,
                "requestText": request_text
            })
            # If any requested app lives on Wonder Canvas, also clear it
            if any(a.lower() in WONDER_CANVAS_APPS for a in apps):
                await forwarder.emit_tool_event(events.WONDER_CANVAS_CLEAR, {})
                log.info(f"[bot_close_view] Also emitted wonder.clear for canvas app(s)")
            
            app_list = ", ".join(apps)
            user_message = f"Closing {app_list}."
        else:
            # Legacy: close all windows
            log.warning(f"⚠️ [bot_close_view] FALLBACK - EMITTING view.close event (apps was: {apps})")
            await forwarder.emit_tool_event(events.VIEW_CLOSE, {})
            # Also clear Wonder Canvas content (news, weather, etc.) which lives
            # outside the window manager and won't be closed by view.close
            await forwarder.emit_tool_event(events.WONDER_CANVAS_CLEAR, {})
            log.info("[bot_close_view] Also emitted wonder.clear to dismiss canvas content")
            user_message = "Closing all windows."
    else:
        log.error("❌ [bot_close_view] No forwarder available!")
        user_message = "Unable to close windows (no forwarder available)."
    
    await params.result_callback({
        "success": True,
        "user_message": user_message
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_switch_desktop_mode",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_switch_desktop_mode"],
    feature_flag="browserAutomation",
    parameters={
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "description": "The PearlOS desktop mode to switch to. Valid values: 'home' (the home screen — use when user says 'home' or 'go home') or 'desktop' (the desktop work surface with app icons — use when user says 'desktop' or 'go to desktop'). REQUIRED - always provide this parameter.",
                "enum": ["home", "desktop"]
            }
        },
        "required": ["mode"]
    }
)
async def bot_switch_desktop_mode(params: FunctionCallParams):
    """Switch desktop mode."""
    log = bind_tool_logger(params, tag="[view_tools]")
    arguments = params.arguments
    forwarder = params.forwarder
    
    mode = arguments.get("mode")
    if not mode:
        log.warning("[bot_switch_desktop_mode] No mode parameter provided, defaulting to 'home'")
        mode = "home"
    
    log.info(f"[bot_switch_desktop_mode] Switching to desktop mode: {mode}")
    
    if forwarder:
        await forwarder.emit_tool_event(events.DESKTOP_MODE_SWITCH, {"mode": mode})
        
        # Track the mode change in Redis
        if hasattr(forwarder, "room_url") and forwarder.room_url:
            await set_desktop_mode(forwarder.room_url, mode)
    
    await params.result_callback({
        "success": True,
        "user_message": f"Switching to {mode} desktop mode."
    })


@bot_tool(
    name="bot_switch_layout_mode",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_switch_layout_mode"],
    feature_flag="browserAutomation",
    parameters={
        "type": "object",
        "properties": {
            "mode": {
                "type": "string",
                "description": "The UI layout mode to switch to. Valid values: 'desktop' (wide layout) or 'mobile' (narrow layout). NOTE: This is about viewport layout, NOT PearlOS desktop modes. If the user says 'switch to desktop' or 'desktop mode', they almost certainly want bot_switch_desktop_mode with mode='home' instead.",
                "enum": ["desktop", "mobile"]
            }
        },
        "required": ["mode"]
    }
)
async def bot_switch_layout_mode(params: FunctionCallParams):
    """Switch between desktop and mobile layout modes."""
    log = bind_tool_logger(params, tag="[view_tools]")
    arguments = params.arguments
    forwarder = params.forwarder

    mode = arguments.get("mode")
    if mode not in ("desktop", "mobile"):
        log.warning(f"[bot_switch_layout_mode] Invalid mode '{mode}', defaulting to 'desktop'")
        mode = "desktop"

    log.info(f"[bot_switch_layout_mode] Switching to layout mode: {mode}")

    if forwarder:
        await forwarder.emit_tool_event(events.LAYOUT_MODE_SWITCH, {"mode": mode})

    await params.result_callback({
        "success": True,
        "user_message": f"Switching to {mode} layout mode."
    })


@bot_tool(
    name="bot_close_browser_window",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_browser_window"],
    feature_flag="browserAutomation",
    parameters={
        "apps": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional list of specific app names to close (e.g., ['terminal', 'gmail', 'drive']). If not provided, closes all windows."
        },
        "request_text": {
            "type": "string",
            "description": "Optional raw user request text for context (e.g., 'close terminal and gmail')"
        }
    },
    passthrough=True
)
async def bot_close_browser_window(params: FunctionCallParams):
    """Close specific apps or all browser windows.
    
    If apps array is provided, closes only those specific apps.
    Otherwise, closes all windows (legacy behavior).
    """
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    arguments = params.arguments
    
    apps = arguments.get("apps")
    request_text = arguments.get("request_text")
    
    # DEBUG: Log what we received
    log.warning(f"🔍 [bot_close_browser_window] Called with arguments: {arguments}")
    log.warning(f"🔍 [bot_close_browser_window] apps={apps}, request_text={request_text}")
    log.warning(f"🔍 [bot_close_browser_window] apps type: {type(apps)}, is list: {isinstance(apps, list)}")
    
    if forwarder:
        # Apps that live on Wonder Canvas rather than in the window manager
        WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content'}

        # If specific apps requested, use apps.close event
        if apps and isinstance(apps, list) and len(apps) > 0:
            log.warning(f"✅ [bot_close_browser_window] EMITTING apps.close event with apps: {apps}")
            await forwarder.emit_tool_event(events.APPS_CLOSE, {
                "apps": apps,
                "requestText": request_text
            })
            # If any requested app lives on Wonder Canvas, also clear it
            if any(a.lower() in WONDER_CANVAS_APPS for a in apps):
                await forwarder.emit_tool_event(events.WONDER_CANVAS_CLEAR, {})
                log.info(f"[bot_close_browser_window] Also emitted wonder.clear for canvas app(s)")
            
            app_list = ", ".join(apps)
            user_message = f"Closing {app_list}."
        else:
            # Fallback: close canvas + apps but NOT browser.close (which can cascade into Daily teardown)
            log.warning(f"⚠️ [bot_close_browser_window] FALLBACK - clearing canvas only (apps was: {apps})")
            await forwarder.emit_tool_event(events.WONDER_CANVAS_CLEAR, {})
            # Emit apps.close for common window types instead of the dangerous browser.close
            await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["wonder_canvas", "news", "weather", "browser"]})
            log.info("[bot_close_browser_window] Emitted wonder.clear + apps.close (safe path, no browser.close)")
            user_message = "Closing all windows."
    else:
        log.error("❌ [bot_close_browser_window] No forwarder available!")
        user_message = "Unable to close windows (no forwarder available)."
    
    await params.result_callback({
        "success": True,
        "user_message": user_message
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Google Drive removed from PearlOS tools
# @bot_tool(name="bot_open_google_drive", ...)
async def _disabled_bot_open_google_drive(params: FunctionCallParams):
    """Open Google Drive."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "drive"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening Google Drive."
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Gmail removed from PearlOS tools
# @bot_tool(name="bot_open_gmail", ...)
async def _disabled_bot_open_gmail(params: FunctionCallParams):
    """Open Gmail."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "gmail"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening Gmail."
    }, properties=FunctionCallResultProperties(run_llm=False))




@bot_tool(
    name="bot_open_notes",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_notes"],
    feature_flag="notes",
    parameters={},
    passthrough=True
)
async def bot_open_notes(params: FunctionCallParams):
    """Open notes application."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    room_url = params.room_url
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "notes"})

    tenant_id = _get_room_tenant_id(room_url)
    if not tenant_id:
        log.error(f"[notes] No tenant_id for room {room_url}")
        return {
            "success": False, 
            "error": "No tenant context",
            "user_message": "I'm having trouble accessing the workspace context. Could you try reloading the page?"
        }

    # SECURITY CHECK: Verify write permission
    user_id, error_msg = await sharing_tools._resolve_user_id(params, room_url)
    if not user_id:
        log.warning(f"[notes] Could not identify user for permission check: {error_msg}")
        return {
            "success": False,
            "error": error_msg or "Could not identify user",
            "user_message": error_msg or "I couldn't identify which user is making this request. Please try again."
        }
            
    # Skip fetching notes here — the frontend loads its own notes on mount.
    # Previously this made 3 sequential Mesh HTTP calls adding 5-10s of latency.
    await params.result_callback({
        "success": True,
        "user_message": "Opening notes.",
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_files",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_files"],
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Natural language file search to run inside FileSpace.",
            },
        },
        "required": [],
    },
    passthrough=True
)
async def bot_open_files(params: FunctionCallParams):
    """Open FileSpace, optionally with a natural language search."""
    arguments = params.arguments or {}
    query = str(arguments.get("query") or arguments.get("fileSearchQuery") or "").strip()
    payload = {"app": "files"}
    if query:
        payload["query"] = query
        payload["fileSearchQuery"] = query

    if params.forwarder:
        await params.forwarder.emit_tool_event(events.APP_OPEN, payload)

    await params.result_callback({
        "success": True,
        "user_message": f"Opening FileSpace and looking for {query}." if query else "Opening FileSpace.",
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_terminal",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_terminal"],
    feature_flag="terminal",
    parameters={},
    passthrough=True
)
async def bot_open_terminal(params: FunctionCallParams):
    """Open terminal."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "terminal"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening terminal."
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Browser removed from PearlOS tools
# @bot_tool(name="bot_open_browser", ...)
async def _disabled_bot_open_browser(params: FunctionCallParams):
    """Open browser with optional URL."""
    arguments = params.arguments
    forwarder = params.forwarder
    
    url = arguments.get("url")
    user_request = arguments.get("userRequest")
    
    if forwarder:
        payload = {}
        if url:
            payload["url"] = url
        if user_request:
            payload["userRequest"] = user_request
        await forwarder.emit_tool_event(events.BROWSER_OPEN, payload)
    
    message = f"Opening browser{' at ' + url if url else ''}."
    await params.result_callback({
        "success": True,
        "user_message": message
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Enhanced browser removed from PearlOS tools
# @bot_tool(name="bot_open_enhanced_browser", ...)
async def _disabled_bot_open_enhanced_browser(params: FunctionCallParams):
    """Open an enhanced browser window with advanced features."""
    log = bind_tool_logger(params, tag="[view_tools]")
    arguments = params.arguments
    forwarder = params.forwarder
    
    url = arguments.get("url", "")
    user_request = arguments.get("userRequest")

    try:
        log.info(f"[view_tools] Opening enhanced browser: {url}")
        
        if not url or not url.strip():
            await params.result_callback({
                "success": False,
                "error": "Invalid URL",
                "user_message": "URL is required to open browser"
            }, properties=FunctionCallResultProperties(run_llm=False))
            return
        
        # Emit BROWSER_OPEN event
        if forwarder:
            await forwarder.emit_tool_event(events.BROWSER_OPEN, {
                "url": url,
                "enhanced": True,
                "userRequest": user_request or ""
            })
        
        await params.result_callback({
            "success": True,
            "url": url,
            "user_message": f"Opening enhanced browser at {url}"
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error(f"[view_tools] Error opening enhanced browser: {e}")
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to open enhanced browser"
        }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_creation_engine",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_creation_engine"],
    feature_flag="htmlContent",
    parameters={},
    passthrough=True
)
async def bot_open_creation_engine(params: FunctionCallParams):
    """Open creation engine."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "creation-engine"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening creation engine."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_news",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_news"],
    feature_flag="wonderCanvas",
    parameters={
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": (
                    "Optional category to open directly: 'world', 'science', 'politics', "
                    "'entertainment', 'health', 'tech'. Aliases work too: 'technology'→'tech', "
                    "'ent'→'entertainment', etc. If omitted, opens at the default (world)."
                ),
            },
        },
        "required": [],
    },
    passthrough=True
)
async def bot_open_news(params: FunctionCallParams):
    """Open the built-in PearlOS News app on Wonder Canvas.
    
    Emits wonder.scene directly so voice does not depend on a secondary
    app.open -> Wonder Canvas remap being mounted in the browser.
    """
    args = params.arguments
    category = (args.get("category") or "").strip().lower() or None
    forwarder = params.forwarder

    if forwarder:
        await forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
            "html": build_news_html(category),
            "layer": "main",
            "transition": "fade",
            "hideChrome": True,
            "sceneId": "news",
        })

    await params.result_callback({
        "success": True,
        "user_message": "Opening The News app."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_youtube",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_youtube"],
    feature_flag="youtube",
    parameters={},
    passthrough=True
)
async def bot_open_youtube(params: FunctionCallParams):
    """Open the YouTube player interface."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "youtube"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening YouTube player interface."
    }, properties=FunctionCallResultProperties(run_llm=False))


# ============================================================================
# INDIVIDUAL CLOSE TOOLS (Mirror the open tools pattern)
# ============================================================================

@bot_tool(
    name="bot_close_terminal",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_terminal"],
    feature_flag="terminal",
    parameters={},
    passthrough=True
)
async def bot_close_terminal(params: FunctionCallParams):
    """Close terminal application."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_terminal] Emitting apps.close with ['terminal']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["terminal"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing terminal."
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Gmail removed from PearlOS tools
# @bot_tool(name="bot_close_gmail", ...)
async def _disabled_bot_close_gmail(params: FunctionCallParams):
    """Close Gmail application."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_gmail] Emitting apps.close with ['gmail']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["gmail"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing Gmail."
    }, properties=FunctionCallResultProperties(run_llm=False))




@bot_tool(
    name="bot_close_notes",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_notes"],
    feature_flag="notes",
    parameters={},
    passthrough=True
)
async def bot_close_notes(params: FunctionCallParams):
    """Close notes application."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_notes] Emitting apps.close with ['notes']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["notes"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing notes."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_close_applet_creation_engine",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_applet_creation_engine"],
    feature_flag="htmlContent",
    parameters={},
    passthrough=True
)
async def bot_close_applet_creation_engine(params: FunctionCallParams):
    """Close the creation engine or content creation tool window."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_applet_creation_engine] Emitting apps.close with ['creation-engine']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["creation-engine"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing creation engine."
    }, properties=FunctionCallResultProperties(run_llm=False))


# DISABLED per Blair directive 2026-02-26 — Google Drive removed from PearlOS tools
# @bot_tool(name="bot_close_google_drive", ...)
async def _disabled_bot_close_google_drive(params: FunctionCallParams):
    """Close Google Drive application."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_google_drive] Emitting apps.close with ['drive']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["drive"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing Google Drive."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_close_youtube",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_youtube"],
    feature_flag="youtube",
    parameters={},
    passthrough=True
)
async def bot_close_youtube(params: FunctionCallParams):
    """Close the YouTube player interface."""
    log = bind_tool_logger(params, tag="[view_tools]")
    forwarder = params.forwarder
    
    if forwarder:
        log.info("[bot_close_youtube] Emitting apps.close with ['youtube']")
        await forwarder.emit_tool_event(events.APPS_CLOSE, {"apps": ["youtube"]})
    
    await params.result_callback({
        "success": True,
        "user_message": "Closing YouTube player interface."
    }, properties=FunctionCallResultProperties(run_llm=False))
