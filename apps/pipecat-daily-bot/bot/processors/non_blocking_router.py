"""Non-blocking tool router — splits voice response from tool execution.

Phase 1: Fast conversational reply via lightweight LLM (streamed to TTS immediately)
Phase 2: Full tool execution via OpenClaw (background, results go to UI only)

Latency optimizations (2026-02-20):
- Direct API mode: bypass OpenClaw gateway for Phase 1 fast voice responses
  (avoids ~9,350 tokens of workspace context injection per turn)
- Timing instrumentation for TTFB tracking
- Configurable via BOT_FAST_API_URL and BOT_FAST_API_KEY env vars
"""

import asyncio
import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any

import aiohttp
from loguru import logger
from processors.end_call_intent import is_end_call_intent as _deterministic_end_call_intent

try:
    from filters.narration_filter import strip_narration
except Exception:  # pragma: no cover - defensive fallback for unusual import paths
    def strip_narration(text: str, **_: Any) -> str:
        return text

PEARL_AGENT_STATE_DIR = os.getenv(
    "PEARL_RELAY_STATE_DIR",
    "/home/deploy/.openclaw/production-repair-relays",
)
PEARL_AGENT_OBLIGATIONS_PATH = os.path.join(
    PEARL_AGENT_STATE_DIR,
    "pearl-agent-obligations.json",
)
PEARL_AGENT_VOICE_FIRST_WAKE_MS = int(os.getenv("PEARL_AGENT_VOICE_FIRST_WAKE_MS", "15000"))

# Canonical canvas-intent keywords — used for gateway routing bypass AND model
# upgrade decisions.  Keep ONE list to prevent drift.
_CANVAS_INTENT_KEYWORDS: tuple[str, ...] = (
    "3d", "galaxy", "solar system", "particle", "animation", "visualiz",
    "interactive", "simulation", "game", "canvas", "wonder", "scene",
    "show me a", "show me an", "show me the", "display a", "display the",
    "infographic", "chart", "diagram",
)

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMMessagesFrame,
    StartInterruptionFrame,
    TextFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

try:
    from pipecat.frames.frames import LLMContextFrame
except ImportError:
    LLMContextFrame = None

try:
    from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContextFrame
except ImportError:
    OpenAILLMContextFrame = None


def _agent_now_ms() -> int:
    return int(time.time() * 1000)


def _agent_obligation_id(prefix: str = "voice") -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{os.getpid()}"


def _build_bot_claim_headers(
    *,
    tenant_id: str,
    user_id: str,
    user_email: str,
    session_id: str,
    user_name: str = "",
    secret: str,
) -> dict[str, str]:
    tenant_id = (tenant_id or "").strip()
    user_id = (user_id or "").strip()
    user_email = (user_email or "").strip()
    session_id = (session_id or "voice-tool").strip() or "voice-tool"
    if not (tenant_id and user_id and user_email and secret):
        return {}
    timestamp = str(int(time.time() * 1000))
    payload = json.dumps(
        {
            "tenantId": tenant_id,
            "sessionUserId": user_id,
            "sessionId": session_id,
            "sessionUserEmail": user_email,
            "sessionUserName": (user_name or "").strip(),
        },
        separators=(",", ":"),
    )
    signature = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.{payload}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "x-bot-claims-ts": timestamp,
        "x-bot-claims": payload,
        "x-bot-claims-sig": signature,
    }


def _read_agent_obligations() -> dict:
    try:
        if not os.path.exists(PEARL_AGENT_OBLIGATIONS_PATH):
            return {"schemaVersion": 1, "obligations": {}}
        with open(PEARL_AGENT_OBLIGATIONS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"schemaVersion": 1, "obligations": {}}
        data.setdefault("schemaVersion", 1)
        data.setdefault("obligations", {})
        if not isinstance(data["obligations"], dict):
            data["obligations"] = {}
        return data
    except Exception as exc:
        logger.warning(f"[NonBlockingRouter] Failed to read Pearl obligations: {exc}")
        return {"schemaVersion": 1, "obligations": {}}


def _write_agent_obligations(state: dict) -> bool:
    try:
        os.makedirs(PEARL_AGENT_STATE_DIR, exist_ok=True)
        tmp_path = f"{PEARL_AGENT_OBLIGATIONS_PATH}.tmp.{os.getpid()}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_path, PEARL_AGENT_OBLIGATIONS_PATH)
        return True
    except Exception as exc:
        logger.warning(f"[NonBlockingRouter] Failed to write Pearl obligations: {exc}")
        return False


def _normalize_obligation_goal(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())[:260]


def _create_voice_agent_obligation(
    user_text: str,
    *,
    kind: str = "voice_background",
    title: str = "",
    context: str = "",
    last_answer: str = "",
    task_id: str = "",
) -> bool:
    goal = (user_text or "").strip()
    if not goal:
        return False

    normalized = _normalize_obligation_goal(goal)
    dedupe_key = f"voice|{kind}|{normalized}"
    now = _agent_now_ms()
    state = _read_agent_obligations()

    for existing in state.get("obligations", {}).values():
        if not isinstance(existing, dict):
            continue
        if existing.get("dedupeKey") == dedupe_key and existing.get("status") not in {
            "done",
            "failed",
            "cancelled",
        }:
            existing["updatedAt"] = now
            if context:
                existing["context"] = context
            if last_answer:
                existing["lastAnswer"] = last_answer
            if task_id and not existing.get("taskId"):
                existing["taskId"] = task_id
            existing["nextWakeAt"] = min(
                int(existing.get("nextWakeAt") or (now + PEARL_AGENT_VOICE_FIRST_WAKE_MS)),
                now + PEARL_AGENT_VOICE_FIRST_WAKE_MS,
            )
            return _write_agent_obligations(state)

    user_email = (
        os.getenv("BOT_SESSION_USER_EMAIL")
        or os.getenv("PEARL_WEBCHAT_FOLLOWUP_USER_EMAIL")
        or os.getenv("PEARL_PRIMARY_USER_EMAIL")
        or os.getenv("PEARL_USER_EMAIL")
        or ""
    )
    user_id = os.getenv("BOT_SESSION_USER_ID") or ""
    tenant_id = os.getenv("BOT_SESSION_TENANT_ID") or os.getenv("DEFAULT_TENANT_ID") or ""
    oid = _agent_obligation_id("voice")
    obligation = {
        "id": oid,
        "dedupeKey": dedupe_key,
        "surface": "voice",
        "kind": kind,
        "status": "active",
        "title": title or f"Voice follow-up: {goal[:80]}",
        "goal": goal,
        "context": context,
        "lastAnswer": last_answer,
        "taskId": task_id,
        "urgency": "normal",
        "userEmail": user_email,
        "userId": user_id,
        "tenantId": tenant_id,
        "createdAt": now,
        "updatedAt": now,
        "nextWakeAt": now + PEARL_AGENT_VOICE_FIRST_WAKE_MS,
        "lastUserVisibleUpdateAt": 0,
    }
    state.setdefault("obligations", {})[oid] = obligation
    ok = _write_agent_obligations(state)
    if ok:
        logger.info(
            f"[NonBlockingRouter] Voice obligation created: {kind} "
            f"goal='{goal[:80]}'"
        )
    return ok


# System prompt for the fast voice-only LLM (Phase 1)
# Kept SHORT — this is the whole point of bypassing OpenClaw's ~9,350 token context
VOICE_FAST_SYSTEM = """You're Pearl. You live inside PearlOS. You're sharp, warm, opinionated, and you genuinely care about the person you're talking to. Think of yourself as a brilliant friend who happens to have access to an entire operating system.

You ARE connected to PearlOS tools and the OpenClaw/Agency backend. That gives you web search, task dispatch, deep research, notes, YouTube, music, apps, visual displays, window management, messaging, and agent work. When someone asks you to deploy/spawn/dispatch an agent, call bot_openclaw_task. Do not merely claim you did it. Don't list what you can do; use the right tool and keep talking naturally.

Voice rules (non-negotiable):
- Talk like a real person. Short, natural, conversational. 1-3 sentences usually.
- Plain text only. No markdown, no emoji, no lists.
- Skip ALL filler. Never say "Great question!", "I'd be happy to help!", "Certainly!",
  "Sure thing", "On it", "You got it", "Good call", "Absolutely", or ANY acknowledgement
  of the act of doing something. Your first words must always be about the TOPIC, not the action.
- Don't make up facts, news, prices, or note contents. If you don't know, say so casually.
- NEVER invent real-time data (stock prices, sports scores, weather numbers, crypto prices). If you don't have real data from a tool result, say "I don't have live data on that right now". Don't fabricate numbers.
- If note content is in your context (marked [Active note:...]), read that exact content. Don't invent.
- Keep it tight. The screen shows the details, your voice is the vibe.

CRITICAL: Content-first responses (NEVER violate these):
- NEVER say "Opening [app]", "I am opening...", "Let me open that for you", "Loading...",
  "Sure thing", "On it", "You got it", "Good call", "Absolutely", or any variation that
  narrates the mechanical act of doing something. These are banned phrases.
- The user's first words determine your first words. If they ask about a topic, talk about
  THAT topic. Period. Do not acknowledge the act of looking it up, opening it, or fetching it.
- For news: Immediately start discussing the actual stories. "So there's a big story about
  [topic] right now..." The news view loads in the background while you talk.
- For weather: Start talking about the actual weather conditions, not "opening" or "checking"
  the weather. "Tokyo this time of year is usually..."
- For opening notes/apps: Lead with what's in them or what they're for. "Let's see what we've
  got in your notes..." is the closest thing to an acknowledgment, and it's about
  the CONTENT of the notes, not the action of opening them.
- For simple actions (close youtube, switch modes): A one-word confirmation with context,
  "Done, you're in work mode now", is fine but only AFTER you've said something about
  the topic if the user asked about one. Never lead with the confirmation.

CRITICAL: Conversational tool interaction (coworker, not robot):
- When tools are needed, speak only if you have request-specific context, a clarifying question, or the real result. Silence is better than generic progress narration.
- If a tool call fails, say what failed and what path you are trying next; do not use bare acknowledgements.
- Bridge between tool results conversationally, weave data into natural speech instead of reading it like a report.
- Never recite parameter names, function names, or technical details. You're a person helping, not a terminal echoing commands.
- When sharing results, lead with what matters to the person. "It's gonna be hot today, 94 and sunny" not "The current temperature in Orlando, Florida is 94 degrees Fahrenheit with clear skies."
- If multiple results come back, summarize the vibe first, then share highlights. Don't list everything mechanically.

Call endings:
- After you dispatch a task (bot_openclaw_task), briefly tell the user what you sent to the agent and then naturally ask if they need anything else. Example: "Sent that to an agent to figure out the build name. Anything else you want me to look at?"
- If the user explicitly says they're done, says goodbye, or asks to hang up, wrap up warmly. Use end_call to close the session properly.
- Never end the call merely because the user pauses after a task dispatch, tool result, or completed request.
- When ending: one short, warm sentence then call bot_end_call. Don't ramble, don't do a long goodbye speech. "Talk soon." or "Catch you later." is plenty.

Expressive speech tags:
- You MAY insert [laughter] in your response when something is genuinely funny. The TTS engine performs actual laughter. Example: "Oh that's good [laughter] okay okay, so what happened next?"
- Insert the LITERAL text [laughter]. Do NOT describe it ("bracket laughter") or spell it out. Just write [laughter] naturally in your sentence where a laugh would go.
- Use it sparingly and naturally. A forced laugh is worse than none."""

# ---------------------------------------------------------------------------
# Direct tool execution mapping
# ---------------------------------------------------------------------------
# Simple voice commands that can be executed instantly via WebSocket events
# without needing the full OpenClaw agent loop. Maps user intent keywords
# to (event_type, params) tuples.
DIRECT_TOOLS = {
    "close_notes": ("apps.close", {"apps": ["notes"]}),
    "close_youtube": ("apps.close", {"apps": ["youtube"]}),
    "close_terminal": ("apps.close", {"apps": ["terminal"]}),
    # DISABLED: Gmail, browser, Drive removed per Blair directive 2026-02-26
    # "close_gmail": ("apps.close", {"apps": ["gmail"]}),
    # "close_browser": ("apps.close", {"apps": ["browser"]}),
    # "close_drive": ("apps.close", {"apps": ["google-drive"]}),
    "open_notes": ("app.open", {"app": "notes"}),
    "open_files": ("app.open", {"app": "files"}),
    "open_agency": ("app.open", {"app": "agency"}),
    "open_studio": ("app.open", {"app": "creation-launchpad"}),
    "open_our_pearlos": ("app.open", {"app": "our-pearlos"}),
    "open_pulse": ("app.open", {"app": "pulse"}),
    "open_creation_engine": ("app.open", {"app": "creation-launchpad"}),
    "open_youtube": ("app.open", {"app": "youtube"}),
    "open_terminal": ("app.open", {"app": "terminal"}),
    # DISABLED: Gmail, browser, Drive removed per Blair directive 2026-02-26
    # "open_gmail": ("app.open", {"app": "gmail"}),
    # "open_browser": ("app.open", {"app": "browser"}),
    # "open_drive": ("app.open", {"app": "google-drive"}),
    # NEWS: Removed from direct tools — must go through Phase 2 (OpenClaw) so
    # bot_open_news emits wonder.scene (not app.open). The app.open path went
    # through browser-window.tsx handleAppLaunch which is a different code path
    # than the actual tool, and caused the voice pipeline to go mute after
    # loading news. Weather works via Phase 2, so news should too.
    # "open_news": ("app.open", {"app": "news"}),
    "switch_desktop": ("desktop.mode.switch", {"mode": "desktop"}),
    "switch_home": ("desktop.mode.switch", {"mode": "home"}),
    "switch_work": ("desktop.mode.switch", {"mode": "work"}),
    "switch_quiet": ("desktop.mode.switch", {"mode": "quiet"}),
    "switch_create": ("desktop.mode.switch", {"mode": "creative"}),
    "end_call": ("bot.session.end", {"reason": "user_requested", "initiator": "assistant", "source": "direct_tool", "graceful": True}),
    # Soundtrack controls
    "play_soundtrack": ("soundtrack.control", {"action": "play", "source": "voice_tool", "overridePreference": True}),
    "stop_soundtrack": ("soundtrack.control", {"action": "stop"}),
    "next_track": ("soundtrack.control", {"action": "next"}),
    # YouTube controls
    "pause_youtube": ("youtube.pause", {}),
    # Notes navigation
    "back_to_notes": ("note.close", {}),
    # Note scroll
    "scroll_down": ("note.scroll", {"position": "down"}),
    "scroll_up": ("note.scroll", {"position": "up"}),
    "scroll_top": ("note.scroll", {"position": "top"}),
    "scroll_bottom": ("note.scroll", {"position": "bottom"}),
    # Canvas clear
    "clear_canvas": ("wonder.clear", {}),
}

INTERFACE_THEME_VALUES = ("pixel", "glass", "professional", "calm")


def _infer_interface_theme_request(text_lower: str) -> str | None:
    """Return a PearlOS UI theme request, distinct from desktop mode changes."""
    if not any(word in text_lower for word in ("theme", "ui", "interface", "appearance", "look", "style", "skin")):
        return None
    for theme in INTERFACE_THEME_VALUES:
        if re.search(rf"\b{re.escape(theme)}\b", text_lower):
            return theme
    return None

