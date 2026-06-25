"""Compact voice super tools — 11 tools that dispatch to ~94 original handlers.

When BOT_VOICE_COMPACT_TOOLS=true, these replace the full tool set to reduce
schema tokens sent to the LLM (critical for voice latency).

Each super tool accepts an `action` parameter and dispatches to the original
@bot_tool handler with the same FunctionCallParams object.
"""
from __future__ import annotations

import copy
import logging
from typing import Any

from pipecat.frames.frames import FunctionCallResultProperties
from pipecat.services.llm_service import FunctionCallParams

from tools.decorators import bot_tool
from tools.discovery import get_discovery

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dispatch helper
# ---------------------------------------------------------------------------

# Map: super_tool_action -> original_tool_name
# Built per super-tool below.

_discovery_cache: dict[str, Any] | None = None

# Injected at runtime by builder.py — maps tool_name -> wrapped handler
# (with greeting gate, logging, etc.). Falls back to raw discovery handler.
_wrapped_handlers: dict[str, Any] = {}


def inject_wrapped_handlers(handlers: dict[str, Any]):
    """Called by builder.py to provide the toolbox-wrapped handlers."""
    global _wrapped_handlers
    _wrapped_handlers = handlers


def _get_handler(tool_name: str):
    """Get the handler for a tool — prefers wrapped (greeting gate + logging) version."""
    # Try wrapped handler first (injected by builder.py)
    if tool_name in _wrapped_handlers:
        return _wrapped_handlers[tool_name]
    # Fallback to raw discovery handler
    global _discovery_cache
    if _discovery_cache is None:
        _discovery_cache = get_discovery().discover_tools()
    meta = _discovery_cache.get(tool_name)
    if meta is None:
        raise KeyError(f"Tool '{tool_name}' not found in discovery registry")
    return meta["handler_function"]


async def _dispatch(params: FunctionCallParams, tool_name: str, arg_remap: dict[str, str] | None = None):
    """Dispatch to an original tool handler.
    
    Args:
        params: The FunctionCallParams from the super tool call.
        tool_name: The original tool name to dispatch to.
        arg_remap: Optional mapping of {super_arg_name: original_arg_name} for renaming.
    """
    handler = _get_handler(tool_name)
    
    # Build new arguments dict: remove 'action' key, apply any remaps
    orig_args = dict(params.arguments or {})
    orig_args.pop("action", None)
    
    if arg_remap:
        for src, dst in arg_remap.items():
            if src in orig_args:
                orig_args[dst] = orig_args.pop(src)

    # ── Canvas template data normalization (same as resolve_super_tool path) ──
    if tool_name == "bot_wonder_canvas_template":
        _TEMPLATE_META_KEYS = {"template", "transition", "layer"}
        data = orig_args.get("data")
        if not data or (isinstance(data, dict) and not data):
            extra = {k: v for k, v in orig_args.items() if k not in _TEMPLATE_META_KEYS}
            if extra:
                logger.info(
                    f"[_dispatch] Canvas template: wrapping {len(extra)} "
                    f"top-level args into 'data': {list(extra.keys())}"
                )
                orig_args["data"] = extra
                for k in extra:
                    del orig_args[k]
        if isinstance(orig_args.get("data"), str):
            try:
                import json as _json_d
                orig_args["data"] = _json_d.loads(orig_args["data"])
            except (ValueError, TypeError):
                logger.warning("[_dispatch] Canvas template: 'data' is string but not valid JSON")
    
    # Mutate params.arguments in place (handlers read from it)
    params.arguments = orig_args
    return await handler(params)


async def _dispatch_error(params: FunctionCallParams, msg: str):
    """Return an error via result_callback."""
    await params.result_callback(
        {"success": False, "error": msg},
        properties=FunctionCallResultProperties(run_llm=True),
    )


# ---------------------------------------------------------------------------
# 1. pearl_open — Opens/loads/shows things
# ---------------------------------------------------------------------------

