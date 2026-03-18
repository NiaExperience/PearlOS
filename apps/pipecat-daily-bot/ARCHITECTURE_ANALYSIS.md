# PearlOS Voice Pipeline — Architecture Analysis

**Date:** 2026-02-27  
**Analyst:** Independent subagent (architecture-analysis)  
**Codebase:** `apps/pipecat-daily-bot/bot/`  
**Commit:** HEAD (post-`84cd3b28` gold standard)

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Data Flow Diagram](#2-data-flow-diagram)
3. [The Two-Phase System](#3-the-two-phase-system)
4. [Entry Points & Session Lifecycle](#4-entry-points--session-lifecycle)
5. [File-by-File Documentation](#5-file-by-file-documentation)
6. [Configuration Audit](#6-configuration-audit)
7. [Structural Problems](#7-structural-problems)
8. [Gold Standard Comparison](#8-gold-standard-comparison)

---

## 1. Architecture Overview

PearlOS Voice is a real-time voice AI pipeline built on [Pipecat](https://github.com/pipecat-ai/pipecat) (an open-source framework for voice/video AI bots) connected to [Daily.co](https://daily.co) for WebRTC transport. The system has three main runtime processes:

| Process | File | Port | Role |
|---------|------|------|------|
| **Bot Gateway** | `bot_gateway.py` | 4444 | HTTP/WebSocket API for frontend. Room management, tool invocation, event relay |
| **Bot Runner** | `runner_main.py` | 7860 | FastAPI server that spawns Pipecat pipeline sessions per room |
| **OpenClaw Gateway** | (external) | 18789 | AI agent framework providing LLM + tools + sessions |

The voice pipeline itself runs inside the Bot Runner as an async Pipecat `PipelineTask`. Audio flows:

```
User Mic → Daily WebRTC → Deepgram STT → NonBlockingToolRouter → TTS → Daily WebRTC → Speaker
                                              ↕ (Phase 1: fast LLM)
                                              ↕ (Phase 2: OpenClaw agent)
                                              ↕ (Direct tools: WebSocket events to frontend)
```

## 2. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser)                       │
│  PearlOS UI ←──WebSocket──→ Bot Gateway (:4444)             │
│       ↑                         ↑                            │
│       │ WebRTC audio            │ HTTP API                   │
│       ↓                         ↓                            │
│  Daily.co Room  ←───────→  Bot Runner (:7860)               │
└─────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    ↓             ↓               ↓
            ┌──────────┐  ┌────────────┐  ┌─────────────┐
            │ Deepgram  │  │  TTS       │  │  OpenClaw   │
            │ STT       │  │ (Pocket/   │  │  Gateway    │
            │           │  │  ElevenLabs│  │  (:18789)   │
            └──────────┘  │  /Kokoro)  │  └─────────────┘
                          └────────────┘

INSIDE THE PIPECAT PIPELINE:
┌─────────────────────────────────────────────────────────────┐
│ Daily Transport (mic in)                                     │
│   → STT (Deepgram)                                          │
│   → User Context Aggregator                                  │
│   → NonBlockingToolRouter ─── Phase 1: fast LLM (Sonnet)    │
│   │                          │  ├─ Direct tools (keyword)    │
│   │                          │  ├─ Passthrough tools (gateway)│
│   │                          │  └─ Voice response → TTS      │
│   │                          ├── Phase 2: OpenClaw (background)│
│   │                          │   └─ Full agent with all tools │
│   → TTS (Pocket/ElevenLabs/Kokoro)                          │
│   → Daily Transport (speaker out)                            │
└─────────────────────────────────────────────────────────────┘
```

## 3. The Two-Phase System

The core architectural innovation is the **NonBlockingToolRouter** (`processors/non_blocking_router.py`), which splits voice interactions into two phases to minimize latency:

### Phase 1 — Fast Voice Response (~200ms TTFB)
- Uses a lightweight LLM (configured via `BOT_FAST_MODEL`, currently `anthropic/claude-sonnet-4-5`)
- Bypasses OpenClaw's ~9,350-token workspace context entirely
- Direct API call to the LLM provider (Anthropic, Groq, etc.)
- Streams tokens directly to TTS for immediate speech
- Has its own compact system prompt (`VOICE_FAST_SYSTEM`)
- Can emit tool_calls for **passthrough tools** (UI-only actions executed via gateway HTTP POST)
- Includes note content injection for read-back requests

### Phase 2 — OpenClaw Agent (background, 2-10s)
- Full OpenClaw agent session with complete workspace context
- Access to all tools: notes CRUD, web search, sub-agent spawning, etc.
- Results go to the frontend UI (canvas, app state) not to voice
- Skipped entirely if Phase 1 handled everything (direct tools or passthrough tools)

### Decision Logic
```
User speaks → STT transcription
  → Try direct keyword match (e.g., "close notes" → instant WebSocket event)
    → If matched: skip both phases, send voice ack only
  → Heuristic: does this need tools?
    → No: simple conversation, use fast LLM only (no Phase 2)
    → Yes: 
      → Phase 1: fast voice response + passthrough tool execution
      → Phase 2: full OpenClaw agent (if not all tools were passthrough)
```

### Tool Execution Paths (3 tiers)

| Tier | Mechanism | Latency | Example |
|------|-----------|---------|---------|
| **Direct tools** | Keyword matching → WebSocket event | ~5ms | "close notes", "play music" |
| **Passthrough tools** | Phase 1 LLM tool_call → HTTP POST to gateway | ~200ms | `bot_open_youtube`, `bot_wonder_canvas_template` |
| **Full tools** | Phase 2 OpenClaw agent | 2-10s | `bot_create_note`, `bot_web_search`, sub-agent spawn |

## 4. Entry Points & Session Lifecycle

### Session Start Flow
1. Frontend calls `POST /join` on Bot Gateway (:4444)
2. Gateway creates/reuses a Daily room, generates a token
3. Gateway calls `POST /start` on Bot Runner (:7860) with room URL + token
4. Runner creates `DailyRunnerArguments`, calls `bot()` function in `bot.py`
5. `bot()` calls `run_pipeline_session()` in `session/orchestrator.py`
6. Orchestrator:
   - Clears stale Redis state
   - Initializes session config (personality, voice, features)
   - Calls `build_pipeline()` in `pipeline/builder.py`
   - Creates Pipecat `PipelineTask` and `PipelineRunner`
   - Registers event handlers for participant join/leave
   - Runs the pipeline until session ends

### Pipeline Construction (`pipeline/builder.py`)
The `build_pipeline()` function is the heart of the system (~1,500 lines). It:
1. Loads workspace context (SOUL.md, IDENTITY.md, USER.md, activity log)
2. Fetches MSAM semantic memory (if available)
3. Creates Daily transport with STT configuration
4. Creates TTS service (Pocket, ElevenLabs, or Kokoro based on config)
5. Builds the main system prompt (personality + voice rules + tool hints)
6. In `openclaw_session` mode (current default):
   - Creates `NonBlockingToolRouter` as the LLM processor
   - Sets up `OpenClawSessionProcessor` as fallback
7. Assembles the Pipecat pipeline: transport_in → STT → context_aggregator → LLM → TTS → transport_out
8. Registers all tool handlers from `tools/toolbox.py`

### Event System
Events flow between bot and frontend via two channels:
- **Daily App Messages:** In-band messages through the Daily room (used by `AppMessageForwarder`)
- **WebSocket:** Direct connection between frontend and Bot Gateway

Key event types (defined in `tools/events.py`):
- `app.open` / `apps.close` — open/close apps
- `note.*` — note CRUD and navigation
- `wonder.*` — Wonder Canvas scene/template/animation
- `desktop.mode.switch` — switch desktop modes
- `soundtrack.control` — music playback
- `bot.session.end` — end call

### State Management
- **Room state** (`room/state.py`): Active note ID, active applet ID, tenant ID — stored in-memory dicts keyed by room URL
- **Flow state** (`flows/state.py`): Conversation flow state machine (greeting, active, wrapup)
- **Session state**: Participant tracking, speaking status, user profiles
- **Redis** (optional): Session registry, room-to-bot mapping (currently `USE_REDIS=false`)
- **LLM context**: Message history maintained by `NonBlockingToolRouter._messages` (last 40 messages)

## 5. File-by-File Documentation

### Top-Level Files

#### `bot.py`
Entry point called by Pipecat runner. Extracts room URL, token, personality, voice config from runner args. Delegates to `session.orchestrator.run_pipeline_session()`. ~140 lines. Imports `session.orchestrator`, `providers.daily`, `core.config`.

#### `runner_main.py`
FastAPI server (port 7860) that manages bot sessions. Endpoints: `POST /start`, `POST /sessions/{id}/leave`, `GET /sessions`, `POST /api/room/context`. Spawns async tasks for each session. ~870 lines. This is the **container entrypoint** when `MODE=runner`.

#### `bot_gateway.py`
FastAPI server (port 4444) — the main API for the frontend. Room management, WebSocket relay, tool invocation proxy, personality config, model settings, note/applet state. ~3,570 lines. **This file is too large and does too many things** (see Structural Problems). Container entrypoint when `MODE=gateway`.

#### `bot_operator.py`
Operator mode for managing bot fleet (multi-room). Handles room creation, session orchestration at scale.

#### `handlers.py`
Registers default event handlers on the Pipecat pipeline task (participant join/leave, speaking state, etc.).

#### `auth.py`
JWT/API key authentication middleware for gateway endpoints.

#### `loguru.py`
Loguru configuration helpers.

#### `pearlos_bridge.py`
Bridge to OpenClaw for sending events/commands. Legacy integration point.

#### `pearlos_ui.py`
UI state management for PearlOS frontend integration.

#### `comfyui_client.py`
Client for ComfyUI image generation (appears unused in current flow).

#### `test_photo_magic.py`
Test script for photo processing (not part of main pipeline).

### `core/` — Core Infrastructure

#### `core/config.py`
Centralized configuration with environment variable overrides. Defines `BOT_PID`, TTS settings, vision settings, model selections. ~200 lines.

#### `core/context.py`
`MultiUserContextAggregator` — Pipecat context aggregator that handles multi-user scenarios. Manages LLM context assembly from multiple speakers.

#### `core/prompts.py`
System prompt fragments: `MULTI_USER_NOTE`, `SMART_SILENCE_NOTE`, `ONBOARDING_NOTE`, `NOTES_NOTE`, `VOICE_COMMAND_NOTE`. These are appended to the main system prompt based on session features.

#### `core/transport.py`
Helpers for Daily transport setup. `set_transport()`, `get_session_user_id_from_participant()`.

#### `core/types.py`
Type definitions used across the codebase.

#### `core/utils.py`
Shared utility functions.

### `processors/` — Pipeline Processors

#### `processors/non_blocking_router.py` ⭐ (CRITICAL)
**The most important file in the codebase.** Implements the two-phase voice response system. ~1,460 lines. Contains:
- `VOICE_FAST_SYSTEM` — compact system prompt for Phase 1
- `DIRECT_TOOLS` — keyword-to-event mapping for instant execution
- `PHASE1_TOOL_DEFINITIONS` — OpenAI-format tool schemas for Phase 1 LLM
- `PASSTHROUGH_TOOL_WHITELIST` — tools safe for direct gateway execution
- `NonBlockingToolRouter` class with all the routing logic
- Note content injection for read-back
- Data follow-up streaming for data-rich tool results
- Dispatch intent detection (prevents misrouting "deploy agent" as "open news")

**Flag:** This file is growing rapidly and handles too many concerns. The direct tool matching, passthrough execution, note injection, and dispatch detection should be separated.

#### `processors/openclaw_session.py`
`OpenClawSessionProcessor` — streams responses from OpenClaw Gateway's `/v1/chat/completions` endpoint. Used as Phase 2 backend and as the main LLM service in non-two-phase mode. Includes filler phrase generation for natural "thinking" moments. ~530 lines.

#### `processors/anthropic_voice.py`
Native Anthropic voice mode (direct Claude API without OpenClaw). Has its own system prompt builder and tool registration. Alternative to the OpenClaw session path.

#### `processors/tool_narration.py`
Generates brief voice narrations when tools are executing ("Opening your notes...").

#### `processors/lull.py`
Detects conversation lulls (silence) and can trigger proactive behavior.

#### `processors/vision.py`
Captures video frames and sends them to a vision model for scene understanding.

### `pipeline/` — Pipeline Construction

#### `pipeline/builder.py` ⭐
`build_pipeline()` — constructs the entire Pipecat pipeline. ~1,570 lines. Loads workspace context, MSAM memory, creates transport/STT/TTS/LLM services, assembles pipeline, registers tools. Contains the OpenClaw system prompt.

**Flag:** At 1,570 lines, this function does far too much. Workspace loading, TTS creation, prompt construction, and tool registration should be separate modules.

### `session/` — Session Management

#### `session/orchestrator.py`
`run_pipeline_session()` — top-level session lifecycle. Initializes config, builds pipeline, runs it, handles cleanup. ~380 lines.

#### `session/initialization.py`
Loads personality config, voice settings, supported features from mesh API.

#### `session/lifecycle.py`
`SessionLifecycle` — manages session start/end, cleanup, conversation summary saving.

#### `session/managers.py`
`SessionManagers` — container for session-scoped service instances.

#### `session/events.py`
Event handler registration for session-level events.

#### `session/handlers.py`
Concrete event handler implementations (participant joined, left, etc.).

#### `session/participants.py`
Participant tracking and management.

#### `session/participant_data.py`
Data structures for participant info.

#### `session/context.py`
Session context management.

#### `session/identity.py`
Identity mapping between Daily participants and PearlOS users.

#### `session/config_listener.py`
Listens for runtime config changes (model switches, voice changes).

### `flows/` — Conversation Flow Engine

#### `flows/core.py`
Core flow manager — state machine for conversation phases.

#### `flows/state.py`
Flow state definitions (greeting, active, wrapup).

#### `flows/dispatcher.py`
Dispatches events to appropriate flow handlers.

#### `flows/factory.py`
Creates flow instances based on configuration.

#### `flows/handlers.py`
Flow event handlers (user speech, bot response, silence).

#### `flows/initialization.py`
`initialize_base_flow()` — sets up the flow engine for a session.

#### `flows/messages.py`
Message formatting for flow transitions.

#### `flows/nodes.py`
Flow graph nodes (conversation checkpoints).

#### `flows/operations.py`
Flow operations (transitions, state updates).

#### `flows/pacing.py`
Response pacing — controls timing between bot utterances.

#### `flows/registry.py`
Global registry of flow managers (keyed by room URL).

#### `flows/sanitization.py`
Text sanitization for flow content.

#### `flows/summary_tap.py`
Taps into conversation for summary generation.

#### `flows/types.py`
Flow-related type definitions.

#### `flows/utils.py`
Flow utility functions.

#### `flows/admin.py` / `flows/admin_handlers.py`
Admin-only flow commands.

### `tools/` — Tool Definitions

The tools system uses a decorator-based registration pattern (`@bot_tool`). Tools are auto-discovered by `tools/discovery.py` and registered via `tools/toolbox.py`.

#### `tools/decorators.py`
`@bot_tool` decorator — registers functions as LLM-callable tools with name, description, parameters, and feature flags.

#### `tools/discovery.py`
Auto-discovers all `@bot_tool`-decorated functions across tool modules.

#### `tools/toolbox.py`
Central tool registry. `register_all_tools()` collects discovered tools into Pipecat's tool system.

#### `tools/events.py`
Event ID constants for all tool-emitted events. Tries to import from `nia_events` package, falls back to string literals.

**Flag:** Event IDs are defined in THREE places in this file (try/except/except), leading to duplicates and potential inconsistencies.

#### Tool Modules
- **`tools/notes/`** — Full notes CRUD (create, read, update, delete, list, open, close, navigate, view control). ~6 files.
- **`tools/notes_control_tools.py`** — Scroll, highlight, navigate headings in notes. **Duplicates functionality in `tools/notes/view_control.py`.**
- **`tools/html/`** — HTML app creation tools.
- **`tools/sharing/`** — Note sharing tools.
- **`tools/wonder_canvas.py`** — Wonder Canvas scene push.
- **`tools/wonder_canvas_template_tool.py`** — Template-based canvas rendering.
- **`tools/wonder_canvas_templates.py`** — Template HTML registry (weather, news, bio, etc.). ~850 lines.
- **`tools/wonder_canvas_template_prompt.py`** — Design system prompt for canvas generation.
- **`tools/wonder_canvas_helpers.py`** — Canvas utility functions.
- **`tools/view_tools.py`** — App open/close tools (browser, terminal, Gmail, etc.). Several disabled per Blair directive.
- **`tools/news_tools.py`** — Live news from Google News RSS. **New since gold standard.**
- **`tools/weather_tools.py`** — Weather via Open-Meteo API. **New since gold standard.**
- **`tools/time_tools.py`** — Current time/date. **New since gold standard.**
- **`tools/youtube_tools.py`** — YouTube search and playback.
- **`tools/soundtrack_tools.py`** — Ambient music control.
- **`tools/sprite_tools.py`** / `sprite_bot_config.py` — Animated sprite characters.
- **`tools/openclaw_tools.py`** — OpenClaw task dispatch.
- **`tools/openclaw_canvas.py`** — Canvas operations via OpenClaw.
- **`tools/canvas_content_tools.py`** — Canvas content display (some disabled as duplicates).
- **`tools/profile_tools.py`** — User profile management.
- **`tools/onboarding_tools.py`** — First-time user onboarding.
- **`tools/experience_tools.py`** — Experience/activity tools.
- **`tools/vision_tools.py`** — Vision/camera tools.
- **`tools/window_tools.py`** — Window management (minimize, maximize, snap).
- **`tools/misc_tools.py`** — Wikipedia (disabled), miscellaneous.
- **`tools/task_control_tools.py`** / `task_feedback_tools.py` — Task management.
- **`tools/logging_utils.py`** — Tool-specific logging helpers.

### `services/` — External Service Clients

#### `services/mesh.py`
HTTP client for the Mesh API (content database). CRUD for notes, profiles, personalities.

#### `services/redis.py` / `services/redis_admin.py`
Redis client for session state (optional, currently disabled).

#### `services/app_message_forwarder.py`
`AppMessageForwarder` — sends tool events to the frontend via Daily app messages.

#### `services/user_profile.py`
User profile fetching and caching.

#### `services/canvas_cli.py`
Canvas CLI helper.

#### `services/openclaw_mesh_bridge.py`
Bridge between OpenClaw and Mesh API.

### `providers/` — Service Providers

#### `providers/daily.py`
Daily.co room/token management (create rooms, generate tokens).

#### `providers/elevenlabs.py`
ElevenLabs TTS provider configuration.

#### `providers/kokoro.py`
Kokoro/Chorus TTS WebSocket client.

#### `providers/pocket_tts.py`
Pocket TTS (local/self-hosted) provider.

### `actions/` — Business Logic

#### `actions/notes_actions.py`
Notes CRUD operations against Mesh API. List, create, update, delete, search notes.

#### `actions/profile_actions.py`
User profile operations. Session history, conversation summaries.

#### `actions/search_actions.py`
Search operations (Wikipedia, web).

#### `actions/html_actions.py`
HTML app CRUD operations.

#### `actions/personality_actions.py`
Personality/persona management.

#### `actions/sharing_actions.py`
Note sharing logic.

#### `actions/functional_prompt_actions.py`
Functional prompt management.

### Other Directories

#### `eventbus/`
Simple pub/sub event bus (`eventbus/bus.py`, `eventbus/events.py`). Used for internal bot events.

#### `filters/`
- `filters/silence.py` — Silence detection filter
- `filters/tts_text_filter.py` — Text cleaning before TTS (strip markdown, emoji)

#### `monitoring/`
- `monitoring/events.py` — TTS speaking event processor
- `monitoring/logging.py` — Monitoring/observability helpers

#### `pearl/`
- `pearl/journal.py` — Pearl's private journal context (reflections loaded into Phase 1)

#### `room/`
- `room/state.py` — Room-level state (active note, applet, tenant ID)

#### `utils/`
- `utils/async_utils.py` — Async helpers
- `utils/clause_text_aggregator.py` — Text aggregation utilities
- `utils/flow_utils.py` — Flow-related utilities
- `utils/greeting_utils.py` — Greeting logic
- `utils/logging_utils.py` — Logging utilities

#### `api/`
- `api/notes_api.py` — Notes API helpers

#### `tests/`
~40 test files covering various components. Mix of unit tests and integration tests.

## 6. Configuration Audit

### Key Environment Variables

| Variable | Current Value | Where Read | Purpose |
|----------|--------------|------------|---------|
| `BOT_LLM_MODE` | `openclaw_session` | `pipeline/builder.py` | LLM routing mode |
| `BOT_NON_BLOCKING_TOOLS` | `true` | `pipeline/builder.py` | Enable two-phase system |
| `BOT_FAST_MODEL` | `anthropic/claude-sonnet-4-5` | `non_blocking_router.py` | Phase 1 fast LLM |
| `BOT_VOICE_MODEL` | `groq/openai/gpt-oss-120b` | `core/config.py` | **Unused?** Voice model override |
| `BOT_TOOLS_MODEL` | `anthropic/claude-haiku-4-5` | `core/config.py` | Tools model |
| `BOT_MODEL_SELECTION` | `haiku` | `.env` | A/B test model |
| `BOT_OPENCLAW_AGENT` | `openclaw:voice` | `non_blocking_router.py` | OpenClaw agent target |
| `OPENCLAW_API_URL` | `http://localhost:18789/v1` | multiple | OpenClaw gateway URL |
| `OPENCLAW_API_KEY` | `c29b81...` | multiple | OpenClaw auth |
| `DAILY_API_KEY` | `eb5b09...` | `bot_gateway.py`, `providers/daily.py` | Daily.co API |
| `DAILY_ROOM_URL` | `https://pearlos.daily.co/...` | `bot.py` | Default room |
| `BOT_TTS_PROVIDER` | `pocket` | `core/config.py` | TTS provider |
| `POCKET_TTS_URL` | `http://localhost:8766` | `core/config.py` | Pocket TTS URL |
| `POCKET_TTS_SPEED` | `1.0` | `.env` | TTS speed |
| `GROQ_API_KEY` | `gsk_...` | `non_blocking_router.py` | Groq API |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | `non_blocking_router.py` | Anthropic API |
| `OPENROUTER_API_KEY` | `sk-or-...` | `.env` | OpenRouter (disabled) |
| `OPENROUTER_ENABLED` | `false` | `.env` | OpenRouter toggle |
| `MESH_API_ENDPOINT` | `http://localhost:2000/api` | `services/mesh.py` | Mesh API |
| `USE_REDIS` | `false` | `runner_main.py` | Redis toggle |
| `YOUTUBE_API_KEY` | `AIzaSy...` | `tools/youtube_tools.py` | YouTube API |
| `BOT_EMPTY_INITIAL_SECS` | `30` | `core/config.py` | Initial silence timeout |
| `BOT_MAX_SESSION_HISTORY` | `20` | `actions/profile_actions.py` | History cap |
| `MSAM_URL` | `http://127.0.0.1:3001` | `pipeline/builder.py` | Semantic memory |
| `OPENCLAW_WORKSPACE` | `/root/.openclaw/workspace` | `pipeline/builder.py` | Workspace path |

### Flags & Issues
- **`BOT_VOICE_MODEL=groq/openai/gpt-oss-120b`** — This looks like a stale/invalid model name. It's not clear this value is actually used anywhere in the current flow since `BOT_FAST_MODEL` takes precedence.
- **`OPENROUTER_ENABLED=false`** but `OPENROUTER_API_KEY` is still set — minor, but confusing.
- **`BOT_MODEL_SELECTION=haiku`** and `BOT_USE_SONNET_PRIMARY=false` — These appear to be legacy A/B test knobs that may not be active in `openclaw_session` mode.
- **API keys in `.env`** — Multiple real API keys visible. These should be in a secrets manager.
- **Hardcoded model identity** — `pipeline/builder.py` injects "You are Claude Sonnet 4.5" into the system prompt regardless of actual model.

## 7. Structural Problems

### 7.1. God Files
- **`bot_gateway.py` (3,572 lines):** This file is a FastAPI app, WebSocket server, room manager, tool proxy, model settings API, personality manager, and event relay all in one. Should be split into at least 5 modules.
- **`pipeline/builder.py` (1,569 lines):** The `build_pipeline()` function handles workspace loading, MSAM, transport creation, TTS creation, prompt construction, tool registration, and pipeline assembly. Each concern should be a separate function/module.
- **`non_blocking_router.py` (1,461 lines):** Handles Phase 1 LLM calls, Phase 2 dispatch, direct tool matching, passthrough execution, note content injection, dispatch detection, and data follow-up. Growing rapidly.

### 7.2. Duplicated Tool Definitions
- `tools/notes/view_control.py` and `tools/notes_control_tools.py` both define `bot_scroll_note` and `bot_highlight_note_text`. The `@bot_tool` decorator means both get registered, likely causing conflicts.
- `DIRECT_TOOLS` dict, `PASSTHROUGH_TOOL_WHITELIST`, `PHASE1_TOOL_DEFINITIONS`, and `_TOOL_WS_MAP` in `non_blocking_router.py` all define overlapping tool mappings that must be kept in sync manually.

### 7.3. Three-Way Event ID Definitions
`tools/events.py` defines event IDs in three separate blocks (import from `nia_events`, partial fallback with new events, full fallback). Some events like `NOTE_SCROLL` are defined twice (both in the try and except blocks).

### 7.4. Tight Coupling Between Router and Tools
The `NonBlockingToolRouter` has hardcoded knowledge of specific tool behaviors:
- Which tools are "data-rich" (`DATA_RICH_TOOLS`)
- Which need note context (`_needs_note_context`)
- Dispatch intent regex patterns
- Volume control parameter extraction
All of this should be declarative metadata on the tools themselves.

### 7.5. Missing Abstractions
- No tool execution abstraction — tools are executed via three completely different code paths (keyword match, gateway HTTP, OpenClaw agent) with no shared interface.
- No event bus abstraction for frontend communication — some tools use `forwarder.emit_tool_event()`, the router uses it directly, and the gateway has its own broadcast system.

### 7.6. Stale/Dead Code
- `comfyui_client.py` — appears unused
- `test_photo_magic.py` — test file in main bot directory
- Multiple disabled tools still have full implementations (just `@bot_tool` decorator removed)
- `BOT_USE_SONNET_PRIMARY`, `BOT_MODEL_SELECTION` — legacy A/B test config

### 7.7. No Tests for Critical Path
The `NonBlockingToolRouter` (the most critical component) has no dedicated unit tests. The two-phase system, tool routing, and note injection logic are untested.

### 7.8. Hardcoded Model Identity
`pipeline/builder.py` line ~1466 injects:
```
"You are Claude Sonnet 4.5 (anthropic/claude-sonnet-4-5). If asked what model you are, say Claude Sonnet 4.5."
```
This is hardcoded regardless of what model is actually configured. Violates the "respect the config" principle.

### 7.9. Synchronous MSAM Fetch
`_fetch_msam_context()` in `pipeline/builder.py` uses `urllib.request.urlopen` (synchronous) inside what should be an async context. This blocks the event loop for up to 3 seconds if MSAM is slow.

## 8. Gold Standard Comparison

Comparing `84cd3b28` (Feb 25 gold standard) to current HEAD. **12 commits** since gold standard.

### Changes Summary

| Commit | Description | Assessment |
|--------|-------------|------------|
| `f1de94fb` | Add `error_card`/`loading_card` to Phase 1 template enum | ✅ **Improvement** — fixes missing template availability |
| `79ced390` | Remove dead `_dispatch_openclaw_task` method | ✅ **Improvement** — cleanup |
| `1243d77b` | Let Phase 2 handle agent dispatch instead of short-circuiting | ✅ **Fix** — agents now actually spawn |
| `9fe435a1` | Dispatch agent directly to OpenClaw API | ⚠️ **Neutral** — superseded by `1243d77b` |
| `ca15d9b1` | Remove Wikipedia, `bot_close_view` (dup), `bot_canvas_clear` (dup) | ✅ **Improvement** — removes duplicates |
| `77e6a2ad` | Fix tool result data flow — Pearl speaks actual data | ✅ **Major improvement** — adds `_stream_data_followup` |
| `f8e1a3fb` | Remove browser, Gmail, Google Drive tools | ✅ **Improvement** — reduces tool surface area |
| `cc45fd7e` | Reduce speaking debounce 500ms → 150ms | ✅ **Improvement** — snappier lip sync |
| `90437e7e` | Merge remote `next-gen-ui` (accept remote voice prompt) | ⚠️ **Neutral** — merge commit |
| `2a35456c` | Add goodbye detection to voice prompt | ✅ **Improvement** — auto-end call on farewell |
| `524c1594` | Keep completed tasks visible until user confirms | ⚠️ **Neutral** — UI behavior change |
| `bee6b7bb` | Inject active note content into LLM context | ✅ **Major improvement** — prevents hallucination |

### Major Additions Since Gold Standard
1. **Phase 1 tool calling** — `PHASE1_TOOL_DEFINITIONS` and `PASSTHROUGH_TOOL_WHITELIST` allow Phase 1 LLM to directly execute UI tools via gateway, bypassing Phase 2 entirely for simple actions. **Improvement.**
2. **Note content injection** — `_fetch_active_note_content()` and `_needs_note_context()` inject real note content into Phase 1 context when user asks to read notes. Prevents hallucination. **Major improvement.**
3. **Data follow-up streaming** — `_stream_data_followup()` does a second LLM call with actual tool results so Pearl can speak real data (weather, news, time). **Major improvement.**
4. **Dispatch intent detection** — Regex matching to prevent "deploy agent to research news" from being misrouted as "open news app". **Important fix.**
5. **New tools** — `news_tools.py` (Google News RSS), `weather_tools.py` (Open-Meteo), `time_tools.py`, `notes/view_control.py` (scroll, highlight, navigate). **Feature additions.**
6. **Notes control duplication** — `notes_control_tools.py` duplicates `notes/view_control.py`. **Regression** (technical debt).
7. **Trimmed filler phrases** — `openclaw_session.py` fillers shortened from verbose to casual. **Improvement.**
8. **Sub-agent spawn guard** — Prompt addition to prevent duplicate sub-agent spawning. **Improvement.**
9. **MSAM semantic memory** — `_fetch_msam_context()` loads long-term memory at session start. **Feature addition** but uses synchronous HTTP.
10. **Hardcoded model identity** — "You are Claude Sonnet 4.5" injected regardless of config. **Regression** (violates config respect).
11. **Redesigned Wonder Canvas templates** — Complete visual overhaul with premium design system (fonts, colors, animations). **Major improvement** to visual quality.
12. **Profile action optimization** — `save_conversation_summary` now does single PATCH instead of multiple API calls. Session history capped at 20. **Improvement.**

### Regressions
1. **Duplicate tool registrations** (`notes_control_tools.py` vs `notes/view_control.py`)
2. **Hardcoded model identity** string
3. **Synchronous MSAM fetch** blocking the event loop
4. **Growing complexity** of `non_blocking_router.py` without corresponding tests

### Overall Assessment
The changes since gold standard are **net positive** — the Phase 1 tool calling, note content injection, and data follow-up features are significant improvements to user experience. However, the codebase is accumulating technical debt faster than it's being paid down. The core architectural decision (two-phase split) is sound, but the implementation is becoming unwieldy.

---

*Generated by independent architecture analysis subagent, 2026-02-27*
