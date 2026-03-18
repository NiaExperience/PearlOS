# Adversarial Audit Report — NonBlockingRouter & Voice Pipeline

**Date:** 2026-02-27  
**Auditor:** Subagent (adversarial-audit)  
**Scope:** `/workspace/nia-universal/apps/pipecat-daily-bot/bot/`

---

## Executive Summary

The NonBlockingRouter is a 1,461-line monolith with **significant dead code, inconsistent whitelists, concurrency issues, and multiple paths that silently skip Phase 2 (OpenClaw)**. The biggest risks are: (1) disabled tools still reachable via keyword matching, (2) dead dedup infrastructure that was never wired up, (3) race conditions on shared mutable state, and (4) hardcoded keyword lists that will silently fail on new tools.

**Findings: 5 CRITICAL, 8 HIGH, 9 MEDIUM, 6 LOW**

---

## 1. CRITICAL Findings

### C1. `_recent_tool_calls` — Dead Dedup Infrastructure (Never Used)
- **File:** `processors/non_blocking_router.py`, line 289
- **What:** `self._recent_tool_calls: dict[str, float] = {}` and `self._tool_dedup_window = 15.0` are initialized but **never read or written** anywhere else in the file.
- **Impact:** Tool deduplication between Phase 1 and Phase 2 is supposed to prevent double-execution but the mechanism was never implemented. Tools CAN fire twice.
- **Severity:** CRITICAL
- **Fix:** Either implement the dedup logic using `_recent_tool_calls` in `_run_two_phase` / `_execute_phase1_tool_calls`, or remove the dead fields. The existing `_phase1_tools_called` list partially addresses this but only for same-turn dedup, not cross-turn.

### C2. Disabled Tools Still Trigger via `_try_direct_tool` Keyword Matching
- **File:** `processors/non_blocking_router.py`, lines 569-581
- **What:** Gmail, browser, and Google Drive are "DISABLED per Blair directive 2026-02-26" in `PHASE1_TOOL_DEFINITIONS` and `PASSTHROUGH_TOOL_WHITELIST`, but `_try_direct_tool()` still has active keyword matching for them at lines 569 ("close gmail"), 575 ("close browser"), 581 ("close drive"), 606 ("open gmail"), 612 ("open browser"), 618 ("open drive"). These call `DIRECT_TOOLS["open_gmail"]` etc. which still exist in the `DIRECT_TOOLS` dict (lines 77-82).
- **Impact:** Saying "open gmail" fires `app.open` with `{"app": "gmail"}` via WebSocket AND returns `True` (skipping Phase 2). The disabled tool comment is misleading — the tools still work via the keyword path.
- **Severity:** CRITICAL
- **Fix:** Remove or comment out the keyword matching blocks for disabled tools in `_try_direct_tool()`, and remove corresponding entries from `DIRECT_TOOLS` dict.

### C3. `_try_direct_tool` Returns True → Skips Phase 2 for Many Intents
- **File:** `processors/non_blocking_router.py`, lines 488-728 + 790-801
- **What:** When `_try_direct_tool` returns `True`, Phase 2 is skipped entirely (line 800: `if direct_tool_handled or all_phase1_passthrough`). This means ANY utterance matching keyword patterns gets ONLY a WebSocket event + fast voice response. There is NO fallback to OpenClaw for complex variants.
- **Decision points that skip Phase 2:**
  - Line 544: "back to notes" variants (15+ phrases)
  - Line 551: "close notes" variants
  - Line 557: "close youtube" variants  
  - Line 563: "close terminal" variants
  - Line 569: "close gmail" (DISABLED but still active!)
  - Line 575: "close browser" (DISABLED but still active!)
  - Line 581: "close drive" (DISABLED but still active!)
  - Line 588: "open notes" variants
  - Line 594: "open youtube" variants
  - Line 600: "open terminal" variants
  - Line 606: "open gmail" (DISABLED but still active!)
  - Line 612: "open browser" (DISABLED but still active!)
  - Line 618: "open drive" (DISABLED but still active!)
  - Line 626: "open news" variants (with dispatch guard)
  - Line 633-657: Desktop mode switching (5 modes)
  - Line 664: "end call" / "bye pearl" variants
  - Line 671-683: Soundtrack play/stop/next
  - Line 689-695: Volume set via regex
  - Line 697-707: Volume up/down
  - Line 710-728: Window management (minimize, maximize, snap left/right)
  - Line 800: `all_phase1_passthrough` (ALL Phase 1 tools in whitelist → skip Phase 2)