OPEN_ACTION_MAP = {
    "agency": "bot_open_app",
    "studio": "bot_open_app",
    "creation_launchpad": "bot_open_app",
    "our_pearlos": "bot_open_app",
    "pulse": "bot_open_app",
    "notes": "bot_open_notes",
    "files": "bot_open_files",
    "filespace": "bot_open_files",
    "note": "bot_open_note",
    "news": "bot_open_news",
    "youtube": "bot_open_youtube",
    "terminal": "bot_open_terminal",
    "creation_engine": "bot_open_creation_engine",
    "canvas": "bot_wonder_canvas_scene",
    "canvas_article": "bot_canvas_show_article",
    "canvas_chart": "bot_canvas_show_chart",
    "canvas_file": "bot_canvas_show_file",
    "canvas_image": "bot_canvas_show_image",
    "canvas_table": "bot_canvas_show_table",
    "html_applet": "bot_load_html_applet",
}

OPEN_APP_ACTION_SLUGS = {
    "agency": "agency",
    "studio": "creation-launchpad",
    "creation_launchpad": "creation-launchpad",
    "our_pearlos": "our-pearlos",
    "pulse": "pulse",
}

# Arg remaps for open actions: super-tool param name → original handler param name
_OPEN_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "note": {"noteId": "note_id"},                                          # bot_open_note reads note_id
    "canvas": {"content": "html"},                                          # Wonder Canvas scene reads html/url
    "canvas_chart": {"chartType": "chart_type", "chartData": "chart_data"}, # bot_canvas_show_chart reads chart_type, chart_data
    "canvas_file": {"filePath": "file_path"},                               # bot_canvas_show_file reads file_path
    "canvas_image": {"imageUrl": "image_url"},                              # bot_canvas_show_image reads image_url
    "canvas_table": {"headers": "columns"},                                 # bot_canvas_show_table reads columns
    "html_applet": {"appId": "applet_id"},                                  # bot_load_html_applet reads applet_id
}

