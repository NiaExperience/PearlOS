"""Miscellaneous Tool Functions.

Tools for various functionality not categorized elsewhere:
- Enhanced browser control
- Wikipedia search
- Daily call initiation
"""

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events

# Built-in fallback descriptions
DEFAULT_MISC_TOOL_PROMPTS: dict[str, str] = {
    'bot_search_wikipedia': (
        "Search Wikipedia for information on ANY topic - people, places, concepts, animals, objects, etc. "
        "Use this for any general knowledge question. Returns articles with summaries and opens the article in the browser."
    ),
    'bot_start_daily_call': (
        "Open the Forum / Social Call video interface. Use this when the user asks to 'open forum', 'open form', 'open social forum', 'open social', 'start a call', 'open daily call', 'start video', etc. "
        "The Forum / Social Call will use the pre-configured room (no room name needed)."
    ),
    'bot_end_call': (
        "End the active assistant session. User triggers: 'hang up', 'disconnect', 'goodbye', 'talk to you later', 'bye', etc. "
        "Use only when the assistant has confirmation to close the session."
    ),
    'bot_show_share_dialog': (
        "Popup the share dialog for the current applet. Use when user says 'show share dialog', 'open sharing popup', 'show sharing options'. "
        "This only SHOWS the dialog UI - it does NOT share with anyone."
    ),
}


# ============================================================================
# Miscellaneous Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_search_wikipedia",
    description=DEFAULT_MISC_TOOL_PROMPTS["bot_search_wikipedia"],
    feature_flag="wikipedia",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query for Wikipedia"
            },
            "sentences": {
                "type": "number",
                "description": "Number of sentences to return in summary (default 3)",
                "default": 3
            }
        },
        "required": ["query"]
    }
)
async def bot_search_wikipedia(params: FunctionCallParams):
    """Search Wikipedia for information using the Wikipedia OpenSearch API."""
    from actions.search_actions import search_wikipedia

    arguments = params.arguments
    forwarder = params.forwarder
    query = arguments.get("query", "")
    # sentences = arguments.get("sentences", 3)  # Not used by OpenSearch API
    log = bind_tool_logger(params, tag="[misc_tools]").bind(query=query)
    
    try:
        log.info("Searching Wikipedia")
        
        if not query or not query.strip():
            await params.result_callback({
                "success": False,
                "error": "Invalid query",
                "user_message": "Search query is required"
            }, properties=FunctionCallResultProperties(run_llm=True))
            return
        
        # Call existing search_wikipedia action
        results = await search_wikipedia(query, limit=5)
        
        if not results:
            await params.result_callback({
                "success": False,
                "error": "No results found",
                "user_message": f"No Wikipedia articles found for '{query}'"
            }, properties=FunctionCallResultProperties(run_llm=True))
            return
        
        # Get first result for opening
        first_result = results[0]
        
        # Emit APP_OPEN event to trigger browser window with Wikipedia article
        if forwarder:
            await forwarder.emit_tool_event(events.APP_OPEN, {
                "app": "browser",
                "url": first_result["url"]
            })
        
        # Return results with first article as primary
        await params.result_callback({
            "success": True,
            "query": query,
            "title": first_result["title"],
            "snippet": first_result["snippet"],
            "url": first_result["url"],
            "allResults": results,
            "totalResults": len(results),
            "user_message": f"Found {len(results)} Wikipedia articles for '{query}'. Opening: {first_result['title']}"
        }, properties=FunctionCallResultProperties(run_llm=True))
        return
        
    except Exception as e:
        log.error("Error searching Wikipedia", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to search Wikipedia"
        }, properties=FunctionCallResultProperties(run_llm=True))
        return


@bot_tool(
    name="bot_start_daily_call",
    description=DEFAULT_MISC_TOOL_PROMPTS["bot_start_daily_call"],
    feature_flag="dailyCall",
    passthrough=True
)
async def bot_start_daily_call(params: FunctionCallParams):
    """Open the Daily Call interface (uses configured room from DAILY_ROOM_URL env var)."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[misc_tools]")
    
    try:
        log.info("Opening Daily Call interface")
        
        if forwarder:
            # Emit APP_OPEN event with 'dailyCall' as the app name
            # The interface will open the DailyCall UI which uses the configured room
            await forwarder.emit_tool_event(events.APP_OPEN, {"app": "dailyCall"})
        
        await params.result_callback({
            "success": True,
            "user_message": "Opening Daily Call."
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error opening Daily call", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to open Daily call"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_show_share_dialog",
    description=DEFAULT_MISC_TOOL_PROMPTS["bot_show_share_dialog"],
    feature_flag="resourceSharing",
    passthrough=True
)
async def bot_show_share_dialog(params: FunctionCallParams):
    """Show the share dialog for the current applet."""
    log = bind_tool_logger(params, tag="[misc_tools]")
    if params.forwarder:
        await params.forwarder.emit_tool_event(events.APPLET_SHARE_OPEN, {})
    await params.result_callback({
        "success": True,
        "user_message": "Opening share dialog."
    }, properties=FunctionCallResultProperties(run_llm=False))


@bot_tool(
    name="bot_end_call",
    description=DEFAULT_MISC_TOOL_PROMPTS["bot_end_call"],
    feature_flag="assistantSelfClose",
    parameters={
        "reason": {
            "type": "string",
            "description": "Optional reason for ending the call; used for logging only."
        }
    }
)
async def bot_end_call(params: FunctionCallParams):
    """Attempt to close the active Daily Call session via assistant control."""
    forwarder = params.forwarder
    arguments = params.arguments or {}
    raw_reason = arguments.get("reason")

    log = bind_tool_logger(params, tag="[misc_tools]")

    reason = raw_reason.strip() if isinstance(raw_reason, str) else None
    close_reason = reason or "assistant.tool.bot_end_call"

    if not forwarder:
        log.error("Unable to emit end-call event: missing forwarder")
        await params.result_callback({
            "success": False,
            "error": "forwarder_unavailable",
            "user_message": "I couldn't reach the call controller to end the session."
        }, properties=FunctionCallResultProperties(run_llm=True))
        return

    log = log.bind(reason=close_reason)
    log.info("Emitting assistant-driven end-call events")

    session_end_payload = {
        "reason": close_reason,
        "initiator": "assistant",
        "source": "bot_end_call",
        "graceful": True,
    }

    await forwarder.emit_tool_event(events.BOT_SESSION_END, session_end_payload)

    await params.result_callback({
        "success": True,
        "user_message": "Closing the assistant session."
    }, properties=FunctionCallResultProperties(run_llm=False))