- **Impact:** User says "open notes and create a new note about my meeting" — keyword "open notes" matches first, fires direct tool, returns True, Phase 2 never runs, note never created.
- **Severity:** CRITICAL
- **Fix:** `_try_direct_tool` should only return True for utterances that are PURELY the direct command. If the utterance contains additional intent beyond the keyword match, it should return False (or return the direct tool result but still allow Phase 2).

### C4. `PASSTHROUGH_TOOL_WHITELIST` vs `PHASE1_TOOL_DEFINITIONS` Mismatch
- **File:** `processors/non_blocking_router.py`, lines 131-170 vs 172-187
- **What:** `PASSTHROUGH_TOOL_WHITELIST` contains tools NOT in `PHASE1_TOOL_DEFINITIONS`:
  - `bot_close_applet_creation_engine` — in whitelist but no Phase 1 definition
  - `bot_adjust_soundtrack_volume` — in whitelist but no Phase 1 definition
  - `bot_get_current_soundtrack` — in whitelist but no Phase 1 definition
  - `bot_restore_window` — in whitelist but no Phase 1 definition
  - `bot_snap_window_left` — in whitelist but no Phase 1 definition
  - `bot_snap_window_right` — in whitelist but no Phase 1 definition
  - `bot_reset_window_position` — in whitelist but no Phase 1 definition
  - `bot_render_experience` — in whitelist but no Phase 1 definition
  - `bot_dismiss_experience` — in whitelist but no Phase 1 definition
  - `bot_summon_sprite` — in whitelist but no Phase 1 definition
  - `bot_show_share_dialog` — in whitelist but no Phase 1 definition
- **Impact:** These tools can never be called by Phase 1 (no schema for the fast LLM to emit them), so they're dead entries in the whitelist. If Phase 2 calls them, the whitelist check passes but they weren't in the dedup comparison.
- **Severity:** CRITICAL
- **Fix:** Either add Phase 1 definitions for these tools or remove them from the whitelist. The whitelist should exactly match what Phase 1 can produce.

### C5. `bot_openclaw_task` in `PHASE1_TOOL_DEFINITIONS` but NOT in `PASSTHROUGH_TOOL_WHITELIST`
- **File:** `processors/non_blocking_router.py`, line 164 (definition) vs line 172+ (whitelist)
- **What:** `bot_openclaw_task` has a Phase 1 tool definition so the fast LLM CAN emit it. But it's explicitly NOT in `PASSTHROUGH_TOOL_WHITELIST` (with a comment explaining why). However, `_execute_phase1_tool_calls` at line 435 skips tools not in the whitelist — so if Phase 1 emits `bot_openclaw_task`, it's silently dropped AND doesn't count toward `all_phase1_passthrough`, so Phase 2 WILL fire (correct). But the fast LLM wasted tokens generating a tool call that was discarded.
- **Impact:** Token waste on Phase 1 + confusing code. Not a functional bug since Phase 2 handles it, but the fast LLM may generate a `bot_openclaw_task` call AND text, producing garbled voice output.
- **Severity:** CRITICAL (borderline HIGH — the garbled output is the real risk)
- **Fix:** Either remove `bot_openclaw_task` from `PHASE1_TOOL_DEFINITIONS` (so the fast LLM never tries to call it) or handle it explicitly.

---

## 2. HIGH Findings