@bot_tool(
    name="pearl_open",
    description=(
        "Open/show things. Actions: agency, studio, creation_launchpad, our_pearlos, pulse, "
        "notes, files (query?), note (noteId/title), news, youtube (plain open only; "
        "if query/videoId is present this routes to YouTube search/play), terminal, "
        "creation_engine, canvas (content/url), canvas_article, "
        "canvas_chart (chartType,chartData), canvas_file (filePath), canvas_image "
        "(imageUrl), canvas_table (headers,rows), html_applet (appId)"
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(OPEN_ACTION_MAP.keys())},
            "noteId": {"type": "string"},
            "title": {"type": "string"},
            "query": {"type": "string"},
            "videoId": {"type": "string"},
            "content": {"type": "string"},
            "url": {"type": "string"},
            "data": {"type": "string"},
            "chartType": {"type": "string"},
            "chartData": {"type": "string"},
            "headers": {"type": "array", "items": {"type": "string"}},
            "rows": {"type": "array", "items": {"type": "array", "items": {"type": "string"}}},
            "caption": {"type": "string"},
            "filePath": {"type": "string"},
            "imageUrl": {"type": "string"},
            "appId": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_open(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    if action == "youtube":
        video_id = str((params.arguments or {}).get("videoId") or (params.arguments or {}).get("video_id") or "").strip()
        query = str((params.arguments or {}).get("query") or "").strip()
        if video_id:
            return await _dispatch(params, "bot_play_youtube_video", arg_remap={"videoId": "video_id"})
        if query:
            return await _dispatch(params, "bot_search_youtube_videos")
    tool_name = OPEN_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown open action: {action}")
    if tool_name == "bot_open_app":
        params.arguments = {
            **(params.arguments or {}),
            "app": OPEN_APP_ACTION_SLUGS.get(action, action),
        }
    remap = _OPEN_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 2. pearl_close — Closes things
# ---------------------------------------------------------------------------

CLOSE_ACTION_MAP = {
    "notes": "bot_close_notes",
    "youtube": "bot_close_youtube",
    "terminal": "bot_close_terminal",
    "creation_engine": "bot_close_applet_creation_engine",
    "canvas": "bot_wonder_canvas_clear",
    "browser": "bot_close_browser_window",
    "experience": "bot_dismiss_experience",
}

@bot_tool(
    name="pearl_close",
    description="Close things. Actions: notes, youtube, terminal, creation_engine, canvas, browser, experience",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(CLOSE_ACTION_MAP.keys())},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_close(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = CLOSE_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown close action: {action}")
    return await _dispatch(params, tool_name)


# ---------------------------------------------------------------------------
# 3. pearl_notes — All note operations
# ---------------------------------------------------------------------------

NOTES_ACTION_MAP = {
    "create": "bot_create_note",
    "read": "bot_read_current_note",
    "list": "bot_list_notes",
    "add_content": "bot_add_note_content",
    "remove_content": "bot_remove_note_content",
    "replace": "bot_replace_note",
    "replace_content": "bot_replace_note_content",
    "delete": "bot_delete_note",
    "highlight": "bot_highlight_note",
    "highlight_text": "bot_highlight_note_text",
    "clear_highlights": "bot_clear_note_highlights",
    "scroll": "bot_scroll_note",
    "navigate_heading": "bot_navigate_note_heading",
    "switch_mode": "bot_switch_note_mode",
    "save": "bot_save_note",
    "download": "bot_download_note",
    "back": "bot_back_to_notes",
}

# Arg remaps for notes actions: super-tool param name → original handler param name
_NOTES_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "delete": {"noteId": "note_id"},                          # bot_delete_note reads note_id
    "replace_content": {"search": "pattern"},                 # bot_replace_note_content reads pattern
    "remove_content": {"content": "pattern"},                 # bot_remove_note_content reads pattern
    "highlight": {"duration": "duration_seconds"},            # bot_highlight_note reads duration_seconds
}

@bot_tool(
    name="pearl_notes",
    description="Note operations. Actions: create (title,content,mode?), read, list, add_content (content,position?), remove_content (content), replace (content), replace_content (search,replace), delete (noteId?), highlight (text,color?,duration?), highlight_text (text), clear_highlights, scroll (position/section/search_text), navigate_heading (heading), switch_mode (mode), save, download, back. CRITICAL: When user dictates content for a note, always pass the full dictated text in the 'content' parameter — never create a note with empty content.",
    feature_flag="notes",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(NOTES_ACTION_MAP.keys())},
            "title": {"type": "string"},
            "content": {"type": "string"},
            "mode": {"type": "string"},
            "noteId": {"type": "string"},
            "position": {"type": "string"},
            "section": {"type": "string"},
            "search_text": {"type": "string"},
            "search": {"type": "string"},
            "replace": {"type": "string"},
            "text": {"type": "string"},
            "color": {"type": "string"},
            "duration": {"type": "number"},
            "heading": {"type": "string"},
        },
        "required": ["action"],
    },
)
async def pearl_notes(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = NOTES_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown notes action: {action}")
    remap = _NOTES_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 4. pearl_canvas — Wonder Canvas operations
# ---------------------------------------------------------------------------

CANVAS_ACTION_MAP = {
    "scene": "bot_wonder_canvas_scene",
    "template": "bot_wonder_canvas_template",
    "clear": "bot_wonder_canvas_clear",
    "animate": "bot_wonder_canvas_animate",
    "add_layer": "bot_wonder_canvas_add",
    "avatar_hint": "bot_wonder_canvas_avatar_hint",
}

# Arg remaps for canvas actions: super-tool param name → original handler param name
_CANVAS_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "template": {"name": "template"},   # super tool exposes 'name', handler reads 'template'
    "animate": {"target": "selector"},   # super tool exposes 'target', handler reads 'selector'
}

