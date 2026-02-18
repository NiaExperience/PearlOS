"""YouTube Tool Functions.

Tools for searching and controlling YouTube video playback.
These tools emit events that the frontend YouTube player listens to.
"""

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.logging_utils import bind_tool_logger
from tools import events


# Built-in fallback descriptions
DEFAULT_YOUTUBE_TOOL_PROMPTS: dict[str, str] = {
    'bot_search_youtube_videos': (
        "Search for YouTube videos by query and automatically play the top result. Opens the YouTube player with search results."
    ),
    'bot_pause_youtube_video': (
        "Pause the currently playing YouTube video."
    ),
    'bot_play_youtube_video': (
        "Play or resume YouTube video. Optionally provide a video ID/URL to play a specific video, or omit to resume the current paused video."
    ),
    'bot_play_next_youtube_video': (
        "Play the next video in the current YouTube playlist or search results."
    ),
}


# ============================================================================
# YouTube Tool Handlers (Decorated)
# ============================================================================


@bot_tool(
    name="bot_search_youtube_videos",
    description=DEFAULT_YOUTUBE_TOOL_PROMPTS["bot_search_youtube_videos"],
    feature_flag="youtube",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search query for YouTube videos"
            },
            "max_results": {
                "type": "number",
                "description": "Maximum number of results to return (default 10)",
                "default": 10
            }
        },
        "required": ["query"]
    }
)
async def bot_search_youtube_videos(params: FunctionCallParams):
    """Search for YouTube videos using YouTube Data API v3."""
    arguments = params.arguments
    forwarder = params.forwarder
    
    query = arguments.get("query", "")
    max_results = arguments.get("max_results", 10)
    log = bind_tool_logger(params, tag="[youtube_tools]").bind(query=query, maxResults=max_results)
    
    try:
        log.info("Searching YouTube for query")
        
        if not query or not query.strip():
            log.bind(arguments=arguments, availableKeys=list(arguments.keys())).warning(
                "Missing query for bot_search_youtube_videos"
            )
            await params.result_callback({
                "success": False,
                "error": "Invalid query",
                "user_message": "Search query is required"
            }, properties=FunctionCallResultProperties(run_llm=True))
            return
        
        # Frontend handles the actual YouTube search to avoid payload size limits
        # Send YOUTUBE_SEARCH event which browser-window will handle (opening window + triggering search)
        if forwarder:
            await forwarder.emit_tool_event(events.YOUTUBE_SEARCH, {
                "query": query
            })
        
        log.info("Sent search query to frontend")
        await params.result_callback({
            "success": True,
            "query": query,
            "user_message": f"Playing top result for '{query}'"
        }, properties=FunctionCallResultProperties(run_llm=True))
        
    except Exception as e:
        log.error("Error sending YouTube search", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to search YouTube videos"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_pause_youtube_video",
    description=DEFAULT_YOUTUBE_TOOL_PROMPTS["bot_pause_youtube_video"],
    feature_flag="youtube",
    parameters={},
    passthrough=True
)
async def bot_pause_youtube_video(params: FunctionCallParams):
    """Pause the currently playing YouTube video."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[youtube_tools]")
    
    try:
        log.info("Pausing YouTube video")
        
        # Emit YOUTUBE_PAUSE event
        if forwarder:
            await forwarder.emit_tool_event(events.YOUTUBE_PAUSE, {})
        
        await params.result_callback({
            "success": True,
            "user_message": "Paused YouTube video"
        }, properties=FunctionCallResultProperties(run_llm=False))
        
    except Exception as e:
        log.error("Error pausing YouTube", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to pause YouTube video"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_play_youtube_video",
    description=DEFAULT_YOUTUBE_TOOL_PROMPTS["bot_play_youtube_video"],
    feature_flag="youtube",
    parameters={
        "type": "object",
        "properties": {
            "video_id": {
                "type": "string",
                "description": "YouTube video ID or full URL. Optional - omit to resume current paused video."
            }
        },
        "required": []
    }
)
async def bot_play_youtube_video(params: FunctionCallParams):
    """Play a specific YouTube video or resume current video."""
    arguments = params.arguments
    forwarder = params.forwarder
    
    video_id = arguments.get("video_id", "")
    log = bind_tool_logger(params, tag="[youtube_tools]")
    
    try:
        # Extract video ID from URL if provided
        if video_id and ("youtube.com" in video_id or "youtu.be" in video_id):
            # Simple extraction - full implementation would use URL parsing
            if "v=" in video_id:
                video_id = video_id.split("v=")[1].split("&")[0]
            elif "youtu.be/" in video_id:
                video_id = video_id.split("youtu.be/")[1].split("?")[0]
        
        if video_id:
            log.bind(videoId=video_id).info("Playing YouTube video")
        else:
            log.info("Resuming YouTube video")
        
        # Emit APP_OPEN event to ensure YouTube window is open
        if forwarder:
            await forwarder.emit_tool_event(events.APP_OPEN, {
                "app": "youtube"
            })
        
        # Emit YOUTUBE_PLAY event to play/resume video
        payload = {"videoId": video_id} if video_id else {}
        if forwarder:
            await forwarder.emit_tool_event(events.YOUTUBE_PLAY, payload)
        
        user_message = f"Playing YouTube video {video_id}" if video_id else "Resuming YouTube video"
        await params.result_callback({
            "success": True,
            "video_id": video_id or None,
            "user_message": user_message
        }, properties=FunctionCallResultProperties(run_llm=True))
        
    except Exception as e:
        log.error("Error playing YouTube video", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to play YouTube video"
        }, properties=FunctionCallResultProperties(run_llm=True))


@bot_tool(
    name="bot_play_next_youtube_video",
    description=DEFAULT_YOUTUBE_TOOL_PROMPTS["bot_play_next_youtube_video"],
    feature_flag="youtube",
    parameters={}
)
async def bot_play_next_youtube_video(params: FunctionCallParams):
    """Play the next video in the playlist or search results."""
    forwarder = params.forwarder
    log = bind_tool_logger(params, tag="[youtube_tools]")
    
    try:
        log.info("Playing next YouTube video")
        
        # Emit YOUTUBE_NEXT event
        if forwarder:
            await forwarder.emit_tool_event(events.YOUTUBE_NEXT, {})
        
        await params.result_callback({
            "success": True,
            "user_message": "Playing next YouTube video"
        }, properties=FunctionCallResultProperties(run_llm=True))
        
    except Exception as e:
        log.error("Error playing next video", exc_info=True)
        await params.result_callback({
            "success": False,
            "error": str(e),
            "user_message": "Failed to play next video"
        }, properties=FunctionCallResultProperties(run_llm=True))