### H1. Shared Mutable State Without Locking
- **File:** `processors/non_blocking_router.py`, multiple lines
- **What:** These fields are mutated from both the main async path and background tasks without any lock:
  - `self._messages` (line 744 + line 1402): Main path rebuilds it, background task appends to it via context feedback
  - `self._phase1_tools_called` (line 997 + line 1042): Reset during Phase 1 stream, read during Phase 2 decision
  - `self._is_processing` (line 736, 753, 812, 815): Set/cleared in main path but checked without atomicity
  - `self._background_tasks` (line 805-807): Modified from both main path and done callbacks
- **Impact:** If a new user utterance arrives while Phase 2 background task is still appending context (line 1402), the message list can be corrupted.
- **Severity:** HIGH
- **Fix:** Add `asyncio.Lock` for `_messages` and `_phase1_tools_called`, or use a message queue pattern.

### H2. `re` Module Imported Twice Inside Functions
- **File:** `processors/non_blocking_router.py`, lines 507, 689
- **What:** `import re as _re_dispatch` (line 507) and `import re as _re` (line 689) inside `_try_direct_tool`. The module-level `import re` at line 14 is already available.
- **Impact:** No functional bug, but the aliased imports shadow the module-level one and create confusion. Also minor perf overhead on each call.
- **Severity:** HIGH (code quality / maintainability)
- **Fix:** Remove the local imports and use the module-level `re`.

### H3. `_tool_dedup_window` Never Used
- **File:** `processors/non_blocking_router.py`, line 290
- **What:** `self._tool_dedup_window = 15.0` — set but never read.
- **Impact:** Dead code indicating incomplete dedup implementation (see C1).
- **Severity:** HIGH
- **Fix:** Remove or implement.

### H4. Error Handling: Phase 1 Failure Produces Weak Fallback
- **File:** `processors/non_blocking_router.py`, lines 1024-1026, 1068-1070, 1073-1075
- **What:** When the fast LLM returns non-200, the fallback is `TextFrame(text="Sure, let me look into that. ")`. When it times out, `"Hmm, let me think about that. "`. Phase 2 still fires, but the voice response is generic.
- **Impact:** If the fast API is down consistently, every response is generic text + background tool execution. User never gets real voice answers.
- **Severity:** HIGH
- **Fix:** If Phase 1 fails, fall back to Phase 2 for BOTH voice AND tools (route OpenClaw output to TTS).

### H5. `_needs_tools_heuristic` Has Massive False Positive Rate
- **File:** `processors/non_blocking_router.py`, lines 831-848
- **What:** Keywords include extremely common words: "what is", "what's", "who is", "how do", "tell me about", "set", "change", "start", "stop", "close", "show me". Virtually ANY non-trivial user utterance will match.
- **Impact:** Almost every turn goes through the two-phase path (fast voice + background OpenClaw), wasting OpenClaw API calls. The "simple" path (`_stream_fast_voice_full`) is rarely reached.
- **Severity:** HIGH
- **Fix:** The heuristic needs to be much more specific, or the architecture should always use two-phase and let Phase 2 decide if tools are needed.

### H6. `BOT_FAST_MODEL` in .env is `anthropic/claude-sonnet-4-5` But Code Default is `groq/llama-3.1-8b-instant`
- **File:** `.env` (`BOT_FAST_MODEL=anthropic/claude-sonnet-4-5`) vs `processors/non_blocking_router.py` line 268
- **What:** The .env sets the fast model to Claude Sonnet 4.5 (Anthropic). The `_resolve_fast_api` function will detect `anthropic` prefix and use `ANTHROPIC_API_KEY`. But Anthropic's API uses `/v1/messages`, not `/v1/chat/completions` (OpenAI format).
- **Impact:** If using the Anthropic direct API, the `/chat/completions` endpoint at line 1007 will return 404 or error. The code assumes OpenAI-compatible chat completions format everywhere.
- **Severity:** HIGH
- **Fix:** Either use OpenRouter to proxy Anthropic models (which provides OpenAI-compatible format), or add Anthropic Messages API support. Or change `_PROVIDER_BASE_URLS["anthropic"]` to route through OpenRouter.