@bot_tool(
    name="pearl_canvas",
    description=(
        "Wonder Canvas visual display. Actions: "
        "template (name,data) — PREFERRED. Show pre-built visual templates. "
        "Canvas content must be specific to the user's current subject and visually useful; "
        "never show generic cards about 'game', 'video', or 'topic'. "
        "For complex visuals, a loading_card/progress_tracker may be shown first, "
        "then replace it with the final specific visual. "
        "Templates: person_bio, fact_card, news_headline, movie_card, weather_card, "
        "definition_card, book_card, recipe_card, location_card, image_showcase, "
        "comparison_table, timeline, stat_dashboard, list_card, countdown_timer, "
        "quiz_question, music_now_playing, achievement_unlocked, game_scoreboard, "
        "loading_card. Pass name=TEMPLATE_NAME, data={key:value} with template fields. "
        "Images: use /api/image?q=SUBJECT for photo_url/image_url. "
        "| scene (html) — raw HTML for unique creative visuals. "
        "| clear — ONLY when the user explicitly asks to clear, close, dismiss, or remove the canvas. "
        "Never use clear to refresh, retry, show, display, or push a visual; use template or scene instead. "
        "| animate (animation,target?,duration?) — animate elements. "
        "| add_layer (html,layer?) — add content to layer. "
        "| avatar_hint (hint) — set avatar mood."
    ),
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(CANVAS_ACTION_MAP.keys())},
            "html": {"type": "string"},
            "name": {"type": "string", "description": "Template name for action=template (e.g. person_bio, fact_card, news_headline)"},
            "data": {"type": "object", "description": "Template data as key-value pairs (e.g. {\"name\": \"Tim Cook\", \"title\": \"CEO\", \"bio\": \"...\", \"photo_url\": \"/api/image?q=Tim+Cook\"})"},
            "animation": {"type": "string"},
            "target": {"type": "string"},
            "duration": {"type": "number"},
            "layer": {"type": "string"},
            "hint": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_canvas(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = CANVAS_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown canvas action: {action}")
    # Remap super tool param names → original handler param names
    remap = _CANVAS_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 5. pearl_media — Soundtrack + YouTube control
# ---------------------------------------------------------------------------

MEDIA_ACTION_MAP = {
    "play_soundtrack": "bot_play_soundtrack",
    "stop_soundtrack": "bot_stop_soundtrack",
    "volume": "bot_set_soundtrack_volume",
    "adjust_volume": "bot_adjust_soundtrack_volume",
    "next_track": "bot_next_soundtrack_track",
    "get_current": "bot_get_current_soundtrack",
    "play_youtube": "bot_play_youtube_video",
    "pause_youtube": "bot_pause_youtube_video",
    "next_youtube": "bot_play_next_youtube_video",
    "search_youtube": "bot_search_youtube_videos",
}

# Arg remaps for media actions: super-tool param name → original handler param name
_MEDIA_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "volume": {"level": "volume"},           # super tool 'level' → handler 'volume'
    "adjust_volume": {"amount": "step"},     # super tool 'amount' → handler 'step'
    "play_youtube": {"videoId": "video_id"}, # super tool 'videoId' → handler 'video_id'
}

@bot_tool(
    name="pearl_media",
    description="Media control. Actions: play_soundtrack (genre?,mood?,query?), stop_soundtrack, volume (level), adjust_volume (direction,amount?), next_track, get_current, play_youtube (videoId?), pause_youtube, next_youtube, search_youtube (query)",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(MEDIA_ACTION_MAP.keys())},
            "genre": {"type": "string"},
            "mood": {"type": "string"},
            "query": {"type": "string"},
            "level": {"type": "number"},
            "direction": {"type": "string"},
            "amount": {"type": "number"},
            "videoId": {"type": "string"},
        },
        "required": ["action"],
    },
)
async def pearl_media(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = MEDIA_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown media action: {action}")
    remap = _MEDIA_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 6. pearl_search — Web search and fetch
# ---------------------------------------------------------------------------

SEARCH_ACTION_MAP = {
    "web": "bot_web_search",
    "fetch": "bot_web_fetch",
    "weather": "bot_get_weather",
    "news": "bot_get_news",
}

# Arg remaps for search actions: super-tool param name → original handler param name
_SEARCH_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "news": {"query": "topic"},  # super tool exposes 'query', bot_get_news reads 'topic'
}

