"""Bot tool schemas advertised to the web-chat LLM.

These are OpenAI-format tool schemas attached to every `/api/chat` request
sent through OpenClaw. The model emits `tool_calls` deltas; the browser
client (`chat-tool-handlers.ts`) executes them by hitting the Next.js
notes API and dispatching `NIA_EVENT_NOTE_OPEN` so Notes opens in the
split view.

Voice mode does NOT use this file. The voice toolbox is built by
`tools/discovery.py` from `@bot_tool` decorators and runs server-side
inside the Daily session.
"""
from __future__ import annotations

WEB_CHAT_BOT_TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "bot_onboarding_complete",
            "description": (
                "Mark onboarding as complete. Use only when the active onboarding "
                "prompt reaches its final completion step, or when the user asks "
                "to skip, stop, or says onboarding is already done."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {
                        "type": "string",
                        "enum": ["completed", "skip", "stop", "already_done"],
                        "description": "Why onboarding should end.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_onboarding_progress",
            "description": (
                "Record onboarding beat progress or required action completion. "
                "Use during onboarding after each beat, after profile information "
                "is saved, and after the welcome note exists."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "currentBeat": {
                        "type": "number",
                        "description": "The current onboarding beat number.",
                    },
                    "completedBeat": {
                        "type": "string",
                        "description": "The beat just completed, such as beat_1.",
                    },
                    "action": {
                        "type": "string",
                        "enum": ["profileUpdated", "welcomeNoteCreated"],
                        "description": "A required onboarding action that was just completed.",
                    },
                    "source": {
                        "type": "string",
                        "enum": ["text", "voice"],
                        "description": "The onboarding channel.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_web_search",
            "description": (
                "Fast web search for current information. Use this directly for latest, "
                "recent, today, news, current events, current product/company/person "
                "questions, or simple lookups that should be answered in chat. For news, "
                "politics, elections, conflicts, markets, and other current events, search "
                "for issue-level source material and then answer as a concise intelligence "
                "brief: what changed, why it matters, key actors, stakes, tensions, timeline, "
                "data points, and watch-next. Do not present raw search mechanics or a link "
                "list as the primary answer. Do not dispatch a background task for ordinary "
                "web search. If the user asks for a visual, timeline, infographic, chart, "
                "graph, map, ranked list, best-selling list, top list, most-popular list, "
                "or all-time list and you need search first, preserve that visual/ranked "
                "intent in the query text so the interface can render a canvas. Call this "
                "silently: do not emit visible pre-tool text like 'Let me look that up' or "
                "'I'll grab the data.' Never use this for "
                "PearlOS internal status, Agency health, "
                "task progress, stuck jobs, or queue diagnostics; use bot_list_tasks for "
                "those instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                    "count": {
                        "type": "integer",
                        "description": "Number of results to return, from 1 to 10. Default 5.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_web_fetch",
            "description": (
                "Fetch and read a specific public web page URL. Use after web search "
                "when the user needs details from a source."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Public http or https URL to fetch."},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_get_public_profile",
            "description": (
                "Read the signed-in user's PearlOS public profile fields. Use when "
                "the user asks what public profile info Pearl can see, asks to check "
                "their public profile, bio, interests, social links, location, "
                "profession, avatar, or whether their profile is public. This returns "
                "only publicPersona fields and never returns privateMemory."
            ),
            "parameters": {
                "type": "object",
                "properties": {},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_wonder_canvas_template",
            "description": (
                "Display a pre-built Wonder Canvas visual. Use for charts, cards, "
                "weather-style visuals, summaries, and quick visual answers. For pie "
                "charts use template='pie_chart' with data.slices=[{label,value}]. "
                "For bar charts use template='bar_chart' with data.bars=[{label,value}]. "
                "For timelines use template='timeline' or 'timeline_chart' with "
                "data.events=[{date,label,description}]. For ranked lists use list_card "
                "or comparison_bars-style data with ordered labels and values. Generate the data from the "
                "current user request and any current tool/search output; never use a "
                "fixed topic-specific answer payload."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "template": {
                        "type": "string",
                        "description": "Template name such as pie_chart, bar_chart, line_chart, fact_card, weather_card, galaxy.",
                    },
                    "data": {
                        "type": "object",
                        "description": "Template data. Chart templates use slices, bars, or points arrays.",
                    },
                    "transition": {
                        "type": "string",
                        "enum": ["fade", "slide-left", "slide-right", "instant", "dissolve"],
                    },
                },
                "required": ["template", "data"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_wonder_canvas_scene",
            "description": (
                "Display a custom Wonder Canvas scene from safe HTML or a URL. Prefer "
                "bot_wonder_canvas_template for charts and common visuals. The scene "
                "content must be generated for the current request and should complement "
                "the chat answer; never use a stored prewritten topic response."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "html": {"type": "string", "description": "HTML scene content."},
                    "css": {"type": "string", "description": "Optional CSS."},
                    "url": {"type": "string", "description": "Optional scene URL."},
                    "title": {"type": "string", "description": "Scene title."},
                    "transition": {"type": "string", "description": "Transition name."},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_wonder_canvas_clear",
            "description": "Clear or close the Wonder Canvas visual surface.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_create_note",
            "description": (
                "Create a new note in the user's workspace. Returns the note ID "
                "and opens the note in the split-view Notes panel. Call this "
                "whenever the user asks to capture something as a note, jot a "
                "list, save a draft, or take notes on a topic."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title for the new note.",
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "Optional initial markdown content. Leave empty for a blank note."
                        ),
                    },
                },
                "required": ["title"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_update_note",
            "description": (
                "Update the title or content of an existing note by ID. Use "
                "after the user has opened or just created a note and wants "
                "to edit it."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note_id": {
                        "type": "string",
                        "description": "The ID of the note to update.",
                    },
                    "title": {
                        "type": "string",
                        "description": "New title (optional).",
                    },
                    "content": {
                        "type": "string",
                        "description": "New full markdown content (optional).",
                    },
                },
                "required": ["note_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_note",
            "description": (
                "Open an existing note by ID or title in the split-view Notes panel. "
                "Use when the user asks to load, show, or pull up a specific note. "
                "When the user names a note, such as Pearl's Journal, pass the title."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "note_id": {
                        "type": "string",
                        "description": "The ID of the note to open, when already known.",
                    },
                    "title": {
                        "type": "string",
                        "description": "The exact or approximate note title to open when the ID is unknown.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_notes",
            "description": "Open the Notes app/panel in the web interface.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_files",
            "description": (
                "Open FileSpace. If the user describes files naturally, pass that "
                "description as query so Pearl can find and open the relevant folder."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural language file search, for example 'PNGs I made for that arcade game'.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_terminal",
            "description": "Open the terminal panel in the web interface.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_news",
            "description": "Open the News panel in the web interface.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Optional news category or topic.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_get_weather",
            "description": (
                "Get live weather for a city, address, or place and open the "
                "weather view in the web interface. Use this whenever the user "
                "asks for weather."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "City or place name, for example Boston, Orlando, or Tokyo.",
                    },
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_youtube",
            "description": "Open the YouTube panel in the web interface.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_open_creation_engine",
            "description": "Open the creation engine panel in the web interface.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_close_browser_window",
            "description": "Close one or more non-essential web interface windows.",
            "parameters": {
                "type": "object",
                "properties": {
                    "apps": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional app names to close, such as news, weather, browser, notes, terminal, or youtube.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_switch_desktop_mode",
            "description": "Switch PearlOS desktop mode, usually home or desktop.",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["home", "desktop", "work", "quiet", "creative", "focus", "relaxation", "gaming"],
                        "description": "Use desktop for 'switch to desktop'; use home only when the user explicitly says home.",
                    },
                },
                "required": ["mode"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_customize_interface",
            "description": (
                "Customize PearlOS appearance. Use for UI theme changes, home or desktop "
                "background requests, and desktop icon style swaps. Themes are pixel, "
                "glass, professional, calm, or custom theme IDs/names saved in the "
                "requester's PearlOS sandbox. Generated backgrounds/icons must use "
                "Pixel/Sprite assets only, not general image generation."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["background", "icons", "theme", "all"],
                        "description": "What to change.",
                    },
                    "theme": {
                        "type": "string",
                        "description": "Built-in theme, custom theme id, or custom theme name to apply when action is theme.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Style or scene description for generated Pixel/Sprite assets.",
                    },
                    "backgroundDescription": {
                        "type": "string",
                        "description": "Description for new home and desktop pixel-art backgrounds.",
                    },
                    "iconDescription": {
                        "type": "string",
                        "description": "Description for new pixel-art desktop icons.",
                    },
                    "target": {
                        "type": "string",
                        "enum": ["home", "desktop", "both"],
                        "description": "Background target when changing backgrounds.",
                    },
                    "app": {
                        "type": "string",
                        "description": "Optional app icon key to change, such as browser, notes, terminal, or settings.",
                    },
                    "sourceImageUrl": {
                        "type": "string",
                        "description": "Optional existing local image URL supplied by the user.",
                    },
                },
                "required": ["action"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_list_tasks",
            "description": (
                "Check PearlOS Agency/task queue status for the signed-in user. Use when "
                "the user asks whether Agency is working, why a task is taking long, what "
                "tasks are running, whether a generated artifact finished, or anything "
                "about PearlOS internal task progress. Do not use public web search for "
                "PearlOS internal task status."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional task title or natural-language filter, such as pixel art or agency audit.",
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum tasks per status bucket. Default 8.",
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "bot_openclaw_task",
            "description": (
                "Dispatch a background Claude CLI agent task through the PearlOS "
                "task system. Use only when the user explicitly asks for Agency/agent/"
                "background work, or when the request requires source edits, tests, "
                "deploy/rebuild/restart, staging log investigation with expected fixes, "
                "QA, or Discord follow-ups. Do not use for explanations, overviews, "
                "file summaries, code review, snippet help, or simple/current-info "
                "lookups; answer inline or use bot_web_search instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "task": {
                        "type": "string",
                        "description": "Clear task description for the background agent.",
                    },
                    "title": {
                        "type": "string",
                        "description": "Short visible title for the ActiveJobs card.",
                    },
                    "urgency": {
                        "type": "string",
                        "enum": ["normal", "urgent"],
                        "description": "Use urgent only when the user asks to start immediately or says it is time-sensitive.",
                    },
                    "execute": {
                        "type": "boolean",
                        "description": "Whether to start Claude CLI immediately. Defaults to true.",
                    },
                },
                "required": ["task"],
            },
        },
    },
]