### H7. `_PROVIDER_BASE_URLS` Routes OpenAI Through OpenRouter
- **File:** `processors/non_blocking_router.py`, line 190
- **What:** `"openai": "https://openrouter.ai/api/v1"` — OpenAI models are routed through OpenRouter, but `.env` has `OPENROUTER_ENABLED=false`.
- **Impact:** OpenAI-prefixed models will try OpenRouter, which may or may not work depending on the key. Configuration contradiction.
- **Severity:** HIGH
- **Fix:** Clarify whether OpenRouter is enabled or not. If disabled, remove the OpenAI→OpenRouter routing.

### H8. `_suggest_tools_for_intent` Browser Reference After Disabling
- **File:** `processors/non_blocking_router.py`, line 866
- **What:** Comment says `# Browser disabled per Blair directive 2026-02-26` but there's no actual browser tool suggestion disabled — it was just removed. However, "search" and "look up" intents suggest `bot_openclaw_task with web_search` which is fine. The real issue is that the function returns suggestions that Phase 2 may not act on.
- **Impact:** LOW — just a comment noting the removal.
- **Severity:** LOW (noting for completeness)

---

## 3. MEDIUM Findings

### M1. `DIRECT_TOOLS` Dict Contains Entries Never Used by `_try_direct_tool`
- **File:** `processors/non_blocking_router.py`, lines 64-94
- **What:** `DIRECT_TOOLS` has entries like `"close_gmail"`, `"close_browser"`, `"close_drive"`, `"open_gmail"`, `"open_browser"`, `"open_drive"` which ARE used by `_try_direct_tool` (bug C2). But the dict structure itself is redundant with `_TOOL_WS_MAP` in `_tool_name_to_ws_event` (line 465).
- **Impact:** Two parallel mappings that must be kept in sync manually. Currently they ARE in sync but this is fragile.
- **Severity:** MEDIUM
- **Fix:** Consolidate into a single mapping.

### M2. `_tool_name_to_ws_event` Missing Several Passthrough Tools
- **File:** `processors/non_blocking_router.py`, lines 464-486
- **What:** `_TOOL_WS_MAP` is missing: `bot_switch_desktop_mode`, `bot_set_soundtrack_volume`, `bot_minimize_window`, `bot_maximize_window`, `bot_snap_window_*`, all Wonder Canvas tools, `bot_summon_sprite`, `bot_render_experience`, etc.
- **Impact:** The WS fallback path (line 452-457) will never fire for these tools since they're not in the map. If gateway HTTP fails, these tools silently fail.
- **Severity:** MEDIUM
- **Fix:** Extend the map or remove the fallback path if it's dead.

### M3. `DATA_RICH_TOOLS` References Tools Not in Phase 1
- **File:** `processors/non_blocking_router.py`, lines 1095-1099
- **What:** `DATA_RICH_TOOLS` includes `bot_get_weather`, `bot_get_news`, `bot_get_time`, `bot_get_current_time`, `bot_read_note`, `bot_get_note`, `bot_search_notes`, `bot_web_search`. NONE of these are in `PHASE1_TOOL_DEFINITIONS`.
- **Impact:** `_stream_data_followup` will never fire because Phase 1 can never call these tools. The entire data follow-up mechanism is dead code.
- **Severity:** MEDIUM
- **Fix:** Either add these tools to Phase 1 definitions or remove the data follow-up code.

### M4. Duplicate Log Line for Note Content Injection
- **File:** `processors/non_blocking_router.py`, lines 974-975
- **What:** Two nearly identical log lines:
  ```python
  logger.info(f"[NonBlockingRouter] Injected note content into Phase 1 context ({len(note_content)} chars)")
  logger.info(f"[NonBlockingRouter] Injected active note content ({len(note_content)} chars) into Phase 1 context")
  ```