@bot_tool(
    name="pearl_search",
    description="Search/fetch/info. Actions: web (query), fetch (url), weather (location), news (category?,query?)",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(SEARCH_ACTION_MAP.keys())},
            "query": {"type": "string"},
            "url": {"type": "string"},
            "location": {"type": "string"},
            "category": {"type": "string"},
        },
        "required": ["action"],
    },
)
async def pearl_search(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = SEARCH_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown search action: {action}")
    # Remap: pearl_search exposes 'query' but bot_get_news reads 'topic'
    remap = _SEARCH_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 7. pearl_system — System/meta operations
# ---------------------------------------------------------------------------

SYSTEM_ACTION_MAP = {
    "desktop_mode": "bot_switch_desktop_mode",
    "time": "bot_get_current_time",
    "think_deeply": "bot_think_deeply",
    "openclaw_task": "bot_openclaw_task",
    "look_at_user": "bot_look_at_user",
    "start_call": "bot_start_daily_call",
    "end_call": "bot_end_call",
    "summon_sprite": "bot_summon_sprite",
    "customize_interface": "bot_customize_interface",
    "list_sandbox_assets": "bot_list_sandbox_assets",
    "onboarding_progress": "bot_onboarding_progress",
    "onboarding_complete": "bot_onboarding_complete",
    "share_dialog": "bot_show_share_dialog",
    "update_profile": "bot_update_user_profile",
    "delete_profile_meta": "bot_delete_profile_metadata",
    "set_access_level": "bot_set_user_access_level",
    "upgrade_access": "bot_upgrade_user_access",
    "downgrade_access": "bot_downgrade_user_access",
}

# Arg remaps for system actions: super-tool param name → original handler param name
_SYSTEM_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "summon_sprite": {"spriteId": "prompt"},                  # bot_summon_sprite reads prompt (spriteId is wrong name)
    "set_access_level": {"level": "access_level", "userId": "user_email"},  # bot_set_user_access_level reads access_level, user_email
    "upgrade_access": {"userId": "user_email"},               # bot_upgrade_user_access reads user_email
    "downgrade_access": {"userId": "user_email"},             # bot_downgrade_user_access reads user_email
}

@bot_tool(
    name="pearl_system",
    description="System ops. Actions: desktop_mode (mode: use desktop for 'switch to desktop'; use home only when user says home), time, think_deeply (question), openclaw_task (task), look_at_user, start_call, end_call (reason?), summon_sprite (spriteId), customize_interface (theme,description,backgroundDescription,iconDescription,target,app), list_sandbox_assets (query? for custom themes/features), onboarding_progress, onboarding_complete, share_dialog, update_profile (key,value), delete_profile_meta (key), set_access_level (userId,level), upgrade_access (userId), downgrade_access (userId)",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(SYSTEM_ACTION_MAP.keys())},
            "mode": {"type": "string", "description": "Desktop mode. Use 'desktop' for 'switch to desktop' or 'desktop mode'; use 'home' only for explicit home requests."},
            "question": {"type": "string"},
            "task": {"type": "string"},
            "spriteId": {"type": "string"},
            "theme": {"type": "string", "description": "Built-in theme or custom theme ID from list_sandbox_assets."},
            "query": {"type": "string", "description": "Asset/theme search query for list_sandbox_assets, e.g. Jurassic Park."},
            "description": {"type": "string"},
            "backgroundDescription": {"type": "string"},
            "iconDescription": {"type": "string"},
            "target": {"type": "string", "enum": ["home", "desktop", "both"]},
            "app": {"type": "string"},
            "sourceImageUrl": {"type": "string"},
            "reason": {"type": "string"},
            "key": {"type": "string"},
            "value": {"type": "string"},
            "userId": {"type": "string"},
            "level": {"type": "string"},
        },
        "required": ["action"],
    },
)
async def pearl_system(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = SYSTEM_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown system action: {action}")
    remap = _SYSTEM_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 8. pearl_tasks — Task management
# ---------------------------------------------------------------------------

TASKS_ACTION_MAP = {
    "create": "bot_openclaw_task",
    "dispatch": "bot_openclaw_task",
    "start": "bot_openclaw_task",
    "list": "bot_list_tasks",
    "list_recent": "bot_list_recent_tasks",
    "stop": "bot_stop_task",
    "feedback": "bot_task_feedback",
    "thumbs_up": "bot_thumbs_up_task",
}

# Arg remaps for tasks actions: super-tool param name → original handler param name
_TASKS_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "create": {"description": "task"},
    "dispatch": {"description": "task"},
    "start": {"description": "task"},
    "stop": {"taskId": "task_label"},                         # bot_stop_task reads task_label
    "feedback": {"taskId": "task_id", "feedback": "feedback_text"},  # bot_task_feedback reads task_id, feedback_text
    "thumbs_up": {"taskId": "task_id"},                       # bot_thumbs_up_task reads task_id
}

