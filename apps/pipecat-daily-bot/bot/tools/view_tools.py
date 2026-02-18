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
from tools.sharing import utils as sharing_tools
from room.state import set_desktop_mode
from tools.logging_utils import bind_tool_logger


# Default functional prompts (fallbacks if no DB entry exists)
DEFAULT_VIEW_TOOL_PROMPTS = {
    'bot_close_browser_window': 'Close specific apps (Gmail, Terminal, Drive, Notes, etc.) or all windows. Use the "apps" parameter to specify which apps to close (e.g., ["gmail", "terminal"]). If no apps specified, closes all windows.',
    'bot_close_applet_creation_engine': 'Close the creation engine or content creation tool window. Triggers: "close creation engine", "exit creation engine", "close content creator", "exit content creator".',
    'bot_close_view': 'Close specific apps or the current view. Use the "apps" parameter to specify which apps to close (Gmail, Terminal, Drive, Notes, etc.). If no apps specified, closes all windows.',
    'bot_close_terminal': 'Close the terminal application. Triggers: "close terminal", "exit terminal".',
    'bot_close_gmail': 'Close Gmail. Triggers: "close gmail", "exit gmail".',
    'bot_close_notes': 'Close the notes application. Triggers: "close notes", "exit notes", "close notepad".',
    'bot_close_google_drive': 'Close Google Drive. Triggers: "close drive", "exit drive".',
    'bot_close_youtube': 'Close the YouTube player interface. Triggers: "close youtube", "stop video", "exit youtube".',
    'bot_open_browser': 'Open a web browser window. Optionally navigate to a specified URL. Triggers: "open browser", "launch browser", "open web browser", "go to [URL]".',
    'bot_open_creation_engine': 'Open the creation engine or content creation tool. Triggers: "open creation engine", "load creation tool", "start content creation", "create html content".',
    'bot_open_enhanced_browser': "Open an enhanced browser window with advanced features (dev tools, extensions, etc.).",
    'bot_open_gmail': 'Open Gmail in the application or browser. Triggers: "open gmail", "load gmail app", "check email", "open email".',
    'bot_open_google_drive': 'Open Google Drive in the application or browser. Triggers: "open drive", "load google drive app", "open google drive", "open my files".',
    'bot_open_notes': 'Open the Notepad application. Triggers: "open notes", "open notepad", "load notes app", "open portal", "open library". For opening a SPECIFIC note by name or description, ALWAYS use bot_open_note instead.',
    'bot_open_terminal': 'Open a terminal or command line interface. Triggers: "open terminal", "load terminal app", "open command line", "open shell".',
    'bot_open_youtube': 'Open the YouTube player interface.  Triggers: "open youtube", "load youtube app", "open video", "play video". Use bot_search_youtube_videos to search and play videos based on user input.',
    'bot_switch_desktop_mode': 'Switch between DESKTOP/background modes. Available modes: "home" (home/desktop background), "work" (work background with app icons), "quiet" (minimal peaceful background), and "create" (Creation Engine workspace). When user says "home mode" or "desktop home", use "home". When user says "work mode" or "desktop work", use "work". When user says "quiet mode", "go quiet", or anything similar, use "quiet". When user says "create mode", "creation mode", "open create mode", "switch to create", or anything similar about building/creating, use "create". IMPORTANT: This is NOT note privacy mode. If the user is talking about Notes/Notepad "personal" vs "work" visibility, use bot_switch_note_mode instead.',
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


@bot_tool(
    name="bot_close_view",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_view"],
    feature_flag="browserAutomation",
    parameters={
        "apps": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Optional list of specific app names to close (e.g., ['terminal', 'gmail']). If not provided, closes all windows."
        },
        "request_text": {
            "type": "string",
            "description": "Optional raw user request text for context (e.g., 'close terminal and gmail')"
        }
    },
    passthrough=True
)
async def bot_close_view(params: FunctionCallParams):
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
        # If specific apps requested, use apps.close event
        if apps and isinstance(apps, list) and len(apps) > 0:
            log.warning(f"✅ [bot_close_view] EMITTING apps.close event with apps: {apps}")
            await forwarder.emit_tool_event(events.APPS_CLOSE, {
                "apps": apps,
                "requestText": request_text
            })
            
            app_list = ", ".join(apps)
            user_message = f"Closing {app_list}."
        else:
            # Legacy: close all windows
            log.warning(f"⚠️ [bot_close_view] FALLBACK - EMITTING view.close event (apps was: {apps})")
            await forwarder.emit_tool_event(events.VIEW_CLOSE, {})
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
                "description": "The desktop mode to switch to. Valid values: 'home' (home/desktop background), 'work' (work background with app icons - aka workspace), 'quiet' (personal quiet background), or 'create' (Creation Engine workspace). REQUIRED - always provide this parameter.",
                "enum": ["home", "work", "quiet", "create"]
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
        # If specific apps requested, use apps.close event
        if apps and isinstance(apps, list) and len(apps) > 0:
            log.warning(f"✅ [bot_close_browser_window] EMITTING apps.close event with apps: {apps}")
            await forwarder.emit_tool_event(events.APPS_CLOSE, {
                "apps": apps,
                "requestText": request_text
            })
            
            app_list = ", ".join(apps)
            user_message = f"Closing {app_list}."
        else:
            # Legacy: close all windows
            log.warning(f"⚠️ [bot_close_browser_window] FALLBACK - EMITTING browser.close event (apps was: {apps})")
            await forwarder.emit_tool_event(events.BROWSER_CLOSE, {})
            user_message = "Closing all windows."
    else:
        log.error("❌ [bot_close_browser_window] No forwarder available!")
        user_message = "Unable to close windows (no forwarder available)."
    
    await params.result_callback({
        "success": True,
        "user_message": user_message
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_google_drive",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_google_drive"],
    feature_flag="googleDrive",
    parameters={},
    passthrough=True
)
async def bot_open_google_drive(params: FunctionCallParams):
    """Open Google Drive."""
    forwarder = params.forwarder
    
    if forwarder:
        await forwarder.emit_tool_event(events.APP_OPEN, {"app": "drive"})
    
    await params.result_callback({
        "success": True,
        "user_message": "Opening Google Drive."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_open_gmail",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_gmail"],
    feature_flag="gmail",
    parameters={},
    passthrough=True
)
async def bot_open_gmail(params: FunctionCallParams):
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


@bot_tool(
    name="bot_open_browser",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_browser"],
    feature_flag="miniBrowser",
    parameters={
        "url": {
            "type": "string",
            "description": "Optional URL to navigate to when opening the browser"
        }
    },
    passthrough=True
)
async def bot_open_browser(params: FunctionCallParams):
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


@bot_tool(
    name="bot_open_enhanced_browser",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_open_enhanced_browser"],
    feature_flag="miniBrowser",
    parameters={
        "url": {
            "type": "string",
            "description": "URL to open in the enhanced browser"
        },
        "features": {
            "type": "array",
            "description": "Optional list of features to enable (devtools, extensions, etc.)",
            "items": {"type": "string"}
        }
    },
    passthrough=True
)
async def bot_open_enhanced_browser(params: FunctionCallParams):
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


@bot_tool(
    name="bot_close_gmail",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_gmail"],
    feature_flag="gmail",
    parameters={},
    passthrough=True
)
async def bot_close_gmail(params: FunctionCallParams):
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


@bot_tool(
    name="bot_close_google_drive",
    description=DEFAULT_VIEW_TOOL_PROMPTS["bot_close_google_drive"],
    feature_flag="googleDrive",
    parameters={},
    passthrough=True
)
async def bot_close_google_drive(params: FunctionCallParams):
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