- **Severity:** MEDIUM (code quality)
- **Fix:** Remove one.

### M5. Orphan Files — Potentially Dead Modules
- **File:** Various
- **What:** These files exist in the bot directory but may not be imported by the active pipeline:
  - `bot/comfyui_client.py` — ComfyUI image generation client, no imports found in pipeline
  - `bot/test_photo_magic.py` — Test file in production directory
  - `bot/pearlos_bridge.py` — Not imported by pipeline/builder.py
  - `bot/pearlos_ui.py` — Not imported by pipeline/builder.py
  - `bot/bot_operator.py` — References `ELEVENLABS_API_KEY` (line 626)
- **Severity:** MEDIUM
- **Fix:** Verify if these are actually used at runtime (could be imported dynamically). If dead, move to archive.

### M6. `providers/elevenlabs.py` Still Active
- **File:** `bot/providers/elevenlabs.py`, `bot/session/config_listener.py`
- **What:** ElevenLabs TTS provider is still a full provider implementation imported by `config_listener.py` (line 12). The `.env` uses `BOT_TTS_PROVIDER=pocket` but ElevenLabs code is still in the hot path for config changes.
- **Severity:** MEDIUM
- **Fix:** If ElevenLabs is deprecated, remove the provider and config_listener references.

### M7. `providers/kokoro.py` References ElevenLabs in Error Message
- **File:** `bot/providers/kokoro.py`, line 40
- **What:** `"Missing websockets dependency; ensure pipecat-ai[elevenlabs] is installed."` — Kokoro error message tells users to install ElevenLabs.
- **Severity:** MEDIUM
- **Fix:** Fix the error message.

### M8. `.env` Contains Hardcoded API Keys
- **File:** `.env`
- **What:** Production API keys (Daily, OpenRouter, Groq, MiniMax) are hardcoded in the .env file in the repo.
- **Severity:** MEDIUM (security)
- **Fix:** Use environment variable injection, secrets manager, or at minimum .env.local with .gitignore.

### M9. `bot_operator.py` References `ELEVENLABS_API_KEY`
- **File:** `bot/bot_operator.py`, line 626
- **What:** Still checks for ElevenLabs API key in operator configuration.
- **Severity:** MEDIUM
- **Fix:** Remove if ElevenLabs is deprecated.

---

## 4. LOW Findings

### L1. TODO/FIXME Comments
- `bot/tests/test_eventbus.py:32` — `# TODO: These tests hang, fix and refactor`
- `bot/session/lifecycle.py:247` — `# TODO: Track actual session start/end times`
- `bot/pipeline/builder.py:1077` — `# TODO: we may be in a 1:1 or multi-user scenario`
- `bot/actions/sharing_actions.py:522` — `# TODO: change 'createdBy' to 'userId'`
- `bot/pipeline/builder.py.backup` — Entire backup file shouldn't be in repo

### L2. `pipeline/builder.py.backup` in Production Directory
- **File:** `bot/pipeline/builder.py.backup`
- **What:** Backup file committed to repo.
- **Severity:** LOW
- **Fix:** Remove, use git for versioning.

### L3. `_cancel_event` Race Between Set and New Event Creation
- **File:** `processors/non_blocking_router.py`, lines 738-740
- **What:** `self._cancel_event.set()` followed by `self._cancel_event = asyncio.Event()` — a running stream could miss the cancellation if it checks the old event between these two lines.
- **Severity:** LOW (unlikely in single-threaded async, but worth noting)

### L4. `max_tokens=200` Too Low for Complex Acknowledgments
- **File:** `processors/non_blocking_router.py`, line 990
- **What:** Phase 1 voice response capped at 200 tokens except for note reading. Complex queries get truncated mid-sentence.
- **Severity:** LOW
- **Fix:** Increase to 300-400 or make dynamic.