@bot_tool(
    name="pearl_tasks",
    description="Task management and dispatch. Actions: create/dispatch/start (task or description), list, list_recent, stop (taskId), feedback (taskId,feedback), thumbs_up (taskId). Use create/dispatch/start for requester-scoped PearlOS self-evolution tasks; personal changes should target that user's sandbox, feature packages, artifacts, or ledger unless the protected shared-source release path is explicitly required.",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(TASKS_ACTION_MAP.keys())},
            "task": {"type": "string"},
            "description": {"type": "string"},
            "taskId": {"type": "string"},
            "feedback": {"type": "string"},
        },
        "required": ["action"],
    },
)
async def pearl_tasks(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = TASKS_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown tasks action: {action}")
    remap = _TASKS_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 9. pearl_apps — HTML app/applet creation and management
# ---------------------------------------------------------------------------

APPS_ACTION_MAP = {
    "create_html": "bot_create_html_content",
    "create_from_description": "bot_create_app_from_description",
    "create_from_note": "bot_create_app_from_note",
    "update": "bot_update_html_applet",
    "rollback": "bot_rollback_app",
    "share_applet": "bot_share_applet_with_user",
    "share_note": "bot_share_note_with_user",
}

# Arg remaps for apps actions: super-tool param name → original handler param name
_APPS_ARG_REMAPS: dict[str, dict[str, str] | None] = {
    "create_html": {"html": "html_content"},                  # bot_create_html_content reads html_content
    "create_from_note": {"noteId": "note_id"},                # bot_create_app_from_note reads note_id
    "update": {"appId": "applet_id"},                         # bot_update_html_applet reads applet_id
    "rollback": {"appId": "applet_id"},                       # bot_rollback_app reads applet_id
    "share_applet": {"appId": "applet_search_term", "userId": "target_user_email"},  # bot_share_applet_with_user
    "share_note": {"noteId": "note_search_term", "userId": "target_user_email"},     # bot_share_note_with_user
}

@bot_tool(
    name="pearl_apps",
    description="App/applet management. Actions: create_html (html,title?), create_from_description (description), create_from_note (noteId), update (appId,html?,css?,js?), rollback (appId), share_applet (appId,userId), share_note (noteId,userId)",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(APPS_ACTION_MAP.keys())},
            "html": {"type": "string"},
            "title": {"type": "string"},
            "css": {"type": "string"},
            "js": {"type": "string"},
            "description": {"type": "string"},
            "noteId": {"type": "string"},
            "appId": {"type": "string"},
            "userId": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_apps(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = APPS_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown apps action: {action}")
    remap = _APPS_ARG_REMAPS.get(action)
    return await _dispatch(params, tool_name, arg_remap=remap)


# ---------------------------------------------------------------------------
# 10. pearl_window — Window management
# ---------------------------------------------------------------------------

WINDOW_ACTION_MAP = {
    "maximize": "bot_maximize_window",
    "minimize": "bot_minimize_window",
    "restore": "bot_restore_window",
    "reset_position": "bot_reset_window_position",
    "snap_left": "bot_snap_window_left",
    "snap_right": "bot_snap_window_right",
    "switch_layout": "bot_switch_layout_mode",
}

@bot_tool(
    name="pearl_window",
    description="Window management. Actions: maximize, minimize, restore, reset_position, snap_left, snap_right, switch_layout (mode?)",
    feature_flag="maneuverableWindow",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(WINDOW_ACTION_MAP.keys())},
            "mode": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_window(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = WINDOW_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown window action: {action}")
    return await _dispatch(params, tool_name)


# ---------------------------------------------------------------------------
# 11. pearl_experience — Interactive HTML experiences on Stage
# ---------------------------------------------------------------------------

EXPERIENCE_ACTION_MAP = {
    "render": "bot_render_experience",
}

@bot_tool(
    name="pearl_experience",
    description="Interactive HTML experiences. Actions: render (html, css?, js?, transition?). Use pearl_close(action='experience') to dismiss.",
    feature_flag="experiences",
    parameters={
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(EXPERIENCE_ACTION_MAP.keys())},
            "html": {"type": "string"},
            "css": {"type": "string"},
            "js": {"type": "string"},
            "transition": {"type": "string"},
        },
        "required": ["action"],
    },
    passthrough=False,
)
async def pearl_experience(params: FunctionCallParams):
    action = (params.arguments or {}).get("action", "")
    tool_name = EXPERIENCE_ACTION_MAP.get(action)
    if not tool_name:
        return await _dispatch_error(params, f"Unknown experience action: {action}")
    return await _dispatch(params, tool_name)


# ---------------------------------------------------------------------------
# Registry of all super tools (for external import)
# ---------------------------------------------------------------------------

SUPER_TOOL_NAMES = [
    "pearl_open",
    "pearl_close",
    "pearl_notes",
    "pearl_canvas",
    "pearl_media",
    "pearl_search",
    "pearl_system",
    "pearl_tasks",
    "pearl_window",
    "pearl_experience",
    "pearl_apps",
]

# All action maps combined for reverse lookup
ALL_ACTION_MAPS = {
    "pearl_open": OPEN_ACTION_MAP,
    "pearl_close": CLOSE_ACTION_MAP,
    "pearl_notes": NOTES_ACTION_MAP,
    "pearl_canvas": CANVAS_ACTION_MAP,
    "pearl_media": MEDIA_ACTION_MAP,
    "pearl_search": SEARCH_ACTION_MAP,
    "pearl_system": SYSTEM_ACTION_MAP,
    "pearl_tasks": TASKS_ACTION_MAP,
    "pearl_window": WINDOW_ACTION_MAP,
    "pearl_experience": EXPERIENCE_ACTION_MAP,
    "pearl_apps": APPS_ACTION_MAP,
}


def get_super_tool_handlers() -> dict[str, Any]:
    """Return {tool_name: handler_func} for all super tools."""
    return {
        "pearl_open": pearl_open,
        "pearl_close": pearl_close,
        "pearl_notes": pearl_notes,
        "pearl_canvas": pearl_canvas,
        "pearl_media": pearl_media,
        "pearl_search": pearl_search,
        "pearl_system": pearl_system,
        "pearl_tasks": pearl_tasks,
        "pearl_window": pearl_window,
        "pearl_experience": pearl_experience,
        "pearl_apps": pearl_apps,
    }


# ---------------------------------------------------------------------------
# Resolve super tool → bot tool (used by HybridVoiceProcessor)
# ---------------------------------------------------------------------------

_ALL_ACTION_MAPS = ALL_ACTION_MAPS

# Consolidated arg remap registry: {super_tool_name: {action: {src_param: dst_param}}}
# IMPORTANT: Keep in sync with per-super-tool _*_ARG_REMAPS dicts above.
# This is used by resolve_super_tool() for the HybridVoiceProcessor path.
_ALL_ARG_REMAPS: dict[str, dict[str, dict[str, str]]] = {
    "pearl_open": {
        "note": {"noteId": "note_id"},
        "canvas_chart": {"chartType": "chart_type", "chartData": "chart_data"},
        "canvas_file": {"filePath": "file_path"},
        "canvas_image": {"imageUrl": "image_url"},
        "canvas_table": {"headers": "columns"},
        "html_applet": {"appId": "applet_id"},
    },
    "pearl_notes": {
        "delete": {"noteId": "note_id"},
        "replace_content": {"search": "pattern"},
        "remove_content": {"content": "pattern"},
        "highlight": {"duration": "duration_seconds"},
    },
    "pearl_canvas": {
        "template": {"name": "template"},
        "animate": {"target": "selector"},
    },
    "pearl_media": {
        "volume": {"level": "volume"},
        "adjust_volume": {"amount": "step"},
        "play_youtube": {"videoId": "video_id"},
    },
    "pearl_search": {
        "news": {"query": "topic"},
    },
    "pearl_system": {
        "summon_sprite": {"spriteId": "prompt"},
        "set_access_level": {"level": "access_level", "userId": "user_email"},
        "upgrade_access": {"userId": "user_email"},
        "downgrade_access": {"userId": "user_email"},
    },
    "pearl_tasks": {
        "stop": {"taskId": "task_label"},
        "feedback": {"taskId": "task_id", "feedback": "feedback_text"},
        "thumbs_up": {"taskId": "task_id"},
    },
    "pearl_apps": {
        "create_html": {"html": "html_content"},
        "create_from_note": {"noteId": "note_id"},
        "update": {"appId": "applet_id"},
        "rollback": {"appId": "applet_id"},
        "share_applet": {"appId": "applet_search_term", "userId": "target_user_email"},
        "share_note": {"noteId": "note_search_term", "userId": "target_user_email"},
    },
}


def resolve_super_tool(super_name: str, action: str, args: dict) -> tuple[str | None, dict]:
    """Resolve a pearl_* super tool call to the underlying bot_* tool name and args.

    Returns (bot_tool_name, cleaned_args) or (None, {}) if unknown.
    Applies arg remaps so the underlying handler receives correct parameter names.
    """
    action_map = _ALL_ACTION_MAPS.get(super_name)
    if not action_map:
        return None, {}
    bot_tool = action_map.get(action)
    if not bot_tool:
        return None, {}
    # Strip 'action' from args — the underlying tool doesn't expect it
    cleaned = {k: v for k, v in args.items() if k != "action"}
    # Apply arg remaps if any
    remaps = _ALL_ARG_REMAPS.get(super_name, {}).get(action)
    if remaps:
        for src, dst in remaps.items():
            if src in cleaned:
                cleaned[dst] = cleaned.pop(src)

    # ── Canvas template data normalization ──
    # The LLM sometimes passes template data fields as top-level args instead
    # of wrapped in a "data" object. Detect this and wrap them.
    if bot_tool == "bot_wonder_canvas_template":
        _TEMPLATE_META_KEYS = {"template", "transition", "layer"}
        data = cleaned.get("data")
        if not data or (isinstance(data, dict) and not data):
            # Check if there are extra keys that look like template data
            extra = {k: v for k, v in cleaned.items() if k not in _TEMPLATE_META_KEYS}
            if extra:
                logger.info(
                    f"[resolve_super_tool] Canvas template: wrapping {len(extra)} "
                    f"top-level args into 'data': {list(extra.keys())}"
                )
                cleaned["data"] = extra
                for k in extra:
                    del cleaned[k]
        # Also handle "data" passed as a JSON string (LLM serialization quirk)
        if isinstance(cleaned.get("data"), str):
            try:
                import json as _json
                cleaned["data"] = _json.loads(cleaned["data"])
            except (ValueError, TypeError):
                logger.warning("[resolve_super_tool] Canvas template: 'data' is a string but not valid JSON")

    return bot_tool, cleaned