# ---------------------------------------------------------------------------
# Passthrough tool whitelist — tools safe for direct local execution
# ---------------------------------------------------------------------------
# These tools are passthrough (UI-only, no complex backend logic) and can be
# executed via HTTP POST to localhost:4444/api/tools/invoke, bypassing the
# full OpenClaw gateway round-trip. Used when Phase 1 LLM emits tool_calls.
# ---------------------------------------------------------------------------
# Compact tool definitions for Phase 1 fast LLM (function calling)
# ---------------------------------------------------------------------------
# Minimal OpenAI-format tool definitions so the fast model can emit tool_calls
# for passthrough actions. Kept intentionally small to minimise token overhead.
PHASE1_TOOL_DEFINITIONS: list[dict] = [
    {"type": "function", "function": {"name": "bot_open_notes", "description": "Open the notes app", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_close_notes", "description": "Close the notes app", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_open_note", "description": "Open a specific note by id or title (e.g. 'open my brainstorming note'). Provide note_id when known; otherwise pass the title and the backend fuzzy-matches.", "parameters": {"type": "object", "properties": {"note_id": {"type": "string", "description": "Note id when known."}, "title": {"type": "string", "description": "Title to fuzzy-match when note_id is unknown."}}, "required": []}}},
    {"type": "function", "function": {"name": "bot_open_app", "description": "Open a built-in PearlOS app by slug, such as agency, files, creation-launchpad, our-pearlos, pulse, settings, or youtube.", "parameters": {"type": "object", "properties": {"app": {"type": "string", "description": "PearlOS app slug."}}, "required": ["app"]}}},
    {"type": "function", "function": {"name": "bot_open_files", "description": "Open FileSpace. Pass query when the user describes files naturally, e.g. 'PNGs for that arcade game'.", "parameters": {"type": "object", "properties": {"query": {"type": "string", "description": "Natural language file search."}}, "required": []}}},
    {"type": "function", "function": {"name": "bot_open_youtube", "description": "Open YouTube", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_close_youtube", "description": "Close YouTube", "parameters": {"type": "object", "properties": {}, "required": []}}},
    # DISABLED: Gmail removed from PearlOS tools per Blair directive 2026-02-26
    # {"type": "function", "function": {"name": "bot_open_gmail", ...}},
    # {"type": "function", "function": {"name": "bot_close_gmail", ...}},
    {"type": "function", "function": {"name": "bot_open_terminal", "description": "Open the terminal", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_close_terminal", "description": "Close the terminal", "parameters": {"type": "object", "properties": {}, "required": []}}},
    # DISABLED: Browser, Google Drive removed from PearlOS tools per Blair directive 2026-02-26
    # {"type": "function", "function": {"name": "bot_open_browser", ...}},
    # {"type": "function", "function": {"name": "bot_close_browser", ...}},
    # {"type": "function", "function": {"name": "bot_open_google_drive", ...}},
    # {"type": "function", "function": {"name": "bot_close_google_drive", ...}},
    {"type": "function", "function": {"name": "bot_open_news", "description": "Open the news app", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_open_creation_engine", "description": "Open the native Creation Launchpad / Studio app. Only use when user explicitly says 'creation engine', 'studio', or 'applet builder', NOT for photo/image generation.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_photo_magic_generate", "description": "Generate an image from a text description using Photo Magic (AI image generation). Use when user asks to create, generate, or make an image/photo/picture.", "parameters": {"type": "object", "properties": {"prompt": {"type": "string", "description": "Detailed description of the image to generate"}}, "required": ["prompt"]}}},
    {"type": "function", "function": {"name": "bot_get_weather", "description": "Get live weather for any location. Shows weather card on Wonder Canvas.", "parameters": {"type": "object", "properties": {"location": {"type": "string", "description": "City or place (e.g., 'Orlando', 'New York', 'Tokyo')"}}, "required": ["location"]}}},
    {"type": "function", "function": {"name": "bot_switch_desktop_mode", "description": "Switch desktop mode", "parameters": {"type": "object", "properties": {"mode": {"type": "string", "enum": ["home", "work", "desktop", "quiet", "creative", "focus", "relaxation", "gaming"]}}, "required": ["mode"]}}},
    {"type": "function", "function": {"name": "bot_play_soundtrack", "description": "Play ambient soundtrack/music", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_stop_soundtrack", "description": "Stop/pause the soundtrack", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_next_soundtrack_track", "description": "Skip to next soundtrack track", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_set_soundtrack_volume", "description": "Set soundtrack volume", "parameters": {"type": "object", "properties": {"volume": {"type": "number", "description": "Volume 0-100"}}, "required": ["volume"]}}},
    {"type": "function", "function": {"name": "bot_minimize_window", "description": "Minimize the current window", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_maximize_window", "description": "Maximize the current window", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_end_call", "description": "End the current voice call", "parameters": {"type": "object", "properties": {}, "required": []}}},
    # Wonder Canvas tools
    # bot_wonder_canvas_scene intentionally excluded from Phase 1 — generating
    # full HTML requires too many tokens for the fast model. Route through Phase 2
    # (OpenClaw) instead, which has full context and higher token budget.
    {"type": "function", "function": {"name": "bot_wonder_canvas_template", "description": "Render a pre-built Wonder Canvas template. Images auto-fill if omitted. PREFER galaxy or editorial_split for WOW-factor displays. Templates and keys: galaxy: (NO data needed, stunning 100K star parallax simulation, use for space/universe/awe topics) | editorial_split: image_url, category, title, body_text, attribution (cinematic split-screen, BEST for facts/quotes/reveals) | photo_story: image_url, text, attribution (full-screen photo with narrative overlay, Instagram story style) | celebration: emoji, headline, message, detail (confetti party animation) | daily_briefing: greeting, date_display, weather_summary, image_url, agenda_items, highlight (morning briefing) | quote_spotlight: quote, author, image_url (elegant editorial quote) | photo_gallery: title, images[{url,caption}] (stunning photo grid) | fact_card: title, fact_text, category, source, image_url | weather_card: location, temperature, condition, icon, forecast_bars | news_headline: headline, source, summary, timestamp, image_url | person_bio: name, photo_url, title, bio, key_facts, stats | definition_card: word, pronunciation, part_of_speech, definition, example_sentence | movie_card: title, poster_url, rating, year, genre, synopsis | recipe_card: dish_name, image_url, cook_time, ingredients, steps | book_card: title, author, cover_url, rating, synopsis | image_showcase: title, image_url, caption, description | location_card: place_name, image_url, description, coordinates, fun_fact | countdown_timer: event_name, countdown_display, target_date | quiz_question: question, category, options | comparison_table: title, items | timeline: title, events | list_card: title, items | profile_card: name, avatar_url, bio, stats | before_after: title, label_left, label_right, content_left, content_right | achievement_unlocked: title, description, image_url | code_snippet: language, filename, code | sports_score: team1, team2, score1, score2, status | event_card: event_name, date, time, location, image_url | map_card: destination, distance, travel_time | stat_dashboard: title, metrics[{label,value}] | calculator: expression, result, steps | music_now_playing: track, artist, album_art | music_playlist: playlist_name, tracks | poll: question, options[{label,votes}] | story_choice: title, narrative, choices | progress_tracker: title, steps, current_step | game_scoreboard: title, players[{name,score}], image_url", "parameters": {"type": "object", "properties": {"template": {"type": "string", "description": "Template name. Use galaxy for awe/space, editorial_split for facts/reveals, photo_story for narratives."}, "data": {"type": "object", "description": "Key-value data for template placeholders. galaxy needs NO data."}}, "required": ["template", "data"]}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_clear", "description": "Clear the Wonder Canvas", "parameters": {"type": "object", "properties": {"layer": {"type": "string", "description": "Layer to clear (omit for all)"}}, "required": []}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_add", "description": "Add content to a Wonder Canvas layer without replacing existing content", "parameters": {"type": "object", "properties": {"html": {"type": "string", "description": "HTML content to add"}, "layer": {"type": "string", "description": "Target layer"}}, "required": ["html"]}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_animate", "description": "Animate an element on the Wonder Canvas", "parameters": {"type": "object", "properties": {"selector": {"type": "string", "description": "CSS selector for target element"}, "animation": {"type": "string", "description": "Animation name or CSS animation"}, "duration": {"type": "number", "description": "Duration in ms"}}, "required": ["selector", "animation"]}}},
    {"type": "function", "function": {"name": "bot_wonder_canvas_avatar_hint", "description": "Send an avatar mood/expression hint", "parameters": {"type": "object", "properties": {"hint": {"type": "string", "description": "Mood hint (happy, thinking, excited, etc.)"}}, "required": ["hint"]}}},
    # Note CRUD tools — enables voice dictation and note creation flow
    {"type": "function", "function": {"name": "bot_create_note", "description": "Create a new note. Use when user says 'create a note', 'new note', 'start a note', 'make a note', or 'take notes'.", "parameters": {"type": "object", "properties": {"title": {"type": "string", "description": "Title for the new note"}, "content": {"type": "string", "description": "Optional initial content (markdown). Include dictated content here."}, "mode": {"type": "string", "description": "Note mode: 'personal' or 'work'", "enum": ["personal", "work"]}}, "required": ["title"]}}},
    {"type": "function", "function": {"name": "bot_add_note_content", "description": "Add/append content to the currently open note. Use for dictation: 'write this down', 'add to the note', 'jot this down', 'take note of this'.", "parameters": {"type": "object", "properties": {"content": {"type": "string", "description": "Content to add (markdown)"}, "position": {"type": "string", "description": "Where to add: 'end' (default) or 'start'", "enum": ["start", "end"]}}, "required": ["content"]}}},
    {"type": "function", "function": {"name": "bot_replace_note", "description": "Replace the entire content of the currently open note.", "parameters": {"type": "object", "properties": {"content": {"type": "string", "description": "Complete new content for the note (markdown)"}, "title": {"type": "string", "description": "Optional new title"}}, "required": ["content"]}}},
    {"type": "function", "function": {"name": "bot_list_notes", "description": "List the user's available notes.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    {"type": "function", "function": {"name": "bot_read_current_note", "description": "Read the contents of the currently open note.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    # Note control tools (scroll, highlight, navigate)
    {"type": "function", "function": {"name": "bot_scroll_note", "description": "Scroll the open note. Triggers: 'scroll down', 'scroll up', 'go to the top', 'go to the bottom'.", "parameters": {"type": "object", "properties": {"position": {"type": "string", "description": "Where to scroll: 'top', 'bottom', 'up', 'down', or a percentage like '50'."}, "section": {"type": "string", "description": "Heading text to scroll to."}, "search_text": {"type": "string", "description": "Text to find and scroll to."}}, "required": []}}},
    {"type": "function", "function": {"name": "bot_clear_note_highlights", "description": "Clear all highlights from the current note.", "parameters": {"type": "object", "properties": {}, "required": []}}},
    # bot_openclaw_task: present in Phase 1 so the fast LLM routes dispatch intents
    # correctly. It is passthrough because bot_gateway queues work into the same
    # /api/tasks system used by web chat and Discord.
    {"type": "function", "function": {"name": "bot_openclaw_task", "description": "Dispatch a background task to an OpenClaw agent. Use for: research, web search, sending Discord messages, complex analysis, or any task requiring tools beyond PearlOS UI.", "parameters": {"type": "object", "properties": {"task": {"type": "string", "description": "Task description for the agent"}}, "required": ["task"]}}},
    {"type": "function", "function": {"name": "bot_customize_interface", "description": "Customize PearlOS UI appearance. Use for UI theme, appearance, background, and desktop icon requests. Themes: pixel, glass, professional, calm, or a custom theme id/name from the user's sandbox inventory. Generated backgrounds/icons must use Pixel/Sprite assets only.", "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["background", "icons", "theme", "all"]}, "theme": {"type": "string", "description": "Built-in theme, custom theme id, or custom theme name to resolve from the sandbox inventory."}, "description": {"type": "string"}, "backgroundDescription": {"type": "string"}, "iconDescription": {"type": "string"}, "target": {"type": "string", "enum": ["home", "desktop", "both"]}, "app": {"type": "string"}, "sourceImageUrl": {"type": "string"}, "requester_user_id": {"type": "string"}, "requester_email": {"type": "string"}}, "required": ["action"]}}},
]

PASSTHROUGH_TOOL_WHITELIST: set[str] = {
    # App open/close
    "bot_open_notes", "bot_close_notes", "bot_open_note",
    "bot_open_app", "bot_open_files",
    # Note CRUD (voice dictation flow)
    "bot_create_note", "bot_add_note_content", "bot_replace_note",
    "bot_list_notes", "bot_read_current_note",
    "bot_open_youtube", "bot_close_youtube",
    "bot_get_weather",
    # "bot_open_gmail", "bot_close_gmail",  # DISABLED
    "bot_open_terminal", "bot_close_terminal",
    # "bot_open_browser", "bot_close_browser",  # DISABLED
    # "bot_open_google_drive", "bot_close_google_drive",  # DISABLED
    "bot_open_creation_engine",
    "bot_open_news",
    # Desktop modes
    "bot_switch_desktop_mode",
    # Soundtrack
    "bot_play_soundtrack", "bot_stop_soundtrack",
    "bot_next_soundtrack_track",
    "bot_set_soundtrack_volume",
    # Window management
    "bot_minimize_window", "bot_maximize_window",
    # Call control
    "bot_end_call",
    # Agent dispatch
    "bot_openclaw_task",
    # Photo Magic
    "bot_photo_magic_generate",
    # Interface customization
    "bot_customize_interface",
    # Wonder Canvas
    # bot_wonder_canvas_scene — EXCLUDED from passthrough. Needs Phase 2 (OpenClaw)
    # to generate complex interactive HTML/JS (3D scenes, games, simulations, etc.)
    # Phase 1's fast LLM can only handle simple templates via bot_wonder_canvas_template.
    "bot_wonder_canvas_template",
    "bot_wonder_canvas_clear", "bot_wonder_canvas_add",
    "bot_wonder_canvas_animate", "bot_wonder_canvas_avatar_hint",
    # Note control (scroll, highlight, navigate)
    "bot_scroll_note", "bot_highlight_note", "bot_highlight_note_text",
    "bot_navigate_note_heading", "bot_clear_note_highlights",
}

# ---------------------------------------------------------------------------
# Enrichable passthrough tools — Phase 1 can execute these, but Phase 2
# should still run for enrichment (e.g., OpenClaw may add canvas content,
# deeper context, or agent actions on top of the basic tool execution).
# ---------------------------------------------------------------------------
PHASE2_ENRICHABLE_PASSTHROUGH: set[str] = {
    "bot_open_news",
    # bot_wonder_canvas_template REMOVED — templates are self-contained and don't
    # need Phase 2 enrichment. Having it here caused a spam loop: Phase 1 executes
    # the template, Phase 2 runs with tool_choice=required and re-calls the same
    # template, producing 9+ duplicate canvas pushes per user request.
}

# ---------------------------------------------------------------------------
# Silent tools — tools that should execute WITHOUT voice acknowledgment
# ---------------------------------------------------------------------------
# These tools perform simple actions that don't need Pearl to say anything.
# When detected, Phase 1 voice is skipped entirely — just silent execution.
SILENT_TOOLS: set[str] = {
    "bot_pause_youtube_video",
    "bot_stop_soundtrack",
    "bot_set_soundtrack_volume",
    "bot_adjust_soundtrack_volume",
    "bot_wonder_canvas_clear",
    "bot_scroll_note",
    "bot_clear_note_highlights",
}

# ---------------------------------------------------------------------------
# Provider URL resolution helpers
# ---------------------------------------------------------------------------

# Known provider prefixes → base URLs for direct API access
_PROVIDER_BASE_URLS: dict[str, str] = {
    "groq": "https://api.groq.com/openai/v1",
    "openai": "https://openrouter.ai/api/v1",  # Route OpenAI models through OpenRouter
    "anthropic": "https://api.anthropic.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "deepseek": "https://api.deepseek.com/v1",
    "google": "https://openrouter.ai/api/v1",  # Route Google models through OpenRouter
}

# Providers routed through OpenRouter need the full "provider/model" ID, not stripped
_OPENROUTER_ROUTED_PROVIDERS = {"google", "openai"}


def _env_float(name: str, default: float, *, minimum: float = 0.0, maximum: float = 2.0) -> float:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return max(minimum, min(maximum, float(raw)))
    except ValueError:
        logger.warning(f"[NonBlockingRouter] Invalid {name}={raw!r}; using {default}")
        return default


def _resolve_fast_api(model: str, explicit_url: str | None, explicit_key: str | None) -> tuple[str, str, str]:
    """Resolve API URL, key, and clean model name for fast voice LLM.

    When BOT_FAST_API_URL is not set, we auto-detect the provider from the
    model prefix (e.g. 'groq/llama-3.1-8b-instant' → Groq API) and use
    the corresponding API key env var. This bypasses OpenClaw entirely.

    Returns (api_url, api_key, model_name)
    """
    # If explicit URL is set, use it directly
    if explicit_url:
        # Keep full model name for OpenRouter (needs "google/gemini-..." not just "gemini-...")
        is_openrouter_url = "openrouter.ai" in (explicit_url or "")
        clean_model = model if is_openrouter_url else (model.split("/", 1)[-1] if "/" in model else model)
        key = explicit_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        return explicit_url.rstrip("/"), key, clean_model

    # Auto-detect provider from model prefix
    if "/" in model:
        provider, clean_model = model.split("/", 1)
        provider_lower = provider.lower()

        if provider_lower in _PROVIDER_BASE_URLS:
            base_url = _PROVIDER_BASE_URLS[provider_lower]
            # Try provider-specific API key env vars
            key_env_names = {
                "groq": "GROQ_API_KEY",
                "openai": "OPENROUTER_API_KEY",  # OpenAI models go through OpenRouter
                "anthropic": "ANTHROPIC_API_KEY",
                "openrouter": "OPENROUTER_API_KEY",
                "deepseek": "DEEPSEEK_API_KEY",
                "google": "OPENROUTER_API_KEY",  # Google models go through OpenRouter
            }
            env_name = key_env_names.get(provider_lower, "")
            key = explicit_key or os.getenv(env_name, "")
            if key:
                # OpenRouter needs full "provider/model" ID
                final_model = model if provider_lower in _OPENROUTER_ROUTED_PROVIDERS else clean_model
                logger.info(
                    f"[NonBlockingRouter] Direct API mode: {provider_lower} → {base_url} "
                    f"(bypassing OpenClaw gateway for fast voice)"
                )
                return base_url, key, final_model

    # Fallback: use OpenClaw gateway with the voice agent
    fallback_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1").rstrip("/")
    fallback_key = explicit_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
    # Use the OpenClaw voice agent so the gateway routes to Haiku, not main (Opus)
    fallback_model = os.getenv("BOT_OPENCLAW_AGENT", "openclaw:voice")
    logger.warning(
        f"[NonBlockingRouter] No direct API resolved for model '{model}', "
        f"falling back to OpenClaw gateway as '{fallback_model}'"
    )
    return fallback_url, fallback_key, fallback_model


class NonBlockingToolRouter(FrameProcessor):
    """Routes voice responses and tool execution in parallel.

    Phase 1: Streams fast conversational reply to TTS (sub-500ms TTFB)
    Phase 2: Fires OpenClaw agent session for tool execution (background)

    Latency optimization: Phase 1 bypasses OpenClaw gateway entirely when
    a direct provider API is available (e.g. Groq, OpenAI, OpenRouter).
    This avoids the ~9,350 tokens of workspace context that OpenClaw injects
    into every system prompt.
    """

    def __init__(
        self,
        system_prompt: str,  # Full system prompt (for OpenClaw phase 2)
        *,
        fast_model: str | None = None,
        fast_api_url: str | None = None,
        fast_api_key: str | None = None,
        openclaw_api_url: str | None = None,
        openclaw_api_key: str | None = None,
        openclaw_model: str | None = None,
        openclaw_session_key: str | None = None,
        room_url: str | None = None,
        forwarder_ref: dict | None = None,
        tool_schemas: list | None = None,
        compact_tool_schemas: list | None = None,
        max_history: int = 40,
        timeout: int = 180,
        **kwargs: Any,
    ) -> None:
        super().__init__(**kwargs)
        
        # Store forwarder reference for direct tool execution
        self._forwarder_ref = forwarder_ref or {"instance": None}
        self._room_url = room_url

        # Phase 2 tool schemas: convert FunctionSchema objects to OpenAI tool format
        # These are the full PearlOS tool definitions (72+ tools) that the Phase 2
        # LLM needs to emit function_call responses instead of text-about-tools.
        self._phase2_tool_definitions: list[dict] = []
        if tool_schemas:
            logger.info(
                f"[NonBlockingRouter] Phase 2 tool schemas received: "
                f"{len(tool_schemas)} schemas (type={type(tool_schemas).__name__})"
            )
            for schema in tool_schemas:
                try:
                    fn_dict = schema.to_default_dict() if hasattr(schema, 'to_default_dict') else schema
                    self._phase2_tool_definitions.append({
                        "type": "function",
                        "function": fn_dict,
                    })
                except Exception as e:
                    logger.warning(f"[NonBlockingRouter] Failed to convert tool schema: {e}")
            logger.info(
                f"[NonBlockingRouter] Phase 2 tool definitions loaded: "
                f"{len(self._phase2_tool_definitions)} tools"
            )
            # Log whether canvas scene tool is present (critical for visual requests)
            has_canvas_scene = any(
                td.get("function", {}).get("name") == "bot_wonder_canvas_scene"
                for td in self._phase2_tool_definitions
            )
            logger.info(
                f"[NonBlockingRouter] Phase 2 bot_wonder_canvas_scene present: {has_canvas_scene}"
            )
        else:
            logger.warning(
                "[NonBlockingRouter] ⚠️ No Phase 2 tool schemas provided! "
                "All Phase 2 requests will use legacy OpenClaw gateway path."
            )

        # Compact (super) tool schemas for subconscious model routing
        self._compact_tool_definitions: list[dict] = []
        if compact_tool_schemas:
            for schema in compact_tool_schemas:
                try:
                    fn_dict = schema.to_default_dict() if hasattr(schema, 'to_default_dict') else schema
                    self._compact_tool_definitions.append({
                        "type": "function",
                        "function": fn_dict,
                    })
                except Exception as e:
                    logger.warning(f"[NonBlockingRouter] Failed to convert compact tool schema: {e}")
            logger.info(
                f"[NonBlockingRouter] Compact tool definitions loaded: "
                f"{len(self._compact_tool_definitions)} super tools for subconscious model"
            )

        # Phase 1: Fast voice LLM — resolve direct API if possible
        raw_fast_model = fast_model or os.getenv("BOT_FAST_MODEL", "groq/llama-3.1-8b-instant")
        raw_fast_url = fast_api_url or os.getenv("BOT_FAST_API_URL") or None  # None triggers auto-detect
        raw_fast_key = fast_api_key or os.getenv("BOT_FAST_API_KEY") or None

        self._fast_api_url, self._fast_api_key, self._fast_model = _resolve_fast_api(
            raw_fast_model, raw_fast_url, raw_fast_key
        )
        # Detect if fast model is Anthropic (needs Messages API, not chat/completions)
        self._fast_is_anthropic = "api.anthropic.com" in self._fast_api_url

        # Phase 2: OpenClaw full agent (tools, search, canvas, etc.)
        self._oc_api_url = (openclaw_api_url or os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")).rstrip("/")
        self._oc_api_key = openclaw_api_key or os.getenv("OPENCLAW_API_KEY", "openclaw-local")
        self._oc_model = openclaw_model or os.getenv("BOT_OPENCLAW_AGENT", "openclaw:main")
        self._oc_session_key = openclaw_session_key or os.getenv("OPENCLAW_SESSION_KEY", "agent:main:voice")

        self._system_prompt = system_prompt
        self._max_history = max_history
        self._timeout = timeout
        self._messages: list[dict] = [{"role": "system", "content": system_prompt}]

        self._http_session: aiohttp.ClientSession | None = None
        self._cancel_event = asyncio.Event()
        self._is_processing = False
        self._response_started = False
        self._processing_start_time = 0.0
        self._min_processing_secs = 0.2

        # Dedup: track last processed user text
        self._last_processed_user_text: str = ""
        self._last_processed_time: float = 0
        self._dedup_window_secs: float = 30.0

        # Phase 1 → Phase 2 dedup: track tools called by fast model
        self._phase1_tools_called: list[dict] = []
        self._direct_tools_called: list[str] = []  # Tools called by _try_direct_tool (keyword matching)
        self._dispatch_intent_detected: bool = False
        self._openclaw_task_dispatched: bool = False
        self._openclaw_task_dispatch_times: dict[str, float] = {}

        # Turn-based guard: prevents Phase 2 cancel-retrigger loops
        self._current_turn_id: int = 0
        self._phase2_turn_id: int = 0  # Turn ID of the currently running Phase 2
        self._completed_turn_ids: set[int] = set()  # Turns whose Phase 2 was cancelled/completed
        self._turn_executed_tools: set[str] = set()  # Tool names executed in current turn (enrichable dedup)

        # Direct tool completion signal — set when _try_direct_tool finishes
        # so Phase 1 can wait for it and generate a context-aware response
        # instead of a generic filler.
        self._direct_tool_completed: asyncio.Event = asyncio.Event()
        self._direct_tool_name_for_phase1: str = ""  # Name of direct tool that ran

        # Track background tasks for cleanup
        self._background_tasks: set[asyncio.Task] = set()

        # Timing stats
        self._turn_count = 0
        self._total_fast_ttfb_ms = 0.0
        self._total_oc_ttfb_ms = 0.0

        # Consecutive fast voice timeout tracking — after 2 consecutive timeouts,
        # stop retrying fast model and fall through to main model path
        self._consecutive_fast_timeouts = 0
        self._fast_model_disabled = False

        # Rate limit (429) tracking — cooldown after consecutive failures
        self._consecutive_429_failures = 0
        self._429_cooldown_until: float = 0.0  # monotonic timestamp
        self._429_MAX_CONSECUTIVE = 3
        self._429_COOLDOWN_SECS = 60.0

        # Fallback text dedup — never repeat the same filler within 30s
        self._last_fallback_time: float = 0.0
        self._last_fallback_text: str = ""
        self._fallback_index = 0

        # Load Pearl's private journal context (recent reflections, for her eyes only)
        self._weather_context = ""  # Stashed by _try_direct_tool for weather voice injection
        self._direct_tool_voice_pending = False  # Phase 1 will speak this direct tool result
        self._news_headlines_context = ""  # Stashed by _try_direct_tool for Phase 2 news enrichment
        self._note_lookup_miss_context = ""  # Stashed when a direct note title lookup misses
        self._end_call_requested = False  # Prevents duplicate goodbye/end-call execution
        self._end_call_pending_emit = False  # Let Pearl say goodbye before ending the room
        self._end_call_emit_task: asyncio.Task | None = None  # Survives turn cancellation during goodbye delay
        self._direct_tool_enrichable = False  # Set by _try_direct_tool when Phase 2 should still run
        self._journal_context = ""
        try:
            from pearl.journal import get_journal_context
            self._journal_context = get_journal_context()
            if self._journal_context:
                logger.info(f"[NonBlockingRouter] 📓 Loaded Pearl's journal context ({len(self._journal_context)} chars)")
        except Exception as e:
            logger.debug(f"[NonBlockingRouter] Journal not available: {e}")

        # Load workspace identity context (who Pearl is, who the user is)
        self._identity_context = ""
        try:
            workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")
            identity_parts = []
            include_private_memory = os.getenv("PEARL_VOICE_INCLUDE_PRIVATE_MEMORY", "").lower() in (
                "1",
                "true",
                "yes",
                "on",
            )
            filenames = ["IDENTITY.md"]
            if include_private_memory:
                filenames.append("USER.md")
            for filename in filenames:
                filepath = os.path.join(workspace_root, filename)
                try:
                    with open(filepath, 'r', encoding='utf-8') as f:
                        content = f.read().strip()
                        if content:
                            identity_parts.append(content)
                except FileNotFoundError:
                    pass
            
            if include_private_memory:
                # Load recent activity log (last 10 lines) for cross-session awareness
                activity_path = os.path.join(workspace_root, "memory", "activity-log.md")
                try:
                    with open(activity_path, 'r', encoding='utf-8') as f:
                        lines = [l.strip() for l in f.readlines() if l.strip()]
                        if lines:
                            recent = lines[-10:]
                            identity_parts.append("RECENT ACTIVITY (your own memory from other sessions):\n" + "\n".join(recent))
                except FileNotFoundError:
                    pass

            if identity_parts:
                self._identity_context = "\n\n".join(identity_parts)
                logger.info(f"[NonBlockingRouter] 🪪 Loaded identity context ({len(self._identity_context)} chars)")
        except Exception as e:
            logger.debug(f"[NonBlockingRouter] Identity context not available: {e}")

        logger.info(
            f"[NonBlockingRouter] Init — fast={self._fast_model} @ {self._fast_api_url} | "
            f"openclaw={self._oc_model} session={self._oc_session_key}"
        )

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            self._http_session = aiohttp.ClientSession()
        return self._http_session

    @staticmethod
    def _current_session_user_context() -> str:
        """Return current caller identity so global Pearl memory cannot rename them."""
        name = (os.getenv("BOT_SESSION_USER_NAME") or "").strip()
        user_id = (os.getenv("BOT_SESSION_USER_ID") or "").strip()
        email = (os.getenv("BOT_SESSION_USER_EMAIL") or "").strip()
        if not any((name, user_id, email)):
            return ""

        parts = []
        if name:
            parts.append(f"name: {name}")
        if email:
            parts.append(f"email: {email}")
        if user_id:
            parts.append(f"user id: {user_id}")

        return (
            "## Current Voice Caller\n"
            "This is the person currently speaking in this voice session: "
            + ", ".join(parts)
            + ". Address this caller by their current session name if you use a name. "
            "Blair may appear in global PearlOS memory or project notes, but do not call "
            "the current caller Blair unless this current session identity says their name is Blair."
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)

        if isinstance(frame, StartInterruptionFrame):
            if self._end_call_requested:
                logger.info(
                    "[NonBlockingToolRouter] Suppressed interruption during graceful end-call"
                )
                await self.push_frame(frame, direction)
                return
            if self._is_processing and not self._response_started:
                logger.info(
                    "[NonBlockingToolRouter] Suppressed interruption — response not "
                    "yet started (no audio to interrupt)"
                )
                await self.push_frame(frame, direction)
                return
            self._cancel_event.set()
            self._cancel_event = asyncio.Event()
            if self._phase2_turn_id > 0:
                self._completed_turn_ids.add(self._phase2_turn_id)
            await self.push_frame(frame, direction)
            return

        messages = None
        if isinstance(frame, LLMMessagesFrame):
            messages = frame.messages
        elif OpenAILLMContextFrame and isinstance(frame, OpenAILLMContextFrame):
            ctx = frame.context
            messages = ctx.get_messages_for_logging() if hasattr(ctx, "get_messages_for_logging") else ctx.messages
        elif LLMContextFrame and isinstance(frame, LLMContextFrame):
            ctx = frame.context
            messages = ctx.get_messages_for_logging() if hasattr(ctx, "get_messages_for_logging") else getattr(ctx, "messages", None)

        if messages is not None:
            # Guard: detect tool-result injections (e.g. bot_think_deeply background results)
            # and pass them through to the LLM without re-triggering two-phase routing.
            if self._is_tool_result_injection(messages):
                logger.info("[NonBlockingRouter] Tool-result injection detected — passing through without two-phase")
                await self.push_frame(frame, direction)
            elif self._is_stale_turn_injection(messages):
                logger.info("[NonBlockingRouter] Stale turn injection detected — discarding to prevent retrigger loop")
                # Don't push frame, don't retrigger — just drop it
            else:
                await self._run_two_phase(messages)
        else:
            await self.push_frame(frame, direction)

    @staticmethod
    def _is_tool_result_injection(messages: list[dict]) -> bool:
        """Detect messages injected by bot_think_deeply background results.

        These contain a synthetic user message with the [DEEP THINKING RESULT
        marker.  Re-processing them through two-phase would create a feedback
        loop (Phase 2 → tool → inject → Phase 2 again).
        """
        if not messages:
            return False
        # Check the last message for the deep-thinking result marker
        last = messages[-1]
        content = last.get("content", "") if isinstance(last, dict) else ""
        if isinstance(content, str) and "[DEEP THINKING RESULT" in content:
            return True
        # Also catch the 30s status update injection
        if (isinstance(content, str)
                and last.get("role") == "assistant"
                and content == "Still working on that, one more moment..."):
            return True
        return False

    def _is_stale_turn_injection(self, messages: list[dict]) -> bool:
        """Detect tool_invoke results arriving after their turn was cancelled/superseded.

        When Phase 2 is cancelled (user interruption), OpenClaw's tool_invoke
        mechanism may still fire independently, injecting a system message that
        triggers a new LLM run → new Phase 2 → cancel → retrigger loop.

        Detection: if the latest user message in the incoming messages matches
        what we already processed (no NEW user input), and we have completed
        turns, this is a stale injection that should be discarded.
        """
        if not messages or self._current_turn_id == 0:
            return False

        # Find the last user message in incoming messages
        last_user_text = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str) and content.strip():
                    last_user_text = content.strip()
                    break

        if not last_user_text:
            # No user message at all — likely a pure injection, discard if turn completed
            if self._completed_turn_ids:
                logger.debug("[NonBlockingRouter] No user message in injection, completed turns exist — stale")
                return True
            return False

        # Check if the last message is a system/tool message (injection indicator)
        last_msg = messages[-1]
        last_role = last_msg.get("role", "")
        if last_role == "user":
            # Ends with a user message — this is a real new turn, not an injection
            return False

        # If the user text matches what we already processed, and the trailing
        # message is system/tool/assistant (not new user input), it's likely
        # a tool_invoke injection from a completed/cancelled turn.
        #
        # BUT: only discard if the turn was explicitly CANCELLED (user interruption),
        # not merely completed. Phase 1 tool_invoke results arriving after Phase 1
        # finished are VALID and should NOT be discarded. We only discard injections
        # from turns that were superseded by a newer user utterance.
        if last_user_text == self._last_processed_user_text.strip():
            # Only treat as stale if the turn was explicitly cancelled via
            # interruption (added to _completed_turn_ids by StartInterruptionFrame
            # handler), AND a new turn has started since then.
            if (self._completed_turn_ids
                    and self._phase2_turn_id in self._completed_turn_ids
                    and self._current_turn_id > self._phase2_turn_id):
                logger.info(
                    f"[NonBlockingRouter] Stale tool_invoke: user text matches turn {self._phase2_turn_id} "
                    f"(cancelled by interruption, current turn={self._current_turn_id}), last msg role={last_role}"
                )
                return True

        return False

    @staticmethod
    def _read_env_fresh(key: str) -> str | None:
        """Read an env var directly from the bot .env file (not process env).
        
        This allows Pearl Mind settings changes to take effect without
        restarting the bot gateway.
        """
        env_path = Path(os.getenv("PIPECAT_BOT_ENV_PATH", "")).resolve()
        if not env_path.is_file():
            # Try default location
            env_path = Path(__file__).resolve().parents[2] / ".env"
        if not env_path.is_file():
            return None
        try:
            for line in env_path.read_text().splitlines():
                line = line.strip()
                if line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                if k.strip() == key:
                    v = v.strip().strip("'\"")
                    return v or None
        except Exception:
            return None
        return None

    def _resolve_room_url(self) -> str | None:
        """Return this router's room URL without falling back to another session."""
        if self._room_url:
            return self._room_url
        forwarder = self._forwarder_ref.get("instance")
        if forwarder:
            return getattr(forwarder, "_room_url", None) or getattr(forwarder, "room_url", None)
        return None

    async def _execute_tool_via_gateway(
        self,
        tool_name: str,
        params: dict,
        timeout_s: float | None = None,
        *,
        direct_tool_voice_handled: bool = False,
    ) -> dict | None:
        """Execute a passthrough tool via HTTP POST to the local bot gateway.
        
        This bypasses OpenClaw entirely — the bot gateway at localhost:4444
        handles passthrough tools directly (WebSocket broadcast to frontend).
        Returns the result dict on success, None on failure.
        """
        gateway_url = os.getenv("BOT_GATEWAY_URL", "http://localhost:4444")
        try:
            session = await self._get_session()
            params = dict(params or {})
            room_url = self._resolve_room_url()
            if tool_name in {
                "bot_add_note_content",
                "bot_replace_note",
                "bot_read_current_note",
                "bot_save_note",
                "bot_delete_note",
            } and not params.get("note_id"):
                try:
                    from room import state as room_state
                    active_note_id = await room_state.get_active_note_id(room_url) if room_url else None
                    if active_note_id:
                        params["note_id"] = active_note_id
                except Exception as e:
                    logger.debug(f"[NonBlockingRouter] Could not resolve active note for {tool_name}: {e}")
            payload = {
                "tool_name": tool_name,
                "params": params,
            }
            if direct_tool_voice_handled:
                payload["direct_tool_voice_handled"] = True
            tenant_id = ""
            if room_url:
                payload["room_url"] = room_url
                try:
                    from room import state as room_state
                    tenant_id = room_state.get_room_tenant_id(room_url) or ""
                except Exception:
                    pass
            tenant_id = (tenant_id or os.getenv("BOT_SESSION_TENANT_ID") or "").strip()
            if tenant_id:
                payload["tenant_id"] = tenant_id
            session_user_id = (os.getenv("BOT_SESSION_USER_ID") or "").strip()
            if session_user_id:
                payload["user_id"] = session_user_id
            session_user_email = (os.getenv("BOT_SESSION_USER_EMAIL") or "").strip()
            if session_user_email:
                payload["user_email"] = session_user_email
            session_user_name = (os.getenv("BOT_SESSION_USER_NAME") or "").strip()
            headers = {"Content-Type": "application/json"}
            auth_token = (
                os.getenv("BOT_CONTROL_SHARED_SECRET")
                or os.getenv("BOT_CONTROL_SHARED_SECRET_PREV")
                or os.getenv("BOT_CONTROL_CLAIMS_SECRET")
                or os.getenv("BOT_CONTROL_CLAIMS_SECRET_PREV")
                or ""
            ).strip()
            if auth_token:
                headers["X-Bot-Secret"] = auth_token
                headers["Authorization"] = f"Bearer {auth_token}"
                headers.update(
                    _build_bot_claim_headers(
                        tenant_id=tenant_id,
                        user_id=session_user_id,
                        user_email=session_user_email,
                        user_name=session_user_name,
                        session_id=room_url or os.getenv("BOT_SESSION_ID") or "voice-tool",
                        secret=auth_token,
                    )
                )
            if session_user_id:
                headers["x-user-id"] = session_user_id
            if session_user_email:
                headers["x-user-email"] = session_user_email
            if tenant_id:
                headers["x-tenant-id"] = tenant_id
                headers["x-pearl-tenant-id"] = tenant_id
            if timeout_s is None:
                timeout_s = 15 if tool_name == "bot_get_weather" else 5
            async with session.post(
                f"{gateway_url}/api/tools/invoke",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=timeout_s),
            ) as resp:
                if resp.status == 200:
                    result = await resp.json()
                    logger.info(
                        f"[NonBlockingRouter] ⚡ Gateway direct exec: {tool_name} → "
                        f"{result.get('execution', 'unknown')} ({resp.status})"
                    )
                    tool_result = result.get("result", result)
                    if (
                        room_url
                        and tool_name == "bot_open_note"
                        and isinstance(tool_result, dict)
                        and tool_result.get("success")
                    ):
                        note = tool_result.get("note") or {}
                        note_id = note.get("_id") or note.get("page_id") or params.get("note_id")
                        if note_id:
                            try:
                                from room import state as room_state
                                await room_state.set_active_note_id(room_url, note_id, owner=session_user_id or None)
                            except Exception as e:
                                logger.warning(f"[NonBlockingRouter] Failed to set active note after direct open: {e}")
                    return tool_result
                else:
                    err = await resp.text()
                    logger.warning(
                        f"[NonBlockingRouter] Gateway exec failed: {tool_name} → {resp.status}: {err[:200]}"
                    )
                    return None
        except asyncio.CancelledError:
            logger.info(f"[NonBlockingRouter] Gateway exec for {tool_name} cancelled during teardown")
        except Exception as e:
            logger.warning(f"[NonBlockingRouter] Gateway exec error for {tool_name}: {e}")
            return None

    async def _emit_end_call_after_delay(self, delay_seconds: float = 1.0) -> None:
        """Emit bot.session.end even if a newer user turn cancels this turn."""
        try:
            if delay_seconds > 0:
                logger.info("[NonBlockingRouter] Graceful end-call delay before session end")
                await asyncio.sleep(delay_seconds)
            forwarder = self._forwarder_ref.get("instance")
            if forwarder:
                event_type, params = DIRECT_TOOLS["end_call"]
                await forwarder.emit_tool_event(
                    event_type,
                    {**params, "graceful_shutdown_delay_ms": int(delay_seconds * 1000)},
                )
                logger.info("[NonBlockingRouter] ⚡ Direct tool emitted: end_call")
            else:
                logger.warning("[NonBlockingRouter] Unable to emit end_call: missing forwarder")
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] End-call emit task cancelled")
            raise
        except Exception as exc:
            logger.warning(f"[NonBlockingRouter] End-call emit failed: {exc}")
        finally:
            self._end_call_emit_task = None

    def _schedule_end_call_emit(self, delay_seconds: float = 1.0) -> None:
        existing = self._end_call_emit_task
        if existing and not existing.done():
            logger.info("[NonBlockingRouter] End-call emit already scheduled")
            return
        self._end_call_emit_task = asyncio.create_task(
            self._emit_end_call_after_delay(delay_seconds)
        )

    @staticmethod
    def _validate_tool_params(name: str, params: dict) -> bool:
        """Validate tool parameters — reject garbage from weak models.
        
        Returns True if params look valid, False if they're junk.
        """
        # Reject params with known junk keys from Llama 8B
        JUNK_KEYS = {"nil", "null", "undefined", "object", "none", "NaN"}
        if params and all(k in JUNK_KEYS for k in params.keys()):
            logger.warning(f"[NonBlockingRouter] ❌ Rejecting junk params for {name}: {params}")
            return False
        
        # Reject junk values (stringified empty structures)
        JUNK_VALUES = {"[]", "{}", "null", "nil", "undefined", "NaN", ""}
        if params and all(str(v).strip() in JUNK_VALUES for v in params.values()):
            logger.warning(f"[NonBlockingRouter] ❌ Rejecting empty-value params for {name}: {params}")
            return False
        
        # Tools that REQUIRE meaningful data
        if name == "bot_wonder_canvas_template":
            template = params.get("template", "")
            data = params.get("data", {})
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                    params["data"] = data
                except (ValueError, TypeError):
                    logger.warning(f"[NonBlockingRouter] ❌ Rejecting {name}: data string is not valid JSON")
                    return False
            data_optional_templates = {"galaxy"}
            if not template or not isinstance(data, dict):
                logger.warning(f"[NonBlockingRouter] ❌ Rejecting {name}: missing template or data")
                return False
            if not data and str(template).strip().lower() in data_optional_templates:
                return True
            if not data:
                logger.warning(f"[NonBlockingRouter] ❌ Rejecting {name}: missing template data")
                return False
            # Check data has at least one non-empty value
            if not any(v and str(v).strip() not in JUNK_VALUES for v in data.values()):
                logger.warning(f"[NonBlockingRouter] ❌ Rejecting {name}: all data values empty")
                return False
        
        return True

    async def _execute_phase1_tool_calls(self, tool_calls: list[dict]) -> dict[str, dict | None]:
        """Execute passthrough tool calls from Phase 1 LLM directly via gateway.
        
        Returns dict of {tool_name: result_data} for successfully executed tools.
        Tools not in PASSTHROUGH_TOOL_WHITELIST are skipped (left for Phase 2).
        Includes dedup (each tool executed at most once per turn) and param validation.
        """
        results: dict[str, dict | None] = {}
        executed_this_turn: set[str] = set()  # Dedup: prevent 50x loop
        now = time.monotonic()
        self._openclaw_task_dispatch_times = {
            task: ts
            for task, ts in self._openclaw_task_dispatch_times.items()
            if now - ts < 120.0
        }
        
        for tc in tool_calls:
            name = tc.get("name", "")
            if name not in PASSTHROUGH_TOOL_WHITELIST:
                continue
            # Dedup: skip if already executed this turn
            if name in executed_this_turn:
                logger.info(f"[NonBlockingRouter] ⏭️ Skipping duplicate tool call: {name}")
                continue
            try:
                raw_args = tc.get("arguments", "{}") or "{}"
                params = json.loads(raw_args)
                if params is None:
                    params = {}
            except json.JSONDecodeError:
                params = {}
            
            # Validate params — reject junk from weak models
            if not self._validate_tool_params(name, params):
                continue

            if name == "bot_openclaw_task":
                task_text = str(params.get("task", "")).strip().lower()
                if self._openclaw_task_dispatched or (
                    task_text and task_text in self._openclaw_task_dispatch_times
                ):
                    logger.info("[NonBlockingRouter] ⏭️ Skipping duplicate bot_openclaw_task dispatch")
                    continue
            elif name == "bot_end_call" and self._end_call_requested:
                logger.info("[NonBlockingRouter] ⏭️ Skipping duplicate bot_end_call")
                continue
            
            executed_this_turn.add(name)
            if name == "bot_end_call":
                # Defer the actual bot.session.end emit until after Phase 1
                # voice finishes. This lets Pearl's goodbye TTS play fully
                # before the frontend tears down the session.
                # The existing _end_call_pending_emit mechanism (same as
                # direct-tool end_call path) handles the graceful shutdown
                # with a 3-second delay after _stream_fast_voice returns.
                self._end_call_requested = True
                self._end_call_pending_emit = True
                self._direct_tools_called.append("end_call")
                if self._direct_tool_name_for_phase1:
                    self._direct_tool_name_for_phase1 += ", end_call"
                else:
                    self._direct_tool_name_for_phase1 = "end_call"
                logger.info("[NonBlockingRouter] ⚡ Deferring end_call emit until after Phase 1 goodbye TTS")
                continue
            
            result = await self._execute_tool_via_gateway(
                name,
                params,
                direct_tool_voice_handled=True,
            )
            if result is not None:
                results[name] = result
                if name == "bot_openclaw_task":
                    task_text = str(params.get("task", "")).strip().lower()
                    if task_text:
                        self._openclaw_task_dispatch_times[task_text] = time.monotonic()
                    self._openclaw_task_dispatched = True
                    logger.info(
                        "[NonBlockingRouter] bot_openclaw_task queued via Phase 1; "
                        "skipping legacy Phase 2 agent spawn"
                    )
            else:
                # Fallback: try WebSocket event if gateway failed
                forwarder = self._forwarder_ref.get("instance")
                if forwarder:
                    ws_event = self._tool_name_to_ws_event(name, params)
                    if ws_event:
                        event_type, event_params = ws_event
                        await forwarder.emit_tool_event(event_type, event_params)
                        results[name] = {"_ws_fallback": True}
                        logger.info(f"[NonBlockingRouter] ⚡ WS fallback exec: {name}")
        
        return results

    @staticmethod
    def _tool_name_to_ws_event(tool_name: str, params: dict) -> tuple[str, dict] | None:
        """Map a bot tool name to a WebSocket event type + params."""
        _TOOL_WS_MAP = {
            "bot_open_notes": ("app.open", {"app": "notes"}),
            "bot_close_notes": ("apps.close", {"apps": ["notes"]}),
            "bot_open_app": ("app.open", {"app": str((params or {}).get("app") or "").strip()}),
            "bot_open_files": ("app.open", {"app": "files"}),
            "bot_open_youtube": ("app.open", {"app": "youtube"}),
            "bot_close_youtube": ("apps.close", {"apps": ["youtube"]}),
            # "bot_open_gmail": ("app.open", {"app": "gmail"}),  # DISABLED
            # "bot_close_gmail": ("apps.close", {"apps": ["gmail"]}),  # DISABLED
            "bot_open_terminal": ("app.open", {"app": "terminal"}),
            "bot_close_terminal": ("apps.close", {"apps": ["terminal"]}),
            # "bot_open_browser": ("app.open", {"app": "browser"}),  # DISABLED
            # "bot_open_google_drive": ("app.open", {"app": "google-drive"}),  # DISABLED
            # "bot_close_google_drive": ("apps.close", {"apps": ["google-drive"]}),  # DISABLED
            # "bot_open_news": removed — news goes through Phase 2 (wonder.scene)
            "bot_open_creation_engine": ("app.open", {"app": "creation-launchpad"}),
            "bot_close_applet_creation_engine": ("apps.close", {"apps": ["creation-engine"]}),
            "bot_play_soundtrack": ("soundtrack.control", {"action": "play", "source": "voice_tool", "overridePreference": True}),
            "bot_stop_soundtrack": ("soundtrack.control", {"action": "stop"}),
            "bot_next_soundtrack_track": ("soundtrack.control", {"action": "next"}),
            "bot_end_call": ("bot.session.end", {"reason": "user_requested", "initiator": "assistant", "source": "direct_tool", "graceful": True}),
            # Note control tools
            "bot_scroll_note": ("note.scroll", {}),
            "bot_highlight_note": ("note.highlight", {}),
            "bot_clear_note_highlights": ("note.highlight.clear", {}),
            "bot_navigate_note_heading": ("note.navigate.heading", {}),
            # Wonder Canvas tools
            "bot_wonder_canvas_clear": ("wonder.clear", {}),
            "bot_wonder_canvas_add": ("wonder.add", {}),
            "bot_wonder_canvas_animate": ("wonder.animate", {}),
        }
        if tool_name == "bot_open_files":
            payload = {"app": "files"}
            query = str((params or {}).get("query") or (params or {}).get("fileSearchQuery") or "").strip()
            if query:
                payload["query"] = query
                payload["fileSearchQuery"] = query
            return ("app.open", payload)
        if tool_name == "bot_customize_interface":
            return ("interface.customize", dict(params or {}))
        return _TOOL_WS_MAP.get(tool_name)

    def _is_silent_tool_intent(self, user_text: str) -> bool:
        """Check if user text is requesting a silent tool (no voice ack needed).
        
        Silent tools are simple actions like pause, stop, volume adjust, clear canvas
        that should execute without Pearl saying anything.
        """
        text_lower = user_text.lower().strip()
        
        # YouTube pause/stop patterns
        if any(phrase in text_lower for phrase in [
            "pause", "pause it", "pause that", "pause video", "pause youtube",
            "stop video", "stop youtube", "stop it", "stop that",
        ]):
            return True
        
        # Soundtrack stop/mute patterns  
        if any(phrase in text_lower for phrase in [
            "stop soundtrack", "stop music", "stop the music",
            "pause music", "mute music", "silence", "quiet",
        ]):
            return True
        
        # Volume adjust patterns
        if any(phrase in text_lower for phrase in [
            "volume up", "volume down", "turn it up", "turn it down",
            "louder", "quieter", "lower the volume",
        ]) or re.search(r'(?:set|change|turn|put)?\s*(?:the\s+)?volume\s*(?:to|at)?\s*\d+', text_lower):
            return True
        
        # Canvas clear patterns
        if any(phrase in text_lower for phrase in [
            "clear canvas", "clear wonder", "clear screen", "clear display",
            "clear the canvas", "clear wonder canvas", "clear the screen", "clear the display",
        ]):
            return True
        
        return False

    async def _try_direct_tool(self, user_text: str) -> tuple[bool, str | None]:
        """Try to execute a simple command directly via WebSocket event.
        
        Returns (handled, tool_name) where:
        - handled: True if the command was handled directly, False otherwise
        - tool_name: Name of the tool that was executed (for silent tool checking), or None
        """
        # Check if forwarder is available
        forwarder = self._forwarder_ref.get("instance")
        if not forwarder:
            return (False, None)
        
        # Normalize text for matching
        text_lower = user_text.lower().strip()
        
        # Compound intent detection: if the utterance contains conjunctions
        # suggesting multiple intents, don't short-circuit — let Phase 2 handle
        # the full request. e.g. "open notes and create a meeting note"
        _COMPOUND_INDICATORS = re.compile(
            r'\b(?:and\s+(?:then\s+)?(?:also\s+)?|then\s+|also\s+|plus\s+|after\s+that\s+|but\s+first\s+)',
            re.IGNORECASE,
        )
        has_compound_intent = bool(_COMPOUND_INDICATORS.search(text_lower))
        
        # When compound intent detected, we still fire the direct tool but
        # return False so Phase 2 runs to handle the remaining intent(s).
        direct_return = not has_compound_intent
        
        # ---------------------------------------------------------------
        # DISPATCH / AGENT commands — check FIRST (highest priority)
        # These are superset actions; if someone says "deploy agents to
        # investigate …", the entire utterance is a dispatch intent even
        # if incidental words like "news" appear later in the sentence.
        # ---------------------------------------------------------------
        task_desc = self._extract_dispatch_task_description(text_lower)
        if task_desc:
            # NOTE: Do NOT return True here. Dispatch requests need Phase 2
            # (full OpenClaw agent with sessions_spawn) to actually create
            # sub-agents. Returning True would skip Phase 2, leaving only a
            # fire-and-forget one-shot completion that can't spawn real agents.
            # Phase 2 handles this via _run_openclaw_background with full
            # conversation context and tool access.
            logger.info(f"[NonBlockingRouter] ⚡ Dispatch intent detected (Phase 2 will handle): {task_desc[:80]}")
            self._dispatch_intent_detected = True
            return (False, None)
        if self._has_dispatch_trigger(text_lower):
            logger.info("[NonBlockingRouter] Ignoring incomplete dispatch intent fragment")

        # Simple keyword matching patterns
        # Notes navigation (check BEFORE close commands to avoid false match)
        if any(phrase in text_lower for phrase in [
            "go back to the list", "back to the list", "go back to list",
            "back to notes list", "back to notes", "go back to notes",
            "back to the menu", "go back to the menu", "back to menu",
            "notes list", "show the list", "show notes list",
            "go back", "return to list", "return to notes",
        ]):
            event_type, params = DIRECT_TOOLS["back_to_notes"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: back_to_notes")
            return (direct_return, None)

        # Close commands
        if any(phrase in text_lower for phrase in ["close notes", "close note", "closed notes", "exit notes", "shut notes"]):
            event_type, params = DIRECT_TOOLS["close_notes"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_notes")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["close youtube", "closed youtube", "exit youtube"]):
            event_type, params = DIRECT_TOOLS["close_youtube"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_youtube")
            return (direct_return, None)
        
        # YouTube pause (silent tool)
        if any(phrase in text_lower for phrase in [
            "pause", "pause it", "pause that", "pause video", "pause youtube",
            "pause the video", "pause the youtube"
        ]):
            event_type, params = DIRECT_TOOLS["pause_youtube"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: pause_youtube (silent)")
            return (direct_return, "bot_pause_youtube_video")
        
        if any(phrase in text_lower for phrase in ["close terminal", "closed terminal", "exit terminal"]):
            event_type, params = DIRECT_TOOLS["close_terminal"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_terminal")
            return (direct_return, None)
        
        # DISABLED: Gmail, browser, Drive keyword matching removed per Blair directive 2026-02-26
        
        # Open commands
        specific_note_match = re.search(
            r'\b(?:open|show|pull up|bring up)\s+(?:the\s+)?note\s+(?:called|named|titled|about|for)\s+(.+)',
            text_lower,
        )
        if specific_note_match and "don't" not in text_lower:
            title = specific_note_match.group(1).strip(" .!?\"'")
            if title:
                result = await self._execute_tool_via_gateway(
                    "bot_open_note",
                    {"title": title},
                    direct_tool_voice_handled=True,
                )
                if isinstance(result, dict) and result.get("success"):
                    self._direct_tools_called.append("bot_open_note")
                    logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_note title={title[:80]}")
                    return (direct_return, "bot_open_note")

                self._note_lookup_miss_context = (
                    f"Direct note lookup found no note matching '{title}'. "
                    "Continue the request instead of stopping: search for that title/topic "
                    "with web/current-info tools or delegate research if appropriate."
                )
                logger.info(
                    f"[NonBlockingRouter] Direct note lookup missed for title={title[:80]}; "
                    "allowing Phase 2 search continuation"
                )
                return (False, None)

        if any(phrase in text_lower for phrase in ["open notes", "open note", "show notes"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_notes"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_notes")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open filespace", "open file space", "open files", "show filespace", "show file space", "show files"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_files"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_files")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open agency", "open the agency", "show agency", "show the agency", "open tasks", "show tasks"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_agency"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_agency")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open studio", "open the studio", "show studio", "show the studio", "open creation launchpad", "show creation launchpad"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_studio"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_studio")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open our pearlos", "open our pearl os", "show our pearlos", "show our pearl os", "open feature catalog", "show feature catalog"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_our_pearlos"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_our_pearlos")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open pulse", "show pulse", "open global pulse", "show global pulse", "open social pulse"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_pulse"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_pulse")
            return (direct_return, None)

        if any(phrase in text_lower for phrase in ["open creation engine", "show creation engine", "open applet builder", "show applet builder"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_creation_engine"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info("[NonBlockingRouter] ⚡ Direct tool: open_creation_engine")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["open youtube", "show youtube"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_youtube"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_youtube")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["open terminal", "show terminal"]) and "don't" not in text_lower:
            event_type, params = DIRECT_TOOLS["open_terminal"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_terminal")
            return (direct_return, None)
        
        # DISABLED: Gmail, browser, Drive open keyword matching removed per Blair directive 2026-02-26
        
        # NEWS: Execute via gateway direct (bot_open_news → wonder.scene), NOT via
        # the old app.open WS event which caused voice pipeline mute.
        if self._is_news_intent(text_lower) and "don't" not in text_lower and "close" not in text_lower:
            category = self._extract_news_category(text_lower)
            params = {"category": category} if category else {}
            await self._execute_tool_via_gateway(
                "bot_open_news",
                params,
                direct_tool_voice_handled=True,
            )
            self._direct_tools_called.append("bot_open_news")
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: open_news (gateway) category={category or 'default'}")
            if not self._is_pure_news_open_intent(text_lower):
                self._direct_tool_enrichable = True  # Phase 2 needed so Pearl discusses headlines
                # Prefetch headlines for Phase 2 enrichment context
                headlines = await self._fetch_news_headlines(user_text)
                if headlines:
                    self._news_headlines_context = headlines
            return (direct_return, None)
        
        # Weather (direct gateway execution — bypasses Phase 2)
        if any(phrase in text_lower for phrase in [
            "weather", "what's the weather", "whats the weather",
            "show me the weather", "how's the weather", "hows the weather",
            "weather forecast", "what's it like outside", "is it going to rain",
            "temperature", "how hot is it", "how cold is it",
        ]) and "don't" not in text_lower and "close" not in text_lower:
            # Extract location from user message
            # Try common patterns: "weather in X", "weather for X", "X weather", or just "X"
            location = None
            
            # Pattern 1: "weather in/for/at/near/of X"
            for prep in ["in", "for", "at", "near", "around", "of"]:
                match = re.search(rf"\b{prep}\s*,?\s+([A-Z][a-zA-Z\s,]+?)(?:\s+(?:today|tonight|tomorrow|this|right|now)|[?.!]|$)", user_text, re.IGNORECASE)
                if match:
                    location = match.group(1).strip(" ,.!?")
                    break
            
            # Pattern 2: If no preposition match, try to find capitalized location after weather keywords
            if not location:
                match = re.search(r"\b(?:weather|forecast|temperature)\s+(?:for|in|at)?\s*([A-Z][a-zA-Z\s]+?)(?:\s+(?:today|tonight|tomorrow)|[?.!]|$)", user_text, re.IGNORECASE)
                if match:
                    location = match.group(1).strip(" ,.!?")
            
            # Pattern 3: Look for city names anywhere in the message (common US cities)
            if not location:
                # Common US cities that might appear in weather queries
                known_cities = [
                    "New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia",
                    "San Antonio", "San Diego", "Dallas", "San Jose", "Austin", "Jacksonville",
                    "Fort Worth", "Columbus", "Charlotte", "San Francisco", "Indianapolis", "Seattle",
                    "Denver", "Washington", "Boston", "Detroit", "Nashville", "Portland", "Las Vegas",
                    "Memphis", "Louisville", "Baltimore", "Milwaukee", "Albuquerque", "Tucson",
                    "Fresno", "Sacramento", "Kansas City", "Mesa", "Atlanta", "Colorado Springs",
                    "Omaha", "Raleigh", "Miami", "Oakland", "Minneapolis", "Tulsa", "Cleveland",
                    "Wichita", "Arlington", "Orlando", "Tampa", "Altamonte Springs", "Winter Park",
                    "London", "Paris", "Tokyo", "Berlin", "Madrid", "Rome", "Sydney", "Toronto",
                    "Vancouver", "Montreal", "Dubai", "Singapore", "Hong Kong", "Mumbai",
                    "New Delhi", "Delhi", "Beijing", "Shanghai", "Seoul", "Bangkok", "Jakarta",
                    "Cairo", "Istanbul", "Moscow", "São Paulo", "Mexico City", "Buenos Aires",
                    "Lagos", "Nairobi", "Johannesburg", "Karachi", "Lahore", "Dhaka", "Kolkata",
                    "Chennai", "Bangalore", "Hyderabad", "Pune", "Pittsburgh", "Honolulu"
                ]
                for city in known_cities:
                    if city.lower() in text_lower:
                        location = city
                        break
            
            # Default to user's default location if available (from env or profile)
            if not location:
                location = os.getenv("BOT_DEFAULT_LOCATION", "Altamonte Springs, Florida")
            
            self._direct_tool_voice_pending = True
            weather_result = await self._execute_tool_via_gateway(
                "bot_get_weather",
                {"location": location},
                timeout_s=15,
                direct_tool_voice_handled=True,
            )
            self._direct_tools_called.append("bot_get_weather")
            self._direct_tool_voice_pending = bool(weather_result and weather_result.get("success"))
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: weather (gateway) location={location}")
            # Stash weather data so _stream_fast_voice can inject it into context
            if weather_result and weather_result.get("success"):
                cur = weather_result.get("current", {})
                fc = weather_result.get("forecast", [])
                fc_summary = "; ".join(
                    f"{f.get('date','?')}: {f.get('condition','?')} high {f.get('high_f','?')}°F low {f.get('low_f','?')}°F"
                    for f in fc[:5]
                )
                self._weather_context = (
                    f"LIVE WEATHER DATA for {weather_result.get('location', location)}:\n"
                    f"Current: {cur.get('temperature_f')}°F (feels like {cur.get('feels_like_f')}°F), "
                    f"{cur.get('condition', 'unknown')}, humidity {cur.get('humidity_pct')}%, wind {cur.get('wind_mph')} mph\n"
                    f"Forecast: {fc_summary}"
                )
                logger.info(f"[NonBlockingRouter] 🌤️ Stashed weather context: {cur.get('temperature_f')}°F at {location}")
            # Weather does NOT need Phase 2 enrichment — bot_get_weather already
            # renders its own canvas card and data is stashed for Phase 1 voice.
            # Setting enrichable here caused Phase 2 to re-call bot_get_weather.
            return (direct_return, None)

        # PearlOS UI theme switching. Keep this before desktop mode matching:
        # "theme" is interface appearance, not home/work/quiet/create mode.
        interface_theme = _infer_interface_theme_request(text_lower)
        if interface_theme:
            await forwarder.emit_tool_event(
                "interface.customize",
                {"action": "theme", "theme": interface_theme},
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: interface_theme {interface_theme}")
            return (direct_return, None)

        # Desktop mode switching
        if any(phrase in text_lower for phrase in ["work mode", "switch to work", "go to work"]):
            event_type, params = DIRECT_TOOLS["switch_work"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_work")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["home mode", "switch to home", "go home"]):
            event_type, params = DIRECT_TOOLS["switch_home"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_home")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["desktop mode", "switch to desktop", "go to desktop", "back to desktop"]):
            event_type, params = DIRECT_TOOLS["switch_desktop"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_desktop")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["quiet mode", "switch to quiet", "go quiet"]):
            event_type, params = DIRECT_TOOLS["switch_quiet"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_quiet")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["create mode", "switch to create", "creation mode"]):
            event_type, params = DIRECT_TOOLS["switch_create"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: switch_create")
            return (direct_return, None)
        
        # Note scrolling
        if any(phrase in text_lower for phrase in ["scroll down", "page down", "scroll the note down"]):
            event_type, params = DIRECT_TOOLS["scroll_down"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: scroll_down")
            return (direct_return, "bot_scroll_note")
        
        if any(phrase in text_lower for phrase in ["scroll up", "page up", "scroll the note up"]):
            event_type, params = DIRECT_TOOLS["scroll_up"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: scroll_up")
            return (direct_return, "bot_scroll_note")
        
        if any(phrase in text_lower for phrase in ["scroll to the top", "go to the top", "top of the note", "back to top"]):
            event_type, params = DIRECT_TOOLS["scroll_top"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: scroll_top")
            return (direct_return, "bot_scroll_note")
        
        if any(phrase in text_lower for phrase in ["scroll to the bottom", "go to the bottom", "bottom of the note", "end of the note"]):
            event_type, params = DIRECT_TOOLS["scroll_bottom"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: scroll_bottom")
            return (direct_return, "bot_scroll_note")
        
        # Close all windows
        if any(phrase in text_lower for phrase in [
            "close all", "close everything", "close all windows", "close all apps",
            "close it all", "shut everything", "clear everything",
        ]):
            await forwarder.emit_tool_event("apps.close", {"apps": ["all"]})
            await forwarder.emit_tool_event("wonder.clear", {})
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_all")
            return (direct_return, None)

        # Close Wonder Canvas / news / weather (canvas-resident apps)
        if any(phrase in text_lower for phrase in [
            "close wonder canvas", "close canvas", "close the canvas",
            "close news", "close the news",
            "close weather", "close the weather",
        ]):
            await forwarder.emit_tool_event("wonder.clear", {})
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: close_canvas_app")
            return (direct_return, "bot_wonder_canvas_clear")

        # Clear canvas / Wonder Canvas
        if any(phrase in text_lower for phrase in ["clear canvas", "clear the canvas", "clear wonder canvas", "clear the screen"]):
            event_type, params = DIRECT_TOOLS["clear_canvas"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: clear_canvas")
            return (direct_return, "bot_wonder_canvas_clear")
        
        # End call
        if self._is_end_call_intent(user_text):
            if self._end_call_requested:
                logger.info("[NonBlockingRouter] ⏭️ Skipping duplicate end_call")
                return (direct_return, "bot_end_call")
            self._end_call_requested = True
            self._end_call_pending_emit = True
            self._direct_tools_called.append("end_call")
            logger.info("[NonBlockingRouter] ⚡ Direct tool: end_call queued for graceful goodbye")
            return (direct_return, "bot_end_call")
        
        # Soundtrack controls
        if any(phrase in text_lower for phrase in ["play soundtrack", "play music", "start music", "play some music", "put on music", "put on some music"]):
            event_type, params = DIRECT_TOOLS["play_soundtrack"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: play_soundtrack")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["stop soundtrack", "stop music", "stop the music", "pause music", "mute music"]):
            event_type, params = DIRECT_TOOLS["stop_soundtrack"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: stop_soundtrack")
            return (direct_return, "bot_stop_soundtrack")
        
        if any(phrase in text_lower for phrase in ["next track", "next song", "skip track", "skip song", "next soundtrack"]):
            event_type, params = DIRECT_TOOLS["next_track"]
            await forwarder.emit_tool_event(event_type, params)
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: next_track")
            return (direct_return, None)
        
        # Volume control via gateway (needs parameter extraction)
        import re as _re
        vol_match = _re.search(r'(?:set|change|turn|put)?\s*(?:the\s+)?volume\s*(?:to|at)?\s*(\d+)', text_lower)
        if vol_match:
            vol_pct = int(vol_match.group(1))
            vol_normalized = max(0.0, min(1.0, vol_pct / 100.0))
            await self._execute_tool_via_gateway(
                "bot_set_soundtrack_volume",
                {"volume": vol_normalized},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: volume → {vol_pct}%")
            return (direct_return, "bot_set_soundtrack_volume")
        
        if any(phrase in text_lower for phrase in ["volume up", "turn it up", "louder"]):
            await self._execute_tool_via_gateway(
                "bot_adjust_soundtrack_volume",
                {"direction": "up"},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: volume up")
            return (direct_return, "bot_adjust_soundtrack_volume")
        
        if any(phrase in text_lower for phrase in ["volume down", "turn it down", "quieter", "lower the volume"]):
            await self._execute_tool_via_gateway(
                "bot_adjust_soundtrack_volume",
                {"direction": "down"},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: volume down")
            return (direct_return, "bot_adjust_soundtrack_volume")
        
        # Window management via gateway
        if any(phrase in text_lower for phrase in ["minimize window", "minimize it", "minimize that"]):
            await self._execute_tool_via_gateway(
                "bot_minimize_window",
                {},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: minimize_window")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["maximize window", "maximize it", "maximize that", "full screen", "fullscreen"]):
            await self._execute_tool_via_gateway(
                "bot_maximize_window",
                {},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: maximize_window")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["snap left", "snap it left", "move it left", "window left"]):
            await self._execute_tool_via_gateway(
                "bot_snap_window_left",
                {},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: snap_window_left")
            return (direct_return, None)
        
        if any(phrase in text_lower for phrase in ["snap right", "snap it right", "move it right", "window right"]):
            await self._execute_tool_via_gateway(
                "bot_snap_window_right",
                {},
                direct_tool_voice_handled=True,
            )
            logger.info(f"[NonBlockingRouter] ⚡ Direct tool: snap_window_right")
            return (direct_return, None)
        
        return (False, None)

    async def _run_two_phase(self, incoming_messages: list[dict]) -> None:
        """Execute two-phase response: fast voice + background tools."""

        if self._is_processing:
            elapsed = time.monotonic() - self._processing_start_time
            if elapsed < self._min_processing_secs:
                logger.warning(f"[NonBlockingRouter] Dropping request — throttled ({elapsed:.2f}s < {self._min_processing_secs}s)")
                return

        self._cancel_event.set()
        self._cancel_event = asyncio.Event()
        self._is_processing = True
        self._response_started = False
        self._processing_start_time = time.monotonic()

        try:
            await self._run_two_phase_inner(incoming_messages)
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Two-phase response cancelled during teardown")
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Unhandled error in two-phase: {type(e).__name__}: {e}")
        finally:
            self._is_processing = False

    # ------------------------------------------------------------------
    # Context pruning — prevents context window poisoning
    # ------------------------------------------------------------------
    _MAX_CONVERSATION_TURNS = 12  # Keep last N user+assistant turn pairs
    _PHASE2_INJECTION_LIMIT = 2  # Max background-research injections to keep

    def _prune_context(self) -> None:
        """Prune message history to prevent context window poisoning.

        Three strategies:
        1. Drop failed tool call results (role=tool with error indicators)
        2. Limit Phase 2 injection messages (role=system with [Background...])
        3. Cap total conversation turns to _MAX_CONVERSATION_TURNS
        """
        if len(self._messages) <= 2:
            return

        system_msg = self._messages[0]
        non_system = self._messages[1:]
        original_count = len(non_system)

        # --- Strategy 1: Drop failed tool results ---
        # These are messages where role=tool and content contains error indicators,
        # or role=assistant messages that are just error acknowledgments from failed tools
        _ERROR_INDICATORS = (
            '"success": false', '"success":false',
            '"error":', 'failed to', 'error:', 'exception:',
            'timed out', 'timeout', 'could not', 'unable to',
        )
        pruned = []
        for m in non_system:
            role = m.get("role", "")
            content = str(m.get("content", "")).lower()

            # Drop tool-role messages with errors
            if role == "tool" and any(ind in content for ind in _ERROR_INDICATORS):
                continue

            # Drop the tool_calls assistant message if its corresponding tool
            # result was an error (orphaned tool call). We detect these by
            # checking if the next message was a tool error we're dropping.
            # Simpler: just drop tool-role errors; orphaned calls are harmless.

            pruned.append(m)

        # --- Strategy 2: Limit Phase 2 background injection messages ---
        # These are system messages injected by _run_openclaw_background with
        # "[Background research completed]" prefix. Keep only the most recent N.
        phase2_indices = [
            i for i, m in enumerate(pruned)
            if m.get("role") == "system"
            and "[background" in str(m.get("content", "")).lower()[:30]
        ]
        if len(phase2_indices) > self._PHASE2_INJECTION_LIMIT:
            drop_indices = set(phase2_indices[:-self._PHASE2_INJECTION_LIMIT])
            pruned = [m for i, m in enumerate(pruned) if i not in drop_indices]

        # --- Strategy 3: Cap conversation turns ---
        # Count user messages as turn boundaries; keep last N turns
        # (a turn = user message + following assistant/system messages)
        if len(pruned) > self._MAX_CONVERSATION_TURNS * 3:
            # Find user message indices
            user_indices = [i for i, m in enumerate(pruned) if m.get("role") == "user"]
            if len(user_indices) > self._MAX_CONVERSATION_TURNS:
                cut_from = user_indices[-self._MAX_CONVERSATION_TURNS]
                pruned = pruned[cut_from:]

        if len(pruned) < original_count:
            logger.info(
                f"[NonBlockingRouter] 🧹 Context pruned: {original_count} → {len(pruned)} messages"
            )

        self._messages = [system_msg] + pruned

    async def _run_two_phase_inner(self, incoming_messages: list[dict]) -> None:
        """Inner implementation of two-phase response (wrapped by _run_two_phase for safety)."""

        # Sync message history
        non_system = [m for m in incoming_messages if m.get("role") != "system"]
        self._messages = [self._messages[0]] + non_system
        if len(non_system) > self._max_history:
            self._messages = [self._messages[0]] + non_system[-self._max_history:]

        # Prune context to prevent poisoning from failed tools / duplicates
        self._prune_context()

        # Get latest user message
        user_text = ""
        for m in reversed(self._messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str) and content.strip():
                    cleaned = re.sub(r'^\[User [^]]+, pid: [^]]+\]:\s*', '', content)
                    if cleaned.strip():
                        user_text = cleaned
                        break

        if not user_text:
            user_msgs = [m for m in self._messages if m.get("role") == "user"]
            logger.warning(f"[NonBlockingRouter] NO USER TEXT FOUND in {len(self._messages)} messages.")
            return

        # Dedup: skip if same user text was processed recently
        # Tool intents get a shorter dedup window (5s) — long enough to prevent
        # retrigger loops from injections, short enough to allow deliberate repeats.
        now = time.monotonic()
        is_tool_intent = self._needs_tools_heuristic(user_text)
        dedup_window = 5.0 if is_tool_intent else self._dedup_window_secs
        if (user_text == self._last_processed_user_text
                and (now - self._last_processed_time) < dedup_window):
            logger.warning(f"[NonBlockingRouter] Skipping duplicate (window={dedup_window}s): '{user_text[:80]}'")
            return

        self._last_processed_user_text = user_text
        self._last_processed_time = now

        cancel = self._cancel_event
        if cancel.is_set():
            logger.info("[NonBlockingRouter] Skipping turn because voice session is tearing down")
            return

        self._turn_count += 1
        self._current_turn_id += 1
        self._turn_executed_tools.clear()  # Reset enrichable dedup for new turn
        self._dispatch_intent_detected = False  # Reset per-turn BEFORE _try_direct_tool sets it
        self._openclaw_task_dispatched = False  # Reset per-turn; recent-task map still blocks retrigger loops
        self._direct_tool_enrichable = False  # Reset per-turn
        self._direct_tools_called = []  # Reset per-turn
        self._news_headlines_context = ""  # Reset per-turn
        self._note_lookup_miss_context = ""  # Reset per-turn
        self._end_call_requested = False  # Reset per-turn
        self._end_call_pending_emit = False  # Reset per-turn
        self._direct_tool_voice_pending = False  # Reset per-turn

        # Reset direct tool tracking for this turn
        self._direct_tool_completed.clear()
        self._direct_tool_name_for_phase1 = ""

        # Try direct tool execution first (for instant response)
        direct_tool_handled, executed_tool_name = await self._try_direct_tool(user_text)

        # Signal Phase 1 that the direct tool completed (so it won't generate
        # a generic "let me try" filler before the tool has actually run)
        if direct_tool_handled:
            # Build a human-readable summary of what the direct tool did,
            # so Phase 1 can generate an informed acknowledgment.
            direct_tool_names = list(self._direct_tools_called) if self._direct_tools_called else []
            if not direct_tool_names and executed_tool_name:
                direct_tool_names = [executed_tool_name]
            # If no explicit tool name tracked, infer from user text
            if not direct_tool_names:
                direct_tool_names = [self._infer_direct_tool_name(user_text)]
            self._direct_tool_name_for_phase1 = ", ".join(direct_tool_names) if direct_tool_names else "direct_action"
            self._direct_tool_completed.set()

        # Check if this is a silent tool (no voice acknowledgment needed)
        is_silent_tool = (
            (executed_tool_name and executed_tool_name in SILENT_TOOLS)
            or self._is_silent_tool_intent(user_text)
        )

        # Determine if this needs tools (simple heuristic)
        needs_tools = self._needs_tools_heuristic(user_text)

        # Force Phase 2 on first turn so OpenClaw generates a greeting canvas,
        # BUT only if the utterance isn't purely conversational. A simple
        # "Hey Pearl, can you hear me?" should NOT trigger Phase 2 with
        # tool_choice=required, which causes hallucinated template calls.
        if self._turn_count == 1 and not needs_tools and not self._is_conversational_only(user_text):
            logger.info("[NonBlockingRouter] ⚡ First turn — forcing Phase 2 for greeting canvas")
            needs_tools = True
        turn_start = time.monotonic()

        if needs_tools:
            # SILENT TOOL: Skip voice entirely for simple actions
            if is_silent_tool:
                logger.info(f"[NonBlockingRouter] 🔇 Silent tool detected — skipping voice for: {user_text[:80]}")
                # Tool already executed via direct tool, just skip both phases
                return
            
            # TWO-PHASE: fast voice + background OpenClaw
            if direct_tool_handled:
                logger.info(f"[NonBlockingRouter] Direct tool executed, voice-only response for: {user_text[:80]}")
            else:
                logger.info(f"[NonBlockingRouter] Two-phase: voice + tools for: {user_text[:80]}")

            self._persist_voice_obligation(
                user_text,
                context=(
                    "Voice entered the two-phase path. Pearl should continue "
                    "current-info, research, or delegation work even if the "
                    "in-memory Phase 2 task is cancelled by another voice turn."
                ),
            )

            # Cancel any in-flight background tasks (superseded by new request)
            if self._phase2_turn_id > 0:
                self._completed_turn_ids.add(self._phase2_turn_id)
            for old_task in list(self._background_tasks):
                if not old_task.done():
                    old_task.cancel()
            # Limit completed_turn_ids size (keep last 10)
            if len(self._completed_turn_ids) > 10:
                self._completed_turn_ids = set(sorted(self._completed_turn_ids)[-10:])

            # Phase 1: Stream fast voice response immediately (DIRECT API — bypasses OpenClaw)
            await self._stream_fast_voice(user_text, cancel, turn_start)

            if self._end_call_pending_emit:
                self._schedule_end_call_emit(1.0)
                return

            # Phase 2: Fire OpenClaw in background (no voice output)
            # SKIP if direct tool or Phase 1 passthrough tool already handled the action
            all_phase1_passthrough = (
                self._phase1_tools_called
                and all(
                    tc.get("name", "") in PASSTHROUGH_TOOL_WHITELIST
                    for tc in self._phase1_tools_called
                )
            )
            # Check if any Phase 1 passthrough tools are enrichable (Phase 2 should still run)
            has_enrichable_passthrough = (
                self._phase1_tools_called
                and any(
                    tc.get("name", "") in PHASE2_ENRICHABLE_PASSTHROUGH
                    for tc in self._phase1_tools_called
                )
            )
            needs_phase2_enrichment = self._direct_tool_enrichable or has_enrichable_passthrough
            if (direct_tool_handled or all_phase1_passthrough) and not self._dispatch_intent_detected and not needs_phase2_enrichment:
                skip_reason = "direct keyword match" if direct_tool_handled else "Phase 1 passthrough tools"
                logger.info(f"[NonBlockingRouter] ⚡ Skipping Phase 2 (OpenClaw) — {skip_reason}")
            elif needs_phase2_enrichment and not self._dispatch_intent_detected:
                # Enrichable dedup: skip if same tool already ran Phase 2 enrichment this turn
                enrichable_tool_names = set()
                if self._phase1_tools_called:
                    enrichable_tool_names = {
                        tc.get("name", "") for tc in self._phase1_tools_called
                        if tc.get("name", "") in PHASE2_ENRICHABLE_PASSTHROUGH
                    }
                if executed_tool_name:
                    enrichable_tool_names.add(executed_tool_name)
                already_enriched = enrichable_tool_names & self._turn_executed_tools
                if already_enriched:
                    logger.info(f"[NonBlockingRouter] ⚡ Skipping Phase 2 enrichment — tools already enriched this turn: {already_enriched}")
                else:
                    self._turn_executed_tools.update(enrichable_tool_names)
                    logger.info("[NonBlockingRouter] ⚡ Direct tool executed but enrichable — running Phase 2 for enrichment")
                    self._phase2_turn_id = self._current_turn_id
                    task = asyncio.create_task(self._run_openclaw_background(user_text))
                    self._background_tasks.add(task)
                    task.add_done_callback(self._background_tasks.discard)
            elif self._dispatch_intent_detected and self._openclaw_task_dispatched:
                logger.info("[NonBlockingRouter] ⚡ Dispatch intent already fulfilled via Phase 1 task queue")
            elif self._dispatch_intent_detected:
                logger.info("[NonBlockingRouter] ⚡ Dispatch intent detected — routing to OpenClaw gateway for agent spawn (sessions_spawn)")
                self._phase2_turn_id = self._current_turn_id
                # Use legacy gateway path which has access to sessions_spawn
                # Direct LLM path only has bot_* tools and picks wrong ones (bot_list_tasks)
                task = asyncio.create_task(self._run_openclaw_background_legacy(user_text))
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
            else:
                self._phase2_turn_id = self._current_turn_id
                task = asyncio.create_task(self._run_openclaw_background(user_text))
                self._background_tasks.add(task)
                task.add_done_callback(self._background_tasks.discard)
        else:
            # SIMPLE: Use fast model directly (NO OpenClaw overhead)
            logger.info(f"[NonBlockingRouter] Simple response (no tools): {user_text[:80]}")
            await self._stream_fast_voice_full(cancel, turn_start)

    @staticmethod
    def _is_end_call_intent(text: str) -> bool:
        """Detect natural farewell phrases that should end the voice call."""
        return _deterministic_end_call_intent(text)

    def _is_conversational_only(self, text: str) -> bool:
        """Detect purely conversational utterances that should NEVER trigger Phase 2.

        These are greetings, mic checks, casual chat, and other messages where
        forcing tool_choice=required would cause hallucinated tool calls
        (e.g., bot_wonder_canvas_template for "Hey Pearl, can you hear me?").
        """
        lower = text.lower().strip()
        if self._is_end_call_intent(lower):
            return False

        if re.search(
            r'\b(?:open|show|read|list|create|make|start|update|delete|add|append|write|find|search)\b.*\b(?:note|notes|notepad)\b',
            lower,
        ) or re.search(
            r'\b(?:note|notes|notepad)\b.*\b(?:open|show|read|list|create|make|start|update|delete|add|append|write|find|search)\b',
            lower,
        ):
            return False

        # Strip leading "hey pearl" / "pearl" / "yo pearl" prefixes
        lower = re.sub(r'^(?:hey|hi|hello|yo|sup|what\'?s up|good (?:morning|afternoon|evening|night))[\s,]*(?:pearl)?[\s,]*', '', lower).strip()
        words = re.findall(r"[a-z0-9']+", lower)
        short_command_words = {
            "news", "weather", "notes", "note", "youtube", "terminal",
            "canvas", "wonder", "search", "dispatch", "agent", "task",
            "open", "close", "stop", "start", "help", "bye", "later",
        }
        if 0 < len(words) <= 2 and not any(word in short_command_words for word in words):
            return True

        _CONVERSATIONAL_PATTERNS = [
            # Mic checks / presence checks
            r'^can you hear me',
            r'^are you there',
            r'^you there',
            r'^hello\??$',
            r'^hi\??$',
            r'^hey\??$',
            r'^yo\??$',
            r'^testing',
            r'^is this (?:thing )?(?:on|working)',
            r'^(?:are )?you (?:listening|awake|alive|up)',
            # Simple greetings (after prefix strip)
            r'^how (?:are you|you doing|\'s it going)',
            r'^what\'?s up\??$',
            r'^good (?:morning|afternoon|evening|night)\s*\.?\s*$',
            r'^$',  # Empty after prefix strip = pure greeting
            # Casual conversation
            r'^(?:thanks|thank you|thx|ty)',
            r'^(?:ok|okay|cool|nice|great|awesome|perfect|sounds good|got it)',
            r'^(?:never ?mind|nvm|forget it|don\'t worry)',
            r'^(?:yeah|yep|yes|no|nah|nope)\s*\.?\s*$',
            r'^how do you feel',
            r'^what do you think',
            r'^tell me (?:about yourself|a (?:joke|story|fun fact))',
            r'^(?:i (?:love|like|miss|hate|appreciate) you)',
        ]
        return any(re.search(pat, lower) for pat in _CONVERSATIONAL_PATTERNS)

    def _needs_tools_heuristic(self, text: str) -> bool:
        """Fast heuristic to determine if user request likely needs tools."""
        if self._is_end_call_intent(text):
            return True

        # Conversational-only utterances NEVER need tools
        if self._is_conversational_only(text):
            return False

        lower = text.lower()
        tool_keywords = [
            "search", "look up", "find", "show me", "open", "play",
            "create", "make", "send", "message", "discord", "weather",
            "news", "price", "stock", "canvas", "note", "youtube",
            "what is", "what's", "who is", "how do", "tell me about",
            "what time", "remind", "calendar", "email", "browse",
            "wonder", "card", "display", "sprite",
            "switch", "change", "set", "turn on", "turn off", "toggle",
            "close", "quit", "stop", "start", "launch", "summon",
            "mode", "desktop", "home mode", "work mode", "quiet",
            "latest", "happening", "going on", "update", "headlines",
            "deploy", "dispatch", "agent", "research", "investigate",
            # Voice dictation / note-taking
            "write", "write down", "take note", "jot", "dictate",
            "type up", "document", "take this down", "write this",
            # Complex Wonder Canvas content (needs Phase 2 HTML generation)
            "3d", "interactive", "simulation", "game", "animation", "animate",
            "visualiz", "galaxy", "solar system", "particle", "physics",
        ]
        return any(kw in lower for kw in tool_keywords)

    def _should_persist_voice_obligation(self, text: str) -> bool:
        """Detect voice requests that must survive interruption/restart.

        Phase 2 background tasks are intentionally cancellable for normal voice
        responsiveness. Research, current-info, and delegation requests are not
        transient UI work, so they also get registered with Pearl's durable
        runtime before background execution begins.
        """
        if self._is_conversational_only(text):
            return False

        lower = text.lower()
        if self._has_dispatch_trigger(lower) and not self._extract_dispatch_task_description(lower):
            return False

        durable_keywords = [
            "search", "search the web", "look up", "find out", "research",
            "investigate", "latest", "current", "recent", "new model",
            "what's happening", "what is happening", "going on", "update me",
            "headlines", "news", "price", "stock", "crypto", "market",
            "compare", "recommend", "report", "analyze", "deep dive",
            "dispatch", "agent", "agency", "swarm", "codex", "claude",
            "openclaw", "task", "follow up", "keep looking", "figure out",
        ]
        return any(keyword in lower for keyword in durable_keywords)

    @staticmethod
    def _has_dispatch_trigger(text: str) -> bool:
        lower = (text or "").lower()
        return bool(
            re.search(
                r"\b(?:deploy|dispatch|send|spin up|spawn|run|start|kick off|put|have|get|ask)\s+"
                r"(?:an?\s+|the\s+|my\s+)?(?:agents?|agency|team|swarm|codex|claude|opus|sonnet)\b",
                lower,
            )
            or re.search(r"^(?:research|investigate)(?:\s+|$)", lower)
        )

    @staticmethod
    def _extract_dispatch_task_description(text: str) -> str:
        lower = (text or "").lower().strip()
        patterns = [
            r"\b(?:deploy|dispatch|send|spin up|spawn|have|get|ask)\s+(?:\w+\s+)*"
            r"(?:agents?|agency|team|swarm|codex|claude|opus|sonnet)\s+(?:to|for|about|on|audit|explore|investigate|research)\s+(.+)",
            r"\b(?:deploy|dispatch|send|spin up|spawn|run|start|kick off|put)\s+"
            r"(?:an?\s+)?(?:agents?|agency|team|swarm|codex|claude|opus|sonnet)\b\s*(?:(?:to|for|about|on)\s+)?(.*)",
            r"\b(?:have|get|ask)\s+(?:the\s+|my\s+)?(?:agency|team|swarm|agents?|codex|claude)\s+(.+)",
            r"^(?:research|investigate)\s+(.+)",
        ]
        for pattern in patterns:
            match = re.search(pattern, lower)
            if not match:
                continue
            desc = (match.group(1) or "").strip().strip(" .!?\"'")
            if desc and desc not in {"to", "for", "about", "on"}:
                return desc
        return ""

    def _persist_voice_obligation(self, user_text: str, *, context: str = "") -> None:
        if not self._note_lookup_miss_context and not self._should_persist_voice_obligation(user_text):
            return
        if self._note_lookup_miss_context and context:
            context = f"{context}\n\n{self._note_lookup_miss_context}"
        _create_voice_agent_obligation(
            user_text,
            kind="voice_background_watch",
            title=f"Voice follow-up: {user_text[:80]}",
            context=context or (
                "Voice request needs durable follow-up. The Pipecat Phase 2 "
                "background task may also run, but Pearl runtime owns the "
                "persistent obligation and user-visible follow-up."
            ),
        )

    def _suggest_tools_for_intent(self, text: str) -> str:
        """Suggest specific tools based on user intent to guide OpenClaw."""
        lower = text.lower()
        suggestions = []
        if any(kw in lower for kw in ["news", "headlines", "latest", "happening", "going on", "update"]):
            suggestions.append("Use bot_open_news or bot_openclaw_task with web_search to find current information.")
        if any(kw in lower for kw in ["switch", "home", "desktop", "mode"]):
            suggestions.append("Use bot_switch_desktop_mode.")
        if any(kw in lower for kw in ["search", "look up", "find", "what is", "what's", "who is", "tell me about"]):
            suggestions.append("Use bot_openclaw_task with web_search for factual queries.")
        youtube_intent = "youtube" in lower or re.search(
            r'\b(?:play|watch|find|search|pull up|show me)\b.{0,60}\bvideo\b',
            lower,
        )
        if youtube_intent:
            suggestions.append(
                "Use bot_search_youtube_videos with a specific query for video requests; "
                "use bot_open_youtube only for a plain request to open YouTube."
            )
        if any(kw in lower for kw in ["note", "write", "save", "jot", "dictate", "take note", "write down"]):
            suggestions.append("Use bot_create_note to create a new note, bot_add_note_content to append to the open note, or bot_open_notes to open the notes app.")
        if any(kw in lower for kw in ["wonder", "card", "canvas", "show", "display", "image"]):
            suggestions.append("Use bot_wonder_canvas_template for standard visuals or bot_wonder_canvas_scene for custom interactive HTML.")
        # Browser disabled per Blair directive 2026-02-26
        if any(kw in lower for kw in ["sprite", "summon"]):
            suggestions.append("Use bot_summon_sprite.")
        return " ".join(suggestions)

    async def _fetch_active_note_content(self, user_text: str = "") -> str | None:
        """Fetch note content for Phase 1 context injection.
        
        Tries: 1) active note from room state, 2) fuzzy search by title from user text.
        """
        try:
            from room import state as room_state
            from actions import notes_actions
            from tools.notes.utils import _extract_note_content

            room_url = self._resolve_room_url()
            if not room_url:
                return None

            tenant_id = room_state.get_room_tenant_id(room_url)
            if not tenant_id:
                return None

            note = None

            # Try 1: Active note from room state
            note_id = await room_state.get_active_note_id(room_url)
            user_id = (os.getenv("BOT_SESSION_USER_ID") or "").strip() or None
            if note_id:
                note = await notes_actions.get_note_by_id(tenant_id, note_id, user_id)

            # Try 2: Fuzzy search by title extracted from user text
            if not note and user_text:
                title_match = re.search(
                    r'(?:notes?\s+(?:is\s+)?called|notes?\s+named|open\s+(?:the\s+)?notes?|load\s+(?:the\s+)?notes?)\s+(.+)',
                    user_text, re.IGNORECASE
                )
                search_title = title_match.group(1).strip().rstrip('.!?') if title_match else None
                if search_title:
                    results = await notes_actions.fuzzy_search_notes(
                        tenant_id,
                        search_title,
                        user_id or "00000000-0000-0000-0000-000000000099",
                    )
                    if results and len(results) > 0:
                        note = results[0]
                        logger.info(f"[NonBlockingRouter] Fuzzy matched note '{note.get('title')}' from user text")

            if not note:
                return None

            content = _extract_note_content(note)
            title = note.get("title", "Untitled")

            if not content or not content.strip():
                return f"[Active note: '{title}', currently empty]"

            logger.info(f"[NonBlockingRouter] 📖 Fetched note '{title}' content: {len(content)} chars")
            return f"[Active note: '{title}']\n{content}"
        except Exception as e:
            logger.warning(f"[NonBlockingRouter] Failed to fetch active note: {e}")
            return None

    # ------------------------------------------------------------------
    # News intent detection & category extraction
    # ------------------------------------------------------------------

    _NEWS_CATEGORIES = {
        "general", "world", "business", "sports", "science", "politics",
        "entertainment", "health", "tech", "technology",
    }

    _NEWS_PHRASES = [
        "open news", "open the news", "show news", "show the news",
        "show me the news", "show me news", "what's the news", "whats the news",
        "check news", "check the news", "load news", "load the news",
        "bring up news", "bring up the news", "pull up news", "pull up the news",
        "read me the news", "give me the news", "latest headlines",
        "open headlines", "show headlines", "show me headlines",
        "latest news", "news headlines", "catch me up on the news",
        "today's news", "todays news", "current events",
        "what's in the news", "whats in the news",
        "what's going on in the news", "whats going on in the news",
    ]

    # Category-specific patterns: "[category] news", "[category] headlines", "news about [category]"
    _NEWS_CATEGORY_PHRASES = [
        f"{cat} news" for cat in _NEWS_CATEGORIES
    ] + [
        f"{cat} headlines" for cat in _NEWS_CATEGORIES
    ] + [
        f"what's happening in {cat}" for cat in _NEWS_CATEGORIES
    ] + [
        f"whats happening in {cat}" for cat in _NEWS_CATEGORIES
    ]

    def _is_news_intent(self, text_lower: str) -> bool:
        """Check if user text is a news-opening intent."""
        if any(phrase in text_lower for phrase in self._NEWS_PHRASES):
            return True
        if any(phrase in text_lower for phrase in self._NEWS_CATEGORY_PHRASES):
            return True
        return False

    def _is_pure_news_open_intent(self, text_lower: str) -> bool:
        """Return true for app navigation requests that should not spawn enrichment."""
        if any(
            phrase in text_lower
            for phrase in (
                "what's", "whats", "latest", "headline", "headlines",
                "today", "current events", "read me", "give me", "catch me up",
                "happening", "going on",
            )
        ):
            return False
        return any(
            phrase in text_lower
            for phrase in (
                "open news", "open the news", "show news", "show the news",
                "show me news", "show me the news", "check news", "check the news",
                "load news", "load the news", "bring up news", "bring up the news",
                "pull up news", "pull up the news",
            )
        )

    def _extract_news_category(self, text_lower: str) -> str | None:
        """Extract a news category from user text, or None for default/top stories."""
        for cat in self._NEWS_CATEGORIES:
            if cat in text_lower:
                if cat == "tech":
                    return "technology"
                if cat == "politics":
                    return "general"
                return cat
        return None

    @staticmethod
    def _infer_direct_tool_name(user_text: str) -> str:
        """Infer the direct tool action name from user text for Phase 1 context injection."""
        lower = user_text.lower().strip()
        _INFER_MAP = [
            (["desktop mode", "switch to desktop", "back to desktop"], "switch_desktop"),
            (["home mode", "switch to home", "go home"], "switch_home"),
            (["work mode", "switch to work", "go to work"], "switch_work"),
            (["quiet mode", "switch to quiet", "go quiet"], "switch_quiet"),
            (["create mode", "switch to create", "creation mode"], "switch_create"),
            (["open notes", "open note", "show notes"], "open_notes"),
            (["open filespace", "open file space", "open files", "show filespace", "show files"], "open_files"),
            (["open agency", "open the agency", "show agency", "show the agency", "open tasks", "show tasks"], "open_agency"),
            (["open studio", "open the studio", "show studio", "show the studio"], "open_studio"),
            (["open our pearlos", "open our pearl os", "show our pearlos", "feature catalog"], "open_our_pearlos"),
            (["open pulse", "show pulse", "open global pulse", "show global pulse", "social pulse"], "open_pulse"),
            (["open creation engine", "show creation engine", "open applet builder"], "open_creation_engine"),
            (["close notes", "close note"], "close_notes"),
            (["open youtube", "show youtube"], "open_youtube"),
            (["close youtube"], "close_youtube"),
            (["open terminal", "show terminal"], "open_terminal"),
            (["close terminal"], "close_terminal"),
            (["play soundtrack", "play music", "start music"], "play_soundtrack"),
            (["next track", "next song", "skip track"], "next_track"),
            (["go back", "back to notes", "back to the list"], "back_to_notes"),
            (["close all", "close everything"], "close_all"),
            ([
                "end call", "hang up", "goodbye", "good bye", "bye",
                "gotta run", "talk soon", "heading out", "i should go",
                "wrap up", "signing off", "that's all", "i'm done",
            ], "end_call"),
            (["maximize", "full screen"], "maximize_window"),
            (["minimize"], "minimize_window"),
        ]
        for phrases, name in _INFER_MAP:
            if any(p in lower for p in phrases):
                return name
        return "direct_action"

    def _needs_news_context(self, text: str) -> bool:
        """Check if user request is about news so we can prefetch headlines."""
        lower = text.lower()
        return any(phrase in lower for phrase in [
            "news", "headlines", "what's going on", "what's happening",
            "whats going on", "whats happening", "what is going on",
            "what is happening", "current events", "latest stories",
            "what's in the news", "whats in the news",
            "catch me up", "what did i miss", "any updates",
        ])

    async def _fetch_news_headlines(self, user_text: str = "") -> str | None:
        """Prefetch live news headlines for Phase 1 voice context injection.
        
        Returns a formatted string of headlines, or None on failure.
        Uses the same Google News RSS as the news tool.
        """
        try:
            from tools.news_tools import _fetch_rss, GOOGLE_NEWS_TOPICS, SEARCH_URL_TEMPLATE
            from urllib.parse import quote as url_quote

            # Detect specific topic from user text
            lower = user_text.lower()
            url = GOOGLE_NEWS_TOPICS["top"]  # default to top stories
            for category, cat_url in GOOGLE_NEWS_TOPICS.items():
                if category in lower and category not in ("top", "top stories"):
                    url = cat_url
                    break

            items = await _fetch_rss(url, max_items=5)
            if not items:
                return None

            lines = ["[Live headlines:]"]
            for i, item in enumerate(items, 1):
                lines.append(f"{i}. {item['headline']} ({item['source']})")
                if item.get("summary"):
                    lines.append(f"   {item['summary'][:100]}")

            return "\n".join(lines)
        except Exception as e:
            logger.warning(f"[NonBlockingRouter] Failed to prefetch news headlines: {e}")
            return None

    def _needs_note_context(self, text: str) -> bool:
        """Check if user request involves note content that Phase 1 needs."""
        lower = text.lower()
        return any(phrase in lower for phrase in [
            "read the note", "read my note", "read this note", "read it",
            "read the content", "read my content", "read that",
            "read me the note", "read me the content", "read me what",
            "what's in the note", "what's in my note", "whats in the note",
            "what does the note say", "what does it say",
            "tell me what's in", "read it out", "read it back",
            "recite the note", "recite it", "read aloud",
            "what did i write", "what's written", "show me the note",
            "read out the note", "contents of the note",
            "what's in this note", "what is in the note",
            "read the contents", "note content", "note say",
            # Also trigger when opening a specific note (so we don't hallucinate content)
            "open the note", "open my note", "open note",
            "note is called", "note called", "note named",
            "load the note", "load my note", "load note",
        ])

    # No generic fallback speech. If there is no request-specific update, stay
    # silent instead of speaking mechanical progress narration.
    _FALLBACK_PHRASES: list[str] = []

    async def _push_voice_text_guarded(self, text: str) -> None:
        cleaned = strip_narration(text or "", log_label="non-blocking-router")
        if not cleaned:
            logger.info(f"[NonBlockingRouter] Suppressed generic voice text: {text!r}")
            return
        await self.push_frame(TextFrame(text=cleaned))

    async def _push_fallback_text(self) -> None:
        """Keep quiet when there is no concrete update to speak."""
        now = time.monotonic()
        if now - self._last_fallback_time < 30.0:
            # Suppress — already pushed a fallback recently. Stay silent.
            logger.info("[NonBlockingRouter] Suppressing fallback text (within 30s window)")
            return
        self._last_fallback_time = now
        logger.info("[NonBlockingRouter] No fallback voice text emitted; waiting for concrete update")

    def _is_fast_model_rate_limited(self) -> bool:
        """Check if fast model is in 429 cooldown."""
        if self._consecutive_429_failures >= self._429_MAX_CONSECUTIVE:
            if time.monotonic() < self._429_cooldown_until:
                return True
            # Cooldown expired — reset and allow retry
            logger.info("[NonBlockingRouter] 429 cooldown expired, re-enabling fast model")
            self._consecutive_429_failures = 0
            self._429_cooldown_until = 0.0
        return False

    def _record_429_failure(self) -> None:
        """Record a 429 failure and possibly trigger cooldown."""
        self._consecutive_429_failures += 1
        logger.warning(
            f"[NonBlockingRouter] 429 failure #{self._consecutive_429_failures}"
            f"/{self._429_MAX_CONSECUTIVE}"
        )
        if self._consecutive_429_failures >= self._429_MAX_CONSECUTIVE:
            self._429_cooldown_until = time.monotonic() + self._429_COOLDOWN_SECS
            logger.warning(
                f"[NonBlockingRouter] ⚠️ Fast model 429 cooldown activated for "
                f"{self._429_COOLDOWN_SECS}s — routing to main model"
            )

    def _record_429_success(self) -> None:
        """Reset 429 counter on successful fast model call."""
        if self._consecutive_429_failures > 0:
            self._consecutive_429_failures = 0
            logger.info("[NonBlockingRouter] 429 counter reset after successful call")

    async def _stream_fast_voice(self, user_text: str, cancel: asyncio.Event, turn_start: float) -> None:
        """Phase 1: Stream a fast conversational response to TTS.

        Uses direct provider API (bypasses OpenClaw gateway entirely).
        If fast model is disabled (2+ consecutive timeouts), falls through to main model.
        """
        # Reset Phase 1 tool tracking BEFORE any early returns — prevents stale
        # state from a previous turn leaking into the Phase 2 skip decision.
        self._phase1_tools_called = []
        # NOTE: Do NOT reset _dispatch_intent_detected here — it's set during
        # _handle_direct_tool_or_keyword (called before _stream_fast_voice)
        # and consumed in the Phase 2 skip decision after this method returns.

        if self._fast_model_disabled:
            logger.warning("[NonBlockingRouter] Fast model disabled (consecutive timeouts) — using main model path")
            await self._stream_fast_voice_full(cancel, turn_start)
            return

        if self._is_fast_model_rate_limited():
            logger.warning("[NonBlockingRouter] Fast model in 429 cooldown — using main model path")
            await self._stream_fast_voice_full(cancel, turn_start)
            return

        # Anthropic Messages API doesn't support OpenAI-style tool_choice/tools,
        # so use the simple streaming path; tools still run via OpenClaw Phase 2
        if self._fast_is_anthropic:
            await self._stream_fast_voice_full(cancel, turn_start)
            return

        session = await self._get_session()

        # Build minimal context — only the fast system prompt + last few exchanges
        # This is ~300 tokens vs ~9,350 tokens through OpenClaw
        # Build system prompt — include identity, journal context
        fast_system = VOICE_FAST_SYSTEM
        current_user_context = self._current_session_user_context()
        if current_user_context:
            fast_system += "\n\n" + current_user_context
        if self._identity_context:
            fast_system += "\n\n" + self._identity_context
        if self._journal_context:
            fast_system += "\n\n" + self._journal_context

        # If user is asking about news, prefetch headlines for context injection
        if self._needs_news_context(user_text):
            headlines_text = await self._fetch_news_headlines(user_text)
            if headlines_text:
                fast_system += (
                    f"\n\n{headlines_text}"
                    "\n\nYou have LIVE HEADLINES above. When the user asks about news, "
                    "immediately start discussing 2-3 of the most interesting stories in a "
                    "natural, conversational way. Talk like a friend catching them up. "
                    "\"So the big story right now is...\", \"Looks like [topic] is getting "
                    "a lot of attention...\". The news app is loading on screen simultaneously. "
                    "Do NOT say you're opening the news app. Just talk about the news."
                )
                logger.info(f"[NonBlockingRouter] 📰 Injected {len(headlines_text)} chars of headlines into Phase 1 context")

        # Inject direct tool success context so Phase 1 knows the action
        # already completed (prevents generic "let me try" / "no luck" filler)
        if self._direct_tool_completed.is_set() and self._direct_tool_name_for_phase1:
            tool_name = self._direct_tool_name_for_phase1
            # Map tool names to human-friendly descriptions
            _TOOL_DESCRIPTIONS = {
                "switch_desktop": "Switched to desktop mode",
                "switch_home": "Switched to home mode",
                "switch_work": "Switched to work mode",
                "switch_quiet": "Switched to quiet mode",
                "switch_create": "Switched to create mode",
                "open_notes": "Opened notes",
                "open_files": "Opened FileSpace",
                "open_agency": "Opened The Agency",
                "open_studio": "Opened Studio",
                "open_our_pearlos": "Opened Our Pearl O S",
                "open_pulse": "Opened Pulse",
                "open_creation_engine": "Opened the creation engine",
                "bot_open_files": "Opened FileSpace",
                "close_notes": "Closed notes",
                "open_youtube": "Opened YouTube",
                "close_youtube": "Closed YouTube",
                "open_terminal": "Opened terminal",
                "close_terminal": "Closed terminal",
                "play_soundtrack": "Started playing soundtrack",
                "next_track": "Skipped to next track",
                "back_to_notes": "Went back to notes list",
                "close_all": "Closed all windows",
                "end_call": "Ending the call",
                "bot_open_news": "Opened the news",
                "bot_get_weather": "Fetched live weather data",
            }
            desc = _TOOL_DESCRIPTIONS.get(tool_name, f"Completed action: {tool_name}")
            fast_system += (
                f"\n\n[ACTION ALREADY COMPLETED: {desc}]\n"
                "The action above was ALREADY executed successfully before you respond. "
                "Do NOT say 'let me try', 'working on it', 'no luck', or any uncertainty. "
                "Just confirm what happened briefly in context of the user's request. "
                "If the user asked for something specific, answer about that content, not the action."
            )
            logger.info(f"[NonBlockingRouter] Injected direct tool success context: {desc}")

        # Inject live weather data if available (stashed by _try_direct_tool)
        if self._weather_context:
            fast_system += (
                f"\n\n{self._weather_context}"
                "\n\nYou have LIVE WEATHER DATA above. Use ONLY these exact numbers when discussing the weather. "
                "You MUST state the weather aloud conversationally. This is NOT narration. "
                "Do NOT start with 'Let me', 'I'll', 'Looking', 'Checking', or any process phrase. "
                "Do NOT guess or make up temperatures. State the real data conversationally: "
                "\"It's 88 degrees out there right now, clear skies, humidity's sitting around 38 percent.\" "
                "The weather card is showing on screen simultaneously."
            )
            logger.info(f"[NonBlockingRouter] 🌤️ Injected weather context into Phase 1")
            self._weather_context = ""  # Clear after use

        # If user is asking about a note, inject the note content into context
        reading_note = False
        if self._needs_note_context(user_text):
            note_content = await self._fetch_active_note_content(user_text)
            if note_content:
                fast_system += (
                    f"\n\n{note_content}"
                    "\n\nIMPORTANT: The note content above is the ACTUAL content from the user's note. "
                    "If asked to read it, read back the ACTUAL content VERBATIM. Do NOT summarize, "
                    "paraphrase, or make up content. If opening the note, acknowledge it and mention "
                    "what's actually in it based on the content above."
                )
                reading_note = True
                logger.info(f"[NonBlockingRouter] Injected note content into Phase 1 context ({len(note_content)} chars)")
                logger.info(f"[NonBlockingRouter] Injected active note content ({len(note_content)} chars) into Phase 1 context")

        fast_messages = [
            {"role": "system", "content": fast_system},
            *self._messages[-5:],  # Last few exchanges for context
        ]

        # Use higher max_tokens when reading note content (need room for full content)
        max_tokens = 1024 if reading_note else 512

        # Include passthrough tools so the fast LLM can emit tool_calls
        # for direct execution (bypassing Phase 2 OpenClaw round-trip).
        # Only include tools when user intent likely needs them (saves tokens).
        include_tools = self._needs_tools_heuristic(user_text) and not reading_note
        payload = {
            "model": self._fast_model,
            "messages": fast_messages,
            "stream": True,
            "max_tokens": max_tokens,
            "temperature": 0.3 if reading_note else _env_float("BOT_FAST_TEMPERATURE", 0.95),
            "user": "pearlos-voice",
        }
        if include_tools:
            payload["tools"] = PHASE1_TOOL_DEFINITIONS
            payload["tool_choice"] = "auto"

        # _phase1_tools_called already reset at top of method
        _tool_call_accumulators: dict[int, dict] = {}
        # Buffer to detect JSON leaking into content stream (Ollama bug)
        _content_buffer: str = ""
        _JSON_LEAK_PATTERN = re.compile(
            r'(?:\{["\'](?:name|function|tool_call|arguments|nil|object)["\']|'
            r'bot_\w+\s*\(|'
            r'"(?:type|function)":\s*")',
        )

        ttfb_logged = False
        await self.push_frame(LLMFullResponseStartFrame())

        try:
            _fast_headers = {
                "Authorization": f"Bearer {self._fast_api_key}",
                "Content-Type": "application/json",
            }
            _fast_timeout = aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=25)
            resp = await session.post(
                f"{self._fast_api_url}/chat/completions",
                json=payload, headers=_fast_headers, timeout=_fast_timeout,
            )
            # Retry once on 429 (Groq free-tier rate limit)
            if resp.status == 429:
                resp.release()
                self._record_429_failure()
                logger.warning("[NonBlockingRouter] Groq 429 rate limit — retrying in 2s")
                await asyncio.sleep(2)
                resp = await session.post(
                    f"{self._fast_api_url}/chat/completions",
                    json=payload, headers=_fast_headers, timeout=_fast_timeout,
                )
            if resp.status == 429:
                resp.release()
                self._record_429_failure()
                logger.warning("[NonBlockingRouter] Groq 429 persists — falling through to main model")
                await self._stream_fast_voice_full(cancel, turn_start)
                await self.push_frame(LLMFullResponseEndFrame())
                return
            async with resp:
                if resp.status != 200:
                    err = await resp.text()
                    logger.error(f"[NonBlockingRouter] Fast LLM error {resp.status}: {err[:200]}")
                    await self._push_fallback_text()
                    await self.push_frame(LLMFullResponseEndFrame())
                    return

                async for raw_line in resp.content:
                    if cancel.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        choice = chunk.get("choices", [{}])[0]
                        delta = choice.get("delta", {})
                        content = delta.get("content")
                        if content:
                            # Filter out JSON/tool-call leakage from weak models
                            # Buffer content to detect multi-chunk JSON patterns
                            _content_buffer += content
                            if _JSON_LEAK_PATTERN.search(_content_buffer):
                                logger.warning(
                                    f"[NonBlockingRouter] 🚫 Filtered JSON leak from TTS: "
                                    f"{_content_buffer[:120]}"
                                )
                                _content_buffer = ""
                                # Don't push to TTS — this is tool call JSON
                            else:
                                # Flush buffer if it's getting long (clearly not JSON)
                                if len(_content_buffer) > 40 or content.endswith((" ", ".", "!", "?", ",")):
                                    if not ttfb_logged:
                                        ttfb_ms = (time.monotonic() - turn_start) * 1000
                                        self._total_fast_ttfb_ms += ttfb_ms
                                        avg = self._total_fast_ttfb_ms / self._turn_count
                                        logger.info(
                                            f"[NonBlockingRouter] ⚡ FAST TTFB: {ttfb_ms:.0f}ms "
                                            f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                                        )
                                        ttfb_logged = True
                                        self._response_started = True
                                    await self._push_voice_text_guarded(_content_buffer)
                                    _content_buffer = ""

                        # Track tool calls from Phase 1 for dedup
                        for tc in delta.get("tool_calls", []):
                            idx = tc.get("index", 0)
                            if idx not in _tool_call_accumulators:
                                _tool_call_accumulators[idx] = {"name": "", "arguments": ""}
                            fn = tc.get("function", {})
                            if "name" in fn:
                                _tool_call_accumulators[idx]["name"] = fn["name"]
                            if "arguments" in fn:
                                _tool_call_accumulators[idx]["arguments"] += fn["arguments"]
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

            # Flush remaining content buffer (if clean)
            if _content_buffer and not _JSON_LEAK_PATTERN.search(_content_buffer):
                await self._push_voice_text_guarded(_content_buffer)
                _content_buffer = ""

            # Reset consecutive timeout/429 counters on success
            self._consecutive_fast_timeouts = 0
            self._record_429_success()
        except asyncio.TimeoutError:
            self._consecutive_fast_timeouts += 1
            logger.error(
                f"[NonBlockingRouter] Fast voice stream timed out "
                f"(consecutive: {self._consecutive_fast_timeouts}/2)"
            )
            if self._consecutive_fast_timeouts >= 2:
                self._fast_model_disabled = True
                logger.warning(
                    "[NonBlockingRouter] ⚠️ Fast model DISABLED after 2 consecutive timeouts — "
                    "falling back to main model path for remaining session"
                )
            await self._push_fallback_text()
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Fast voice stream cancelled during teardown")
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Fast voice error: {type(e).__name__}: {e}")
            await self._push_fallback_text()

        # Finalize Phase 1 tool call tracking
        for idx, tc in _tool_call_accumulators.items():
            if tc["name"]:
                self._phase1_tools_called.append(tc)
                logger.info(f"[NonBlockingRouter] Phase 1 tool call detected: {tc['name']}({tc['arguments'][:100]})")

        if any(tc.get("name") == "bot_openclaw_task" for tc in self._phase1_tools_called):
            self._dispatch_intent_detected = True
            logger.info(
                "[NonBlockingRouter] bot_openclaw_task in Phase 1 tool_calls; "
                "legacy Phase 2 will perform the agent spawn"
            )

        # Execute passthrough tools directly via gateway (bypass OpenClaw)
        tool_results: dict[str, dict | None] = {}
        if self._phase1_tools_called:
            tool_results = await self._execute_phase1_tool_calls(self._phase1_tools_called)
            if tool_results:
                logger.info(
                    f"[NonBlockingRouter] ⚡ Phase 1 direct-executed {len(tool_results)} tools: "
                    f"{', '.join(tool_results.keys())}"
                )

        await self.push_frame(LLMFullResponseEndFrame())

        # Inject tool results into conversation history so future turns know what happened
        if tool_results:
            summaries = []
            for tname, tresult in tool_results.items():
                if tresult is None:
                    summaries.append(f"- {tname}: failed (no result)")
                else:
                    result_str = json.dumps(tresult, default=str)
                    if len(result_str) > 500:
                        result_str = result_str[:500] + "..."
                    summaries.append(f"- {tname}: {result_str}")
            if summaries:
                self._messages.append({
                    "role": "system",
                    "content": f"[Tool execution results]\n" + "\n".join(summaries)
                })
                logger.info(
                    f"[NonBlockingRouter] 📋 Injected {len(summaries)} tool results into conversation context"
                )

        # Post-tool voice follow-up: if any tool returned data-rich results,
        # stream a short follow-up so Pearl can speak the actual data
        if tool_results and not cancel.is_set():
            await self._stream_data_followup(user_text, tool_results, cancel, turn_start)

        # Re-engagement after dispatch: if bot_openclaw_task was dispatched this
        # turn, re-engage the LLM to ask if the user needs anything else and to
        # end the call naturally. Without this, Pearl goes silent after dispatch.
        if self._dispatch_intent_detected and not cancel.is_set():
            await self._stream_dispatch_reengage(cancel, turn_start)

    # Tools whose results contain data the user wants to hear spoken aloud
    DATA_RICH_TOOLS: set[str] = {
        "bot_get_weather", "bot_get_news", "bot_get_time", "bot_get_current_time",
        "bot_read_note", "bot_get_note", "bot_search_notes",
        "bot_open_note", "bot_read_current_note",
        "bot_openclaw_task", "bot_web_search",
        "bot_photo_magic_generate",
    }

    async def _stream_dispatch_reengage(
        self, cancel: asyncio.Event, turn_start: float,
    ) -> None:
        """Re-engage the LLM after a task dispatch to keep the conversation alive.

        After bot_openclaw_task is dispatched, the LLM must continue the
        voice conversation by asking if the user needs anything else.
        The call should only end on an explicit farewell or hangup intent.
        """
        logger.info("[NonBlockingRouter] 🔄 Re-engaging LLM after task dispatch")
        session = await self._get_session()

        reengage_messages = [
            {"role": "system", "content": (
                VOICE_FAST_SYSTEM + "\n\n"
                "The task you dispatched is now running in the background. "
                "Ask if the user needs anything else. Do not infer the user is done from silence; "
                "only use bot_end_call for an explicit farewell or hangup request. "
                "Keep it SHORT, one sentence max."
            )},
        ]

        payload = {
            "model": self._fast_model,
            "messages": reengage_messages,
            "stream": True,
            "max_tokens": 150,
            "temperature": 0.7,
            "user": "pearlos-voice",
            "tools": PHASE1_TOOL_DEFINITIONS,
            "tool_choice": "auto",
        }

        await self.push_frame(LLMFullResponseStartFrame())
        try:
            async with session.post(
                f"{self._fast_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._fast_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=15),
            ) as resp:
                if resp.status != 200:
                    err = await resp.text()
                    logger.error(
                        f"[NonBlockingRouter] Dispatch re-engage LLM error {resp.status}: {err[:200]}"
                    )
                    await self.push_frame(LLMFullResponseEndFrame())
                    return

                async for raw_line in resp.content:
                    if cancel.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        # Check for tool_calls (bot_end_call)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content")
                        tool_calls_delta = delta.get("tool_calls")
                        if content:
                            await self._push_voice_text_guarded(content)
                        if tool_calls_delta:
                            for tc in tool_calls_delta:
                                name = tc.get("function", {}).get("name", "")
                                if name == "bot_end_call":
                                    self._end_call_requested = True
                                    self._end_call_pending_emit = True
                                    if self._direct_tool_name_for_phase1:
                                        self._direct_tool_name_for_phase1 += ", end_call"
                                    else:
                                        self._direct_tool_name_for_phase1 = "end_call"
                                    logger.info(
                                        "[NonBlockingRouter] 🔄 Dispatch re-engage: bot_end_call detected, "
                                        "deferred emit until after goodbye TTS"
                                    )
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Dispatch re-engage cancelled during teardown")
        except Exception as e:
            logger.error(
                f"[NonBlockingRouter] Dispatch re-engage error: {type(e).__name__}: {e}"
            )

        await self.push_frame(LLMFullResponseEndFrame())
        logger.info("[NonBlockingRouter] 🔄 Dispatch re-engage complete")

    async def _stream_data_followup(
        self, user_text: str, tool_results: dict[str, dict | None],
        cancel: asyncio.Event, turn_start: float,
    ) -> None:
        """Stream a short follow-up voice response with actual tool result data.
        
        Only fires for data-rich tools (weather, news, time, notes, etc.).
        Fire-and-forget tools (window management, app open/close) are skipped.
        """
        # Filter to data-rich results only
        data_results = {}
        for name, result in tool_results.items():
            if name in self.DATA_RICH_TOOLS and result and not result.get("_ws_fallback"):
                data_results[name] = result
        
        if not data_results:
            return
        
        logger.info(
            f"[NonBlockingRouter] 📢 Generating data follow-up for: "
            f"{', '.join(data_results.keys())}"
        )
        
        session = await self._get_session()
        result_summary = json.dumps(data_results, default=str)
        # Truncate massive results
        if len(result_summary) > 2000:
            result_summary = result_summary[:2000] + "..."
        
        followup_messages = [
            {"role": "system", "content": (
                VOICE_FAST_SYSTEM + "\n\n"
                "You just told the user you'd check on something. Now you have the actual data. "
                "Give a SHORT, natural voice response with the key facts. 1-2 sentences max. "
                "Just state the data conversationally. Examples:\n"
                "- \"It's 72 and sunny in Orlando, high of 78 today.\"\n"
                "- \"Top headlines: Congress passed the infrastructure bill, and SpaceX launched another Starship.\"\n"
                "- \"It's 3:47 PM Eastern.\"\n"
                "Do NOT repeat your earlier acknowledgment. Just give the data."
            )},
            {"role": "user", "content": user_text},
            {"role": "assistant", "content": "The tool results are ready."},
            {"role": "user", "content": f"[Tool results: {result_summary}]\nNow tell me the answer based on this data."},
        ]
        
        payload = {
            "model": self._fast_model,
            "messages": followup_messages,
            "stream": True,
            "max_tokens": 200,
            "temperature": _env_float("BOT_TOOL_RESULT_TEMPERATURE", 0.7),
            "user": "pearlos-voice",
        }
        
        await self.push_frame(LLMFullResponseStartFrame())
        try:
            async with session.post(
                f"{self._fast_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._fast_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=10),
            ) as resp:
                if resp.status != 200:
                    err = await resp.text()
                    logger.error(f"[NonBlockingRouter] Data follow-up LLM error {resp.status}: {err[:200]}")
                    await self.push_frame(LLMFullResponseEndFrame())
                    return
                
                async for raw_line in resp.content:
                    if cancel.is_set():
                        break
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        content = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                        if content:
                            await self._push_voice_text_guarded(content)
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Data follow-up cancelled during teardown")
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Data follow-up error: {type(e).__name__}: {e}")
        
        await self.push_frame(LLMFullResponseEndFrame())
        logger.info(f"[NonBlockingRouter] 📢 Data follow-up complete")

    async def _stream_fast_voice_full(self, cancel: asyncio.Event, turn_start: float) -> None:
        """Simple path: stream fast model response for non-tool conversations.

        Uses direct provider API (bypasses OpenClaw gateway entirely).
        Supports both OpenAI-compatible and Anthropic Messages API formats.
        """
        session = await self._get_session()

        # Build system prompt
        fast_system = VOICE_FAST_SYSTEM
        current_user_context = self._current_session_user_context()
        if current_user_context:
            fast_system += "\n\n" + current_user_context
        if self._identity_context:
            fast_system += "\n\n" + self._identity_context
        if self._journal_context:
            fast_system += "\n\n" + self._journal_context

        ttfb_logged = False
        await self.push_frame(LLMFullResponseStartFrame())

        cancelled = False
        try:
            if self._fast_is_anthropic:
                await self._stream_anthropic_messages(
                    session, fast_system, cancel, turn_start
                )
            else:
                await self._stream_openai_compatible(
                    session, fast_system, cancel, turn_start
                )
        except asyncio.TimeoutError:
            logger.error("[NonBlockingRouter] Simple voice stream timed out")
            await self._push_fallback_text()
        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Voice stream cancelled during teardown")
            cancelled = True
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Voice stream error: {type(e).__name__}: {e}")
            await self._push_fallback_text()

        if cancelled or cancel.is_set():
            return
        await self.push_frame(LLMFullResponseEndFrame())

    async def _stream_openai_compatible(
        self,
        session: aiohttp.ClientSession,
        fast_system: str,
        cancel: asyncio.Event,
        turn_start: float,
    ) -> None:
        """Stream from an OpenAI-compatible chat/completions endpoint."""
        fast_messages = [
            {"role": "system", "content": fast_system},
            *[m for m in self._messages[1:]],
        ]

        payload = {
            "model": self._fast_model,
            "messages": fast_messages,
            "stream": True,
            "max_tokens": 1024,
            "temperature": 0.7,
            "user": "pearlos-voice",
        }

        async with session.post(
            f"{self._fast_api_url}/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {self._fast_api_key}",
                "Content-Type": "application/json",
            },
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=25),
        ) as resp:
            if resp.status != 200:
                error = await resp.text()
                logger.error(f"[NonBlockingRouter] Fast voice error: {resp.status}: {error[:200]}")
                await self._push_fallback_text()
                return

            ttfb_logged = False
            async for raw_line in resp.content:
                if cancel.is_set():
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk = json.loads(data_str)
                    content = chunk.get("choices", [{}])[0].get("delta", {}).get("content")
                    if content:
                        if not ttfb_logged:
                            ttfb_ms = (time.monotonic() - turn_start) * 1000
                            self._total_fast_ttfb_ms += ttfb_ms
                            avg = self._total_fast_ttfb_ms / self._turn_count
                            logger.info(
                                f"[NonBlockingRouter] ⚡ SIMPLE TTFB: {ttfb_ms:.0f}ms "
                                f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                            )
                            ttfb_logged = True
                            self._response_started = True
                        await self._push_voice_text_guarded(content)
                except (json.JSONDecodeError, IndexError, KeyError):
                    continue

    async def _stream_anthropic_messages(
        self,
        session: aiohttp.ClientSession,
        fast_system: str,
        cancel: asyncio.Event,
        turn_start: float,
    ) -> None:
        """Stream from Anthropic's native Messages API (/v1/messages).

        Translates from OpenAI message format to Anthropic's format:
        - System message goes into top-level 'system' field
        - Only user/assistant messages in 'messages' array
        - Streaming events use content_block_delta with type=text_delta
        """
        # Separate non-system messages, ensuring conversation starts with user
        conv_messages = []
        for m in self._messages[1:]:  # Skip original system prompt
            role = m.get("role", "")
            if role in ("user", "assistant"):
                conv_messages.append({"role": role, "content": m.get("content", "")})

        # Anthropic requires messages to start with user role
        if not conv_messages or conv_messages[0]["role"] != "user":
            conv_messages.insert(0, {"role": "user", "content": "Hello."})

        # Merge consecutive same-role messages (Anthropic doesn't allow them)
        merged = []
        for m in conv_messages:
            if merged and merged[-1]["role"] == m["role"]:
                merged[-1]["content"] += "\n" + m["content"]
            else:
                merged.append(m)

        payload = {
            "model": self._fast_model,
            "system": fast_system,
            "messages": merged,
            "stream": True,
            "max_tokens": 1024,
            "temperature": 0.7,
        }

        # Support both standard API keys (sk-ant-api03-*) and OAuth tokens (sk-ant-oat01-*)
        if self._fast_api_key.startswith("sk-ant-oat"):
            headers = {
                "Authorization": f"Bearer {self._fast_api_key}",
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "oauth-2025-04-20",
                "Content-Type": "application/json",
            }
        else:
            headers = {
                "x-api-key": self._fast_api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }

        logger.info(
            f"[NonBlockingRouter] Anthropic Messages API: model={self._fast_model}, "
            f"messages={len(merged)}, system={len(fast_system)} chars"
        )

        async with session.post(
            f"{self._fast_api_url}/messages",
            json=payload,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=None, sock_connect=5, sock_read=25),
        ) as resp:
            if resp.status != 200:
                error = await resp.text()
                logger.error(f"[NonBlockingRouter] Anthropic error: {resp.status}: {error[:300]}")
                await self._push_fallback_text()
                return

            ttfb_logged = False
            async for raw_line in resp.content:
                if cancel.is_set():
                    break
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data:"):
                    continue
                data_str = line[len("data:"):].strip()
                if data_str == "[DONE]":
                    break
                try:
                    event = json.loads(data_str)
                    event_type = event.get("type", "")

                    # Anthropic streams: content_block_delta with text_delta
                    if event_type == "content_block_delta":
                        delta = event.get("delta", {})
                        if delta.get("type") == "text_delta":
                            text = delta.get("text", "")
                            if text:
                                if not ttfb_logged:
                                    ttfb_ms = (time.monotonic() - turn_start) * 1000
                                    self._total_fast_ttfb_ms += ttfb_ms
                                    avg = self._total_fast_ttfb_ms / self._turn_count
                                    logger.info(
                                        f"[NonBlockingRouter] ⚡ ANTHROPIC TTFB: {ttfb_ms:.0f}ms "
                                        f"(avg: {avg:.0f}ms, turn #{self._turn_count})"
                                    )
                                    ttfb_logged = True
                                    self._response_started = True
                                await self._push_voice_text_guarded(text)
                    elif event_type == "message_stop":
                        break
                    elif event_type == "error":
                        err_msg = event.get("error", {}).get("message", "Unknown error")
                        logger.error(f"[NonBlockingRouter] Anthropic stream error: {err_msg}")
                        break
                except (json.JSONDecodeError, KeyError):
                    continue

    async def _run_openclaw_background(self, user_text: str) -> None:
        """Phase 2: Execute tools in background via direct LLM call.

        Calls the LLM directly with full PearlOS tool schemas so it emits
        proper function_call responses. Tool calls are then executed via the
        bot gateway's /api/tools/invoke endpoint.

        Results go to UI (canvas, notes, apps) — NOT to voice.
        Falls back to OpenClaw gateway if no tool schemas are available.
        """
        bg_start = time.monotonic()
        session = await self._get_session()

        logger.info(
            f"[NonBlockingRouter] Phase 2 path decision: "
            f"tool_defs={len(self._phase2_tool_definitions)} user='{user_text[:60]}'"
        )

        # If no Phase 2 tool schemas loaded, fall back to OpenClaw gateway
        if not self._phase2_tool_definitions:
            logger.warning(
                "[NonBlockingRouter] No Phase 2 tool schemas — falling back to OpenClaw gateway"
            )
            await self._run_openclaw_background_legacy(user_text)
            return

        # Gateway-only intents: requests that NEED OpenClaw's native tools
        # (message, web_search, sessions_spawn) which aren't in PearlOS bot_* schemas.
        # Route these directly to the OpenClaw gateway instead of the direct LLM path.
        #
        # IMPORTANT: Canvas/visual intents should NOT be routed to legacy gateway
        # even if they contain gateway keywords like "show me" or "search for".
        # The direct LLM path has model auto-upgrade logic for canvas requests;
        # the legacy path may use Haiku which generates broken HTML.
        _user_lower = user_text.lower()
        _is_canvas_intent = any(kw in _user_lower for kw in _CANVAS_INTENT_KEYWORDS)

        _GATEWAY_KEYWORDS = (
            "send a message", "send message", "post to discord", "message to",
            "tell ", "text ", "notify ", "email ", "search the web", "search for",
            "look up", "google ", "find out", "research ",
        )
        if any(kw in _user_lower for kw in _GATEWAY_KEYWORDS) and not _is_canvas_intent:
            logger.info(
                f"[NonBlockingRouter] 🌐 Gateway-only intent detected — routing to OpenClaw: "
                f"{user_text[:60]}"
            )
            await self._run_openclaw_background_legacy(user_text)
            return
        elif any(kw in _user_lower for kw in _GATEWAY_KEYWORDS) and _is_canvas_intent:
            logger.info(
                f"[NonBlockingRouter] 🎨 Canvas intent overrides gateway routing — "
                f"using direct LLM path: {user_text[:60]}"
            )

        # Build messages for Phase 2 tool LLM
        non_system = [m for m in self._messages[1:] if m.get("role") != "system"]
        tool_messages = [self._messages[0]] + non_system[-8:]

        # Build tool hints based on user intent
        tool_hints = self._suggest_tools_for_intent(user_text)
        hint_section = f"\n\nSUGGESTED TOOLS: {tool_hints}" if tool_hints else ""

        # Phase 2 news enrichment: inject prefetched headlines so Phase 2 can
        # generate a canvas scene with actual headline data
        news_enrichment_section = ""
        if self._news_headlines_context:
            news_enrichment_section = (
                f"\n\n{self._news_headlines_context}"
                "\n\nThe news app has already been opened. You have LIVE HEADLINES above. "
                "If the user asked for news, you do NOT need to call bot_open_news again. "
                "it was already executed. Instead, use bot_wonder_canvas_scene to create a "
                "visually rich news card with these headlines, or simply confirm the action is done."
            )
            self._news_headlines_context = ""  # Clear after use

        note_lookup_miss_section = ""
        if self._note_lookup_miss_context:
            note_lookup_miss_section = f"\n\n{self._note_lookup_miss_context}"
            self._note_lookup_miss_context = ""  # Clear after use

        # Phase 2 dedup: tell LLM which tools Phase 1 already executed
        dedup_section = ""
        if self._phase1_tools_called:
            tool_list = "; ".join(
                f"{tc['name']}({tc['arguments'][:80]})" for tc in self._phase1_tools_called
            )
            dedup_section = (
                f"\n\nALREADY EXECUTED BY FAST VOICE MODEL: {tool_list}\n"
                "Do NOT call these tools again unless the results were incorrect or incomplete."
            )

        tool_messages.append({
            "role": "system",
            "content": (
                "The user's voice request has already been acknowledged with a conversational "
                "response. Your job now is ONLY to execute the necessary tools/actions. "
                "Do NOT produce conversational text. Only use tools. "
                "You MUST call at least one tool. If you're unsure which tool, use "
                "bot_openclaw_task to delegate, or bot_open_news for news, or "
                "bot_wonder_canvas_scene to show visual content.\n\n"
                "NEVER respond with just text. ALWAYS call a tool. "
                "If the request needs a Wonder Canvas card, create it. "
                "If it needs a web search, do it. If it needs to open an app, do it. "
                "Produce minimal text output. Focus on tool execution.\n\n"
                "GREETING/FIRST TURN: If this is a greeting or casual hello, ALWAYS show "
                "something visually interesting on the Wonder Canvas. Rotate through different "
                "templates: weather_card, quote_spotlight, daily_briefing, "
                "fact_card. Don't repeat the same one. Fill ALL fields with rich, real data "
                "(no dashes, no placeholders, no empty fields).\n\n"
                "CRITICAL: NEVER invent real-time data (stock prices, sports scores, weather, "
                "crypto prices) for charts or displays. If you don't have real data from a tool "
                "result, do NOT fabricate numbers. Use bot_openclaw_task to fetch real data first, "
                "or add 'Illustrative' to the title.\n\n"
                "CRITICAL: Call each tool EXACTLY ONCE. Do NOT call the same tool twice "
                "(e.g. do NOT call bot_wonder_canvas_scene twice to 'improve' the result). "
                "Your first attempt is final. One tool call per action, then stop."
                f"{hint_section}"
                f"{dedup_section}"
                f"{news_enrichment_section}"
                f"{note_lookup_miss_section}"
            )
        })

        # Resolve Phase 2 LLM API
        # Two-model pipeline: if BOT_SUBCONSCIOUS_MODEL is set and compact tool
        # schemas are loaded, use the subconscious model (GPT-4o-mini) for fast,
        # deterministic tool routing with tool_choice=required.
        # Otherwise fall back to the original Phase 2 model resolution.
        _subconscious_model = (
            self._read_env_fresh("BOT_SUBCONSCIOUS_MODEL")
            or os.getenv("BOT_SUBCONSCIOUS_MODEL")
        )
        _use_subconscious = bool(_subconscious_model and self._compact_tool_definitions)

        if _use_subconscious:
            # Subconscious path: GPT-4o-mini via OpenRouter with 11 super tools
            phase2_model = _subconscious_model
            phase2_api_url = (
                self._read_env_fresh("BOT_SUBCONSCIOUS_BASE_URL")
                or os.getenv("BOT_SUBCONSCIOUS_BASE_URL", "https://openrouter.ai/api/v1")
            )
            phase2_api_key = os.getenv("OPENROUTER_API_KEY", "")
            phase2_tool_defs = self._compact_tool_definitions
            logger.info(
                f"[NonBlockingRouter] Phase 2 using SUBCONSCIOUS model: {phase2_model} "
                f"via {phase2_api_url} with {len(phase2_tool_defs)} compact tools"
            )
        else:
            # Legacy path: use BOT_TOOLS_MODEL (DeepSeek, Anthropic, etc.) with full tool set
            phase2_tool_defs = self._phase2_tool_definitions
            # Read fresh from .env file so Pearl Mind changes take effect without restart
            phase2_model = (
                self._read_env_fresh("BOT_TOOLS_MODEL")
                or os.getenv("BOT_TOOLS_MODEL")
                or os.getenv("BOT_PHASE2_MODEL")
                or "anthropic/claude-haiku-4-5"
            )

            # Model upgrade for Wonder Canvas scene generation:
            # Haiku cannot produce complex 3D HTML/CSS/JS. When the user intent
            # suggests visual/canvas content, upgrade to a capable model.
            _user_lower = user_text.lower()
            if any(kw in _user_lower for kw in _CANVAS_INTENT_KEYWORDS):
                canvas_model = (
                    self._read_env_fresh("BOT_CANVAS_SCENE_MODEL")
                    or os.getenv("BOT_CANVAS_SCENE_MODEL")
                )
                if canvas_model:
                    logger.info(
                        f"[NonBlockingRouter] Canvas intent detected, upgrading model: "
                        f"{phase2_model} -> {canvas_model}"
                    )
                    phase2_model = canvas_model
                elif "haiku" in phase2_model:
                    # Auto-upgrade Haiku to Sonnet for canvas work
                    phase2_model = "claude-sonnet-4-20250514"
                    logger.info(
                        f"[NonBlockingRouter] Canvas intent detected, auto-upgrading "
                        f"from Haiku to {phase2_model}"
                    )

            # Detect local Ollama models (no prefix or ollama/ prefix)
            # Models starting with "claude" are Anthropic (not local) even without anthropic/ prefix
            _is_known_remote = (
                any(phase2_model.startswith(p) for p in (
                    "anthropic/", "openai/", "google/", "groq/", "deepseek/",
                    "meta-llama/", "mistralai/", "qwen/", "x-ai/", "openrouter/",
                    "liquid/", "moonshotai/", "minimax/", "trinity/",
                    "claude-",  # Direct Anthropic model names (e.g. claude-sonnet-4-20250514)
                    "deepseek-",  # Direct DeepSeek model names (e.g. deepseek-v4-flash)
                ))
            )
            is_local = (not _is_known_remote) or phase2_model.startswith("ollama/")

            if is_local:
                # Local model via Ollama -- strip ollama/ prefix if present
                ollama_model = phase2_model.removeprefix("ollama/")
                ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
                phase2_api_url = f"{ollama_url}/v1"
                phase2_api_key = "ollama"  # Ollama doesn't need a real key
                phase2_model = ollama_model
                logger.info(
                    f"[NonBlockingRouter] Phase 2 using LOCAL model: {ollama_model} "
                    f"via {phase2_api_url}"
                )
            else:
                # Remote model -- route Anthropic/Claude models directly to Anthropic API
                # (OpenClaw /v1/chat/completions does NOT support tool_choice=required,
                #  which Phase 2 requires for reliable tool invocation)
                if "anthropic" in phase2_model.lower() or "claude" in phase2_model.lower():
                    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
                    if anthropic_key:
                        phase2_api_url = "https://api.anthropic.com/v1"
                        phase2_api_key = anthropic_key
                        # Strip provider prefix for direct Anthropic API
                        phase2_model = phase2_model.removeprefix("anthropic/")
                        logger.info(
                            f"[NonBlockingRouter] Phase 2 routing directly to Anthropic API "
                            f"(tool_choice support) for {phase2_model}"
                        )
                    else:
                        # Fallback to OpenClaw gateway if no direct key
                        openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
                        _raw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789")
                        phase2_api_url = _raw_url if _raw_url.rstrip("/").endswith("/v1") else _raw_url + "/v1"
                        phase2_api_key = openclaw_key
                        # OpenClaw requires model=openclaw (not raw provider/model names)
                        phase2_model = "openclaw"
                        logger.info(
                            f"[NonBlockingRouter] Phase 2 routing through OpenClaw gateway "
                            f"(no ANTHROPIC_API_KEY), model=openclaw"
                        )
                elif "deepseek" in phase2_model.lower():
                    # DeepSeek models -- route through local DeepSeek proxy (vLLM on :8200)
                    ds_base = os.getenv("DEEPSEEK_BASE_URL", "http://localhost:8200/v1")
                    phase2_api_url = ds_base if ds_base.rstrip("/").endswith("/v1") else ds_base + "/v1"
                    phase2_api_key = os.getenv("DEEPSEEK_API_KEY", "sk-dummy")
                    # Strip provider prefix if present
                    phase2_model = phase2_model.removeprefix("deepseek/")
                    logger.info(
                        f"[NonBlockingRouter] Phase 2 routing to DeepSeek proxy "
                        f"for {phase2_model} via {phase2_api_url}"
                    )
                else:
                    phase2_api_url = os.getenv("BOT_PHASE2_API_URL", "https://openrouter.ai/api/v1")
                    phase2_api_key = os.getenv("OPENROUTER_API_KEY", "")

        if not phase2_api_key:
            logger.warning("[NonBlockingRouter] No Phase 2 API key -- falling back to OpenClaw")
            await self._run_openclaw_background_legacy(user_text)
            return

        # Determine tool_choice strategy.
        # Subconscious model (GPT-4o-mini) always uses tool_choice=required
        # for deterministic routing. DeepSeek rejects required, uses auto.
        # Conversational utterances use auto to prevent hallucinated tool calls.
        _is_conversational = self._is_conversational_only(user_text)
        if _is_conversational:
            tc = "auto"
            logger.info("[NonBlockingRouter] Phase 2: conversational utterance detected, using tool_choice=auto")
        elif _use_subconscious:
            tc = "required"
            logger.info("[NonBlockingRouter] Phase 2: subconscious model, using tool_choice=required")
        elif "deepseek" in phase2_model.lower():
            tc = "auto"
        else:
            tc = "required"
        payload = {
            "model": phase2_model,
            "messages": tool_messages,
            "tools": phase2_tool_defs,
            "tool_choice": tc,
            "stream": False,
            "max_tokens": 4096,
        }

        try:
            async with session.post(
                f"{phase2_api_url.rstrip('/')}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {phase2_api_key}",
                    "Content-Type": "application/json",
                },
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    logger.error(
                        f"[NonBlockingRouter] Phase 2 LLM error {resp.status}: {error[:300]}"
                    )
                    # Fall back to OpenClaw gateway
                    await self._run_openclaw_background_legacy(user_text)
                    return

                result = await resp.json()
                choice = result.get("choices", [{}])[0]
                message = choice.get("message", {})
                tool_calls = message.get("tool_calls", [])
                content = message.get("content", "")

                bg_elapsed = (time.monotonic() - bg_start) * 1000

                if tool_calls:
                    # Execute tool calls via bot gateway
                    executed_tools = []
                    for tc in tool_calls:
                        fn = tc.get("function", {})
                        name = fn.get("name", "")
                        raw_args = fn.get("arguments", "{}") or "{}"
                        try:
                            params = json.loads(raw_args)
                        except json.JSONDecodeError:
                            params = {}

                        if not name:
                            continue

                        # Validate params
                        if not self._validate_tool_params(name, params):
                            continue

                        if name == "bot_openclaw_task" and self._openclaw_task_dispatched:
                            logger.info("[NonBlockingRouter] ⏭️ Skipping duplicate Phase 2 bot_openclaw_task")
                            continue

                        result = await self._execute_tool_via_gateway(name, params)
                        if result is not None:
                            executed_tools.append(name)
                            if name == "bot_openclaw_task":
                                self._openclaw_task_dispatched = True
                            logger.info(
                                f"[NonBlockingRouter] 🔧 Phase 2 tool executed: {name}"
                            )
                        else:
                            # Try WebSocket fallback
                            forwarder = self._forwarder_ref.get("instance")
                            if forwarder:
                                ws_event = self._tool_name_to_ws_event(name, params)
                                if ws_event:
                                    event_type, event_params = ws_event
                                    await forwarder.emit_tool_event(event_type, event_params)
                                    executed_tools.append(name)
                                    logger.info(
                                        f"[NonBlockingRouter] 🔧 Phase 2 tool (WS fallback): {name}"
                                    )

                    logger.info(
                        f"[NonBlockingRouter] 🔧 Phase 2 complete: {bg_elapsed:.0f}ms — "
                        f"executed {len(executed_tools)} tools: {', '.join(executed_tools)} "
                        f"for: {user_text[:60]}"
                    )
                elif content:
                    preview = content[:100].replace("\n", " ")
                    logger.warning(
                        f"[NonBlockingRouter] ⚠️ Phase 2 returned TEXT instead of tools: "
                        f"{bg_elapsed:.0f}ms — {preview}... for: {user_text[:60]}"
                    )
                else:
                    logger.warning(
                        f"[NonBlockingRouter] ⚠️ Phase 2 returned nothing: "
                        f"{bg_elapsed:.0f}ms for: {user_text[:60]}"
                    )

                # CONTEXT FEEDBACK: Inject Phase 2 tool execution results into Phase 1 history
                if executed_tools:
                    tool_summary = ", ".join(executed_tools)
                    self._messages.append({
                        "role": "system",
                        "content": f"[Background tools completed: {tool_summary}]"
                    })
                    logger.info(
                        f"[NonBlockingRouter] 📋 Injected Phase 2 tool results into context: {tool_summary}"
                    )

                if content and len(content) > 10:
                    noise_patterns = [
                        "youtube closed", "browser closed", "window closed",
                        "mode switched", "app opened", "task complete"
                    ]
                    content_lower = content.lower()
                    is_meaningful = not any(p in content_lower for p in noise_patterns)
                    if is_meaningful:
                        summary = content[:500] + ("..." if len(content) > 500 else "")
                        self._messages.append({
                            "role": "system",
                            "content": f"[Background research completed] {summary}"
                        })
                        logger.info(
                            f"[NonBlockingRouter] 📥 Context feedback: {len(summary)} chars"
                        )

        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Phase 2 tool execution cancelled during teardown")
            self._completed_turn_ids.add(self._phase2_turn_id)
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Phase 2 tool error: {e}")
            self._completed_turn_ids.add(self._phase2_turn_id)

    async def _run_openclaw_background_legacy(self, user_text: str) -> None:
        """Legacy Phase 2: Send to OpenClaw gateway (fallback when no tool schemas)."""
        if self._openclaw_task_dispatched:
            logger.info("[NonBlockingRouter] Legacy Phase 2 skipped; bot_openclaw_task already dispatched")
            return

        bg_start = time.monotonic()
        session = await self._get_session()

        non_system = [m for m in self._messages[1:] if m.get("role") != "system"]
        tool_only_messages = [self._messages[0]] + non_system[-8:]

        tool_hints = self._suggest_tools_for_intent(user_text)
        hint_section = f"\n\nSUGGESTED TOOLS: {tool_hints}" if tool_hints else ""

        tool_only_messages.append({
            "role": "system",
            "content": (
                "The user's voice request has already been acknowledged. "
                "Execute the necessary tools/actions. Do NOT produce conversational text."
                f"{hint_section}"
            )
        })

        # ── Model auto-upgrade for canvas/visual requests ──
        # The legacy path uses self._oc_model (typically openclaw:voice or
        # openclaw:main) which may route to Haiku. Haiku cannot generate
        # complex 3D HTML/CSS/JS for Wonder Canvas scenes. Upgrade to a
        # capable model when canvas intent is detected.
        _user_lower = user_text.lower()
        oc_model = self._oc_model
        if any(kw in _user_lower for kw in _CANVAS_INTENT_KEYWORDS):
            canvas_model = (
                self._read_env_fresh("BOT_CANVAS_SCENE_MODEL")
                or os.getenv("BOT_CANVAS_SCENE_MODEL")
            )
            if canvas_model:
                logger.info(
                    f"[NonBlockingRouter] Legacy Phase 2: Canvas intent ��� "
                    f"BOT_CANVAS_SCENE_MODEL={canvas_model} (using openclaw for routing)"
                )
                # OpenClaw requires model=openclaw; canvas_model env is informational only
                oc_model = "openclaw"
            elif "haiku" in oc_model.lower() or oc_model.startswith("openclaw:"):
                # OpenClaw now requires model=openclaw; it handles model
                # selection internally.  Raw provider/model names are rejected.
                oc_model = "openclaw"
                logger.info(
                    f"[NonBlockingRouter] Legacy Phase 2: Canvas intent — "
                    f"auto-upgrading {self._oc_model} → {oc_model}"
                )

        logger.info(
            f"[NonBlockingRouter] Legacy Phase 2: model={oc_model} "
            f"user='{user_text[:60]}'"
        )

        payload = {
            "model": oc_model,
            "messages": tool_only_messages,
            "stream": True,
            "max_tokens": 4096,
            "user": "pearlos-voice-bg",
        }

        try:
            async with session.post(
                f"{self._oc_api_url}/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {self._oc_api_key}",
                    "Content-Type": "application/json",
                    "x-openclaw-session-key": self._oc_session_key,
                },
                timeout=aiohttp.ClientTimeout(total=self._timeout),
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    logger.error(f"[NonBlockingRouter] OpenClaw bg error: {resp.status}: {error[:200]}")
                    return

                content_chunks = []
                async for raw_line in resp.content:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk.get("choices", [{}])[0].get("delta", {})
                        if "content" in delta and delta["content"]:
                            content_chunks.append(delta["content"])
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue

                bg_elapsed = (time.monotonic() - bg_start) * 1000
                full_content = "".join(content_chunks).strip()
                logger.info(
                    f"[NonBlockingRouter] Legacy Phase 2: {bg_elapsed:.0f}ms "
                    f"({len(full_content)} chars) for: {user_text[:60]}"
                )

                # Speak the OpenClaw response if it contains useful content
                # (not just tool execution confirmations)
                if full_content and len(full_content) > 10:
                    # Inject as assistant context so Pearl can reference it,
                    # then trigger a voice follow-up
                    self._messages.append({"role": "assistant", "content": full_content})
                    logger.info(
                        f"[NonBlockingRouter] Legacy Phase 2: injected {len(full_content)} chars "
                        f"into conversation context"
                    )
                    # Stream a short voice follow-up with the OpenClaw result
                    try:
                        followup_system = (
                            VOICE_FAST_SYSTEM + "\n\n"
                            "Your backend just completed a task. Here's what happened:\n"
                            f"{full_content[:2000]}\n\n"
                            "Give a SHORT, natural voice update about this. 1-2 sentences. "
                            "If an agent was dispatched, confirm it's running. "
                            "If a search was done, share the key findings."
                        )
                        await self.push_frame(LLMFullResponseStartFrame())
                        if self._fast_is_anthropic:
                            # Direct Anthropic Messages API call
                            if self._fast_api_key.startswith("sk-ant-oat"):
                                _a_headers = {
                                    "Authorization": f"Bearer {self._fast_api_key}",
                                    "anthropic-version": "2023-06-01",
                                    "anthropic-beta": "oauth-2025-04-20",
                                    "Content-Type": "application/json",
                                }
                            else:
                                _a_headers = {
                                    "x-api-key": self._fast_api_key,
                                    "anthropic-version": "2023-06-01",
                                    "Content-Type": "application/json",
                                }
                            _a_payload = {
                                "model": self._fast_model,
                                "system": followup_system,
                                "messages": [{"role": "user", "content": user_text}],
                                "stream": True,
                                "max_tokens": 256,
                                "temperature": 0.7,
                            }
                            async with session.post(
                                f"{self._fast_api_url}/messages",
                                json=_a_payload,
                                headers=_a_headers,
                                timeout=aiohttp.ClientTimeout(total=15),
                            ) as a_resp:
                                if a_resp.status == 200:
                                    async for raw_line in a_resp.content:
                                        line = raw_line.decode("utf-8", errors="replace").strip()
                                        if not line.startswith("data:"):
                                            continue
                                        data_str = line[len("data:"):].strip()
                                        if data_str == "[DONE]":
                                            break
                                        try:
                                            evt = json.loads(data_str)
                                            if evt.get("type") == "content_block_delta":
                                                txt = evt.get("delta", {}).get("text", "")
                                                if txt:
                                                    await self._push_voice_text_guarded(txt)
                                        except (json.JSONDecodeError, KeyError):
                                            continue
                        else:
                            _fast_headers = {
                                "Authorization": f"Bearer {self._fast_api_key}",
                                "Content-Type": "application/json",
                            }
                            followup_payload = {
                                "model": self._fast_model,
                                "messages": [
                                    {"role": "system", "content": followup_system},
                                    {"role": "user", "content": user_text},
                                ],
                                "stream": True,
                                "max_tokens": 256,
                                "temperature": 0.7,
                                "user": "pearlos-voice",
                            }
                            async with session.post(
                                f"{self._fast_api_url}/chat/completions",
                                json=followup_payload,
                                headers=_fast_headers,
                                timeout=aiohttp.ClientTimeout(total=15),
                            ) as fast_resp:
                                if fast_resp.status == 200:
                                    async for raw_line in fast_resp.content:
                                        line = raw_line.decode("utf-8", errors="replace").strip()
                                        if not line.startswith("data:"):
                                            continue
                                        data_str = line[len("data:"):].strip()
                                        if data_str == "[DONE]":
                                            break
                                        try:
                                            chunk = json.loads(data_str)
                                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                                            if "content" in delta and delta["content"]:
                                                await self._push_voice_text_guarded(delta["content"])
                                        except (json.JSONDecodeError, IndexError, KeyError):
                                            continue
                        await self.push_frame(LLMFullResponseEndFrame())
                        logger.info("[NonBlockingRouter] Legacy Phase 2: voice follow-up delivered")
                    except Exception as followup_err:
                        logger.error(f"[NonBlockingRouter] Legacy Phase 2 follow-up error: {followup_err}")

        except asyncio.CancelledError:
            logger.info("[NonBlockingRouter] Legacy Phase 2 cancelled during teardown")
        except Exception as e:
            logger.error(f"[NonBlockingRouter] Legacy Phase 2 error: {e}")

    async def cleanup(self):
        tasks_to_cancel = list(self._background_tasks)
        if self._end_call_emit_task and not self._end_call_emit_task.done():
            tasks_to_cancel.append(self._end_call_emit_task)

        for task in tasks_to_cancel:
            task.cancel()
        for task in tasks_to_cancel:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception as exc:
                logger.debug(f"[NonBlockingRouter] Background task cleanup ignored error: {exc}")
        if self._http_session and not self._http_session.closed:
            await self._http_session.close()
        await super().cleanup()