### L5. `VOICE_FAST_SYSTEM` Is Not So "SHORT"
- **File:** `processors/non_blocking_router.py`, lines 47-58
- **What:** Comment says "Kept SHORT" but with identity context + journal context + activity log appended, it can be 2000+ tokens.
- **Severity:** LOW

### L6. `_BLOCKED_TOOL_ATTEMPTS` Global Mutable State in toolbox.py
- **File:** `bot/tools/toolbox.py`, lines 28-29, 46-55
- **What:** Module-level mutable dict `_BLOCKED_TOOL_ATTEMPTS` accessed without locks, keyed by `room_url`.
- **Severity:** LOW (single-threaded async, but still worth noting)

---

## 5. Control Flow Summary

```
process_frame (line 371)
  ├── StartInterruptionFrame → cancel + pass through
  ├── LLMMessagesFrame/OpenAILLMContextFrame/LLMContextFrame → extract messages
  │   └── _run_two_phase (line 731)
  │       ├── Throttle check (line 734-737) → DROP if < 0.2s
  │       ├── Cancel previous (line 738-740)
  │       ├── Sync message history (line 744-748)
  │       ├── Extract user_text (line 751-763)
  │       ├── Dedup check (line 770-777) → SKIP if same text < 30s (except tool intents)
  │       ├── _try_direct_tool (line 783) → if True, SKIP Phase 2 ★
  │       ├── _needs_tools_heuristic (line 787)
  │       │   ├── True (needs tools):
  │       │   │   ├── Cancel old background tasks (line 793-795)
  │       │   │   ├── _stream_fast_voice (Phase 1) (line 798)
  │       │   │   │   ├── Build context (system + last 5 messages)
  │       │   │   │   ├── Include PHASE1_TOOL_DEFINITIONS if needs tools
  │       │   │   │   ├── Stream response → TextFrames to TTS
  │       │   │   │   ├── Accumulate tool_calls from stream
  │       │   │   │   └── _execute_phase1_tool_calls → gateway HTTP
  │       │   │   ├── Check: all Phase 1 tools in PASSTHROUGH_WHITELIST?
  │       │   │   │   ├── Yes → SKIP Phase 2 ★
  │       │   │   │   └── No → _run_openclaw_background (Phase 2) as background task
  │       │   │   └── Phase 2: POST to OpenClaw, consume stream, inject context feedback
  │       │   └── False (simple):
  │       │       └── _stream_fast_voice_full (line 810)
  │       │           └── Stream response with full history → TextFrames to TTS
  │       └── Set _is_processing = False
  └── Other frames → pass through
```

**Points where Phase 2 is skipped (★):**
1. `_try_direct_tool` returns True (keyword match) — line 800
2. All Phase 1 tool calls are in `PASSTHROUGH_TOOL_WHITELIST` — line 800
3. `_needs_tools_heuristic` returns False — line 810 (simple path, no Phase 2)
4. Dedup skip — line 776-777
5. Throttle skip — line 736-737

---

## 6. Tool Schema Cross-Reference

| Tool Name | @bot_tool | PHASE1_DEFS | PASSTHROUGH_WL | DIRECT_TOOLS | _TOOL_WS_MAP |
|-----------|-----------|-------------|----------------|--------------|--------------|
| bot_open_notes | ✗ (view_tools) | ✓ | ✓ | ✓ | ✓ |
| bot_close_notes | ✗ (view_tools) | ✓ | ✓ | ✓(close_notes) | ✓ |
| bot_open_youtube | ✗ (view_tools) | ✓ | ✓ | ✓ | ✓ |
| bot_close_youtube | ✗ (view_tools) | ✓ | ✓ | ✓ | ✓ |
| bot_open_gmail | ✗ (DISABLED) | ✗ (commented) | ✗ (commented) | ✓ ❌ | ✗ (commented) |
| bot_close_gmail | ✗ (DISABLED) | ✗ (commented) | ✗ (commented) | ✓ ❌ | ✗ (commented) |
| bot_open_browser | ✗ (DISABLED) | ✗ (commented) | ✗ (commented) | ✓ ❌ | ✗ (commented) |
| bot_close_browser | — | ✗ | ✗ | ✓ ❌ | ✗ |
| bot_open_google_drive | ✗ (DISABLED) | ✗ (commented) | ✗ (commented) | ✓ ❌ | ✗ (commented) |
| bot_close_google_drive | — | ✗ | ✗ | ✓ ❌ | ✗ |
| bot_open_creation_engine | ✓ | ✓ | ✓ | ✗ | ✓ |
| bot_close_applet_creation_engine | ✓ | ✗ ❌ | ✓ | ✗ | ✓ |
| bot_switch_desktop_mode | ✓ | ✓ | ✓ | ✓ (5 modes) | ✗ ❌ |
| bot_play_soundtrack | ✓ | ✓ | ✓ | ✓ | ✓ |
| bot_stop_soundtrack | ✓ | ✓ | ✓ | ✓ | ✓ |
| bot_next_soundtrack_track | ✓ | ✓ | ✓ | ✓ | ✓ |
| bot_set_soundtrack_volume | ✓ | ✓ | ✓ | ✗ (regex) | ✗ ❌ |
| bot_adjust_soundtrack_volume | ✓ | ✗ ❌ | ✓ | ✗ (keyword) | ✗ ❌ |
| bot_get_current_soundtrack | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_minimize_window | ✓ | ✓ | ✓ | ✗ (keyword) | ✗ ❌ |
| bot_maximize_window | ✓ | ✓ | ✓ | ✗ (keyword) | ✗ ❌ |
| bot_restore_window | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_snap_window_left | ✓ | ✗ ❌ | ✓ | ✗ (keyword) | ✗ ❌ |
| bot_snap_window_right | ✓ | ✗ ❌ | ✓ | ✗ (keyword) | ✗ ❌ |
| bot_reset_window_position | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_render_experience | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_dismiss_experience | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_end_call | ✗ | ✓ | ✓ | ✓ | ✓ |
| bot_summon_sprite | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_show_share_dialog | ✓ | ✗ ❌ | ✓ | ✗ | ✗ |
| bot_openclaw_task | ✓ | ✓ | ✗ (intentional) | ✗ | ✗ |
| bot_wonder_canvas_* | ✓ | ✓ (5 tools) | ✓ (6 tools) | ✗ | ✗ |
| bot_open_news | ✓ | ✓ | ✓ | ✓ | ✓ |

**❌ = Inconsistency / missing entry**

---

## 7. Recommendations (Priority Order)

1. **Fix C2 immediately** — Remove disabled tool keyword matching from `_try_direct_tool` and `DIRECT_TOOLS`
2. **Fix C3** — Make `_try_direct_tool` aware of compound intents (don't skip Phase 2 for multi-action utterances)
3. **Fix C4** — Sync `PASSTHROUGH_TOOL_WHITELIST` with `PHASE1_TOOL_DEFINITIONS`
4. **Fix C1** — Either implement or remove `_recent_tool_calls`
5. **Fix H1** — Add asyncio.Lock for shared mutable state
6. **Fix H6** — The Anthropic direct API incompatibility is a ticking bomb if anyone uses `anthropic/` prefix models
7. **Consolidate** the 4 parallel tool mapping structures (DIRECT_TOOLS, PHASE1_TOOL_DEFINITIONS, PASSTHROUGH_TOOL_WHITELIST, _TOOL_WS_MAP) into ONE source of truth
8. **Remove dead code**: `_recent_tool_calls`, `_tool_dedup_window`, `DATA_RICH_TOOLS` + `_stream_data_followup`
9. **Remove orphan files**: `comfyui_client.py`, `test_photo_magic.py`, `builder.py.backup`

---

*Report generated 2026-02-27 03:41 UTC by adversarial-audit subagent*
