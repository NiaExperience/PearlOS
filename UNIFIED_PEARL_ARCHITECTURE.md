# Unified Pearl Architecture: Deepseek Primary + Opus Background

**Author:** Pearl (Opus Architect Subagent)  
**Date:** 2026-02-16  
**Deadline:** Wednesday 2026-02-18 (Demo)  
**Status:** DESIGN COMPLETE — Ready for implementation

---

## 1. Executive Summary

Pearl currently runs as three separate brains depending on channel:
- **Voice (PearlOS):** Deepseek V3 via direct API (fast, $0.27/M input tokens)
- **Discord:** Claude Sonnet 4.5 via OpenClaw Gateway (smart, $3/M input tokens)
- **Telegram:** Claude Sonnet 4.5 via OpenClaw Gateway (same as Discord)

This creates a split-personality problem: Voice Pearl and Discord Pearl have different capabilities, different reasoning quality, and different context. Users notice.

**The Fix:** Route ALL channels through a unified architecture where:
1. **Deepseek V3** handles all primary conversation (fast, cheap, good enough for 90% of tasks)
2. **Shared workspace memory** keeps all sessions aware of each other
3. **Opus escalates transparently** when Deepseek hits its limits (complex code, deep analysis)
4. **No handoff is visible** — the user just sees "Pearl thinking longer"

---

## 2. Current Architecture (AS-IS)

```
┌─────────────────────────────────────────────────────────────┐
│                     CURRENT STATE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  VOICE (PearlOS)          DISCORD           TELEGRAM        │
│  ┌──────────────┐    ┌──────────────┐  ┌──────────────┐    │
│  │ User (mic)   │    │ User (text)  │  │ User (text)  │    │
│  └──────┬───────┘    └──────┬───────┘  └──────┬───────┘    │
│         │                   │                  │            │
│         ▼                   ▼                  ▼            │
│  ┌──────────────┐    ┌──────────────────────────────┐      │
│  │ Daily.co     │    │ OpenClaw Gateway (:18789)     │      │
│  │ WebRTC       │    │ ┌──────────────────────────┐  │      │
│  └──────┬───────┘    │ │ Claude Sonnet 4.5        │  │      │
│         │            │ │ (Anthropic API direct)    │  │      │
│         ▼            │ └──────────────────────────┘  │      │
│  ┌──────────────┐    │ ┌──────────────────────────┐  │      │
│  │ Pipecat Bot  │    │ │ Workspace Files          │  │      │
│  │ Gateway      │    │ │ SOUL.md, MEMORY.md, etc  │  │      │
│  │ (:4444)      │    │ └──────────────────────────┘  │      │
│  ├──────────────┤    │ ┌──────────────────────────┐  │      │
│  │ Deepseek V3  │    │ │ Opus Sub-agents          │  │      │
│  │ (direct API) │    │ │ (spawned for heavy work) │  │      │
│  ├──────────────┤    │ └──────────────────────────┘  │      │
│  │ PocketTTS    │    └──────────────────────────────┘      │
│  │ (Azelma)     │                                          │
│  └──────────────┘                                          │
│                                                             │
│  PROBLEMS:                                                  │
│  ❌ Voice Pearl can't spawn Opus sub-agents                │
│  ❌ Voice Pearl reads workspace files but doesn't write    │
│  ❌ Discord Pearl doesn't know what Voice Pearl discussed  │
│  ❌ No escalation path from Deepseek → Opus in voice      │
│  ❌ Voice uses 71 PearlOS tools; Discord uses exec/search  │
│  ❌ Two separate system prompt construction paths           │
│  ❌ bot_openclaw_task is fire-and-forget, not conversational│
└─────────────────────────────────────────────────────────────┘
```

### Current Data Flow Detail

**Voice Path (slow for complex tasks):**
```
User Speech → Deepgram STT → Pipecat → Deepseek V3 API → Response
                                          ↓ (if complex)
                                    bot_openclaw_task
                                          ↓
                                    Daily app-message
                                          ↓
                                    OpenClawEventBridge (React)
                                          ↓
                                    /api/openclaw-bridge route
                                          ↓
                                    OpenClaw Gateway (:18789)
                                          ↓
                                    Claude Sonnet (Anthropic)
                                          ↓
                                    SSE stream → UI only (NOT back to voice)
```

**Discord/Telegram Path:**
```
User Message → OpenClaw Gateway → Claude Sonnet → Response
                                      ↓ (if complex)
                                  sessions_spawn (Opus sub-agent)
                                      ↓
                                  Background work → result back to session
```

---

## 3. Target Architecture (TO-BE)

```
┌─────────────────────────────────────────────────────────────────┐
│                    UNIFIED PEARL ARCHITECTURE                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  VOICE (PearlOS)       DISCORD          TELEGRAM                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ User (mic)   │  │ User (text)  │  │ User (text)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                  │                   │
│         ▼                 ▼                  ▼                   │
│  ┌──────────────┐  ┌──────────────────────────────────┐         │
│  │ Daily.co     │  │ OpenClaw Gateway (:18789)         │         │
│  │ WebRTC       │  │                                   │         │
│  └──────┬───────┘  │  ┌───────────────────────────┐   │         │
│         │          │  │ DEEPSEEK V3 (primary)     │   │         │
│         ▼          │  │ via OpenRouter/direct API  │   │         │
│  ┌──────────────┐  │  │ All conversation, tools    │   │         │
│  │ Pipecat Bot  │  │  └─────────┬─────────────────┘   │         │
│  │ Gateway      │  │            │                      │         │
│  │ (:4444)      │  │            │ (escalation trigger) │         │
│  ├──────────────┤  │            ▼                      │         │
│  │ Deepseek V3  │  │  ┌───────────────────────────┐   │         │
│  │ (direct API) │  │  │ OPUS 4 (background)       │   │         │
│  │ + PearlOS    │  │  │ Spawned as sub-agent      │   │         │
│  │   tools      │  │  │ Results written to files   │   │         │
│  ├──────────────┤  │  │ or injected into context   │   │         │
│  │ PocketTTS    │  │  └───────────────────────────┘   │         │
│  │ (Azelma)     │  │                                   │         │
│  └──────┬───────┘  └────────────────┬─────────────────┘         │
│         │                           │                            │
│         └───────────┬───────────────┘                            │
│                     ▼                                            │
│         ┌───────────────────────────┐                            │
│         │ SHARED MEMORY LAYER       │                            │
│         │ /root/.openclaw/workspace │                            │
│         │ ┌───────────────────────┐ │                            │
│         │ │ SOUL.md (identity)    │ │                            │
│         │ │ MEMORY.md (long-term) │ │                            │
│         │ │ memory/*.md (daily)   │ │                            │
│         │ │ activity-log.md       │ │                            │
│         │ │ session-state.json    │ │  ← NEW: real-time state   │
│         │ └───────────────────────┘ │                            │
│         └───────────────────────────┘                            │
│                                                                  │
│  WHAT'S DIFFERENT:                                               │
│  ✅ Discord/Telegram use Deepseek V3 as primary (not Sonnet)    │
│  ✅ Voice Pearl writes activity log after significant exchanges  │
│  ✅ Opus spawns silently when Deepseek recognizes complexity     │
│  ✅ session-state.json provides real-time cross-session context  │
│  ✅ Single personality construction path for all channels        │
│  ✅ Voice can trigger Opus work that feeds back into voice conv  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Component Design

### 4.1 Deepseek V3 as Primary Brain (All Channels)

**Current state:** Voice uses Deepseek, Discord/Telegram use Sonnet via OpenClaw.

**Change for OpenClaw Gateway:**

OpenClaw's `openclaw.json` currently defaults to `anthropic/claude-sonnet-4-5`. We need to either:

**Option A (Recommended): OpenClaw model override via config**
Change `openclaw.json` to route through Deepseek:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "deepseek/deepseek-chat"
      }
    }
  }
}
```
This requires OpenClaw to support Deepseek as a provider. OpenClaw uses the OpenAI-compatible `/v1/chat/completions` API internally, and Deepseek's API is OpenAI-compatible, so this should work if we configure the base URL.

**Option B: OpenClaw proxy through Deepseek**
Add Deepseek as a custom provider in OpenClaw's auth profiles:
```json
{
  "auth": {
    "profiles": {
      "deepseek:default": {
        "provider": "deepseek",
        "mode": "token",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "sk-b0869b89b5e14405b1eb76b9a3fa8d4f"
      }
    }
  }
}
```

**Option C (Fastest, for demo): Keep OpenClaw on Sonnet, align behavior via system prompt**
Don't change OpenClaw's model — just ensure both brains have identical personality/behavior via shared SOUL.md. This is the lowest-risk approach for the Wednesday demo.

**Recommendation for Wednesday demo:** Option C (no model change in OpenClaw). Deepseek is already working great in voice. Sonnet is already working great in Discord/Telegram. The priority is shared context, not model unification. Model unification is a post-demo optimization.

**Post-demo:** Option A or B, once we verify Deepseek handles tool calling well enough for OpenClaw's exec/web_search/message tools.

### 4.2 Shared Memory System

**Current state:** Partially implemented. `load_workspace_context()` in builder.py reads SOUL.md, IDENTITY.md, USER.md, and activity-log.md into the voice system prompt. OpenClaw sessions read the same files via AGENTS.md instructions.

**What's missing:**
1. Voice Pearl doesn't WRITE to activity-log.md after conversations
2. No real-time cross-session state (e.g., "user is currently in a voice call")
3. No shared conversation summary between channels

**New component: `session-state.json`**

```json
{
  "activeChannels": {
    "voice": {
      "active": true,
      "since": "2026-02-16T00:30:00Z",
      "lastInteraction": "2026-02-16T00:32:00Z",
      "topic": "discussing demo preparation",
      "mood": "focused"
    },
    "discord": {
      "active": true,
      "since": "2026-02-15T23:00:00Z",
      "lastInteraction": "2026-02-16T00:25:00Z",
      "topic": "architecture planning"
    }
  },
  "recentTopics": [
    "Wednesday demo deadline",
    "Deepseek integration",
    "Unified Pearl architecture"
  ],
  "pendingTasks": [
    {
      "id": "opus-123",
      "description": "Research local model alternatives",
      "status": "in_progress",
      "spawned_from": "discord",
      "started": "2026-02-16T00:15:00Z"
    }
  ]
}
```

**Implementation in voice pipeline:**
Add a post-conversation hook to the Pipecat bot that:
1. Summarizes the conversation (use Deepseek itself — cheap)
2. Appends to `activity-log.md`
3. Updates `session-state.json`

This can be a new processor in the pipeline or a cleanup handler in `run_pipeline_session`.

### 4.3 Transparent Opus Escalation

**Current state:** 
- Discord/Telegram: OpenClaw can spawn Opus sub-agents via `sessions_spawn`
- Voice: `bot_openclaw_task` fires a Daily app-message that goes through the React UI bridge to OpenClaw. Results appear in the UI but NOT back in the voice conversation.

**The problem with `bot_openclaw_task`:**
It's fire-and-forget. The voice LLM says "I've sent that to OpenClaw" and moves on. The result never feeds back into the conversation context. This is NOT transparent escalation — it's delegation with visible handoff.

**New design: Synchronous Opus escalation tool**

Replace the current async bridge with a synchronous tool that:
1. Calls OpenClaw Gateway directly via HTTP (not through Daily/React bridge)
2. Waits for the response (with timeout)
3. Injects the result back into the voice conversation context
4. Pearl speaks the result naturally

```python
@bot_tool(
    name="bot_think_deeply",
    description=(
        "When you encounter a question or task that requires deep analysis, "
        "complex reasoning, code generation, or multi-step research, use this "
        "tool to think more deeply. This activates enhanced reasoning capabilities. "
        "The result will be returned to you to share with the user naturally."
    ),
    feature_flag="openclawBridge",
    parameters={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "The question or task requiring deep analysis"
            },
            "context": {
                "type": "string",
                "description": "Relevant context from the conversation"
            }
        },
        "required": ["question"]
    }
)
async def bot_think_deeply(params: FunctionCallParams):
    """Synchronous escalation to Opus via OpenClaw Gateway."""
    arguments = params.arguments or {}
    question = arguments.get("question", "")
    context = arguments.get("context", "")
    
    import aiohttp
    
    openclaw_url = os.getenv("OPENCLAW_API_URL", "http://localhost:18789/v1")
    openclaw_key = os.getenv("OPENCLAW_API_KEY", "openclaw-local")
    
    # Call OpenClaw with Opus model specified
    payload = {
        "model": "anthropic/claude-opus-4-6",
        "messages": [
            {"role": "system", "content": "You are Pearl's deep reasoning engine. Provide thorough, accurate analysis. Be concise but complete."},
            {"role": "user", "content": f"Context: {context}\n\nQuestion: {question}"}
        ],
        "stream": False,
        "max_tokens": 2048
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{openclaw_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {openclaw_key}"},
            timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            if resp.status == 200:
                data = await resp.json()
                result = data["choices"][0]["message"]["content"]
            else:
                result = "I need a moment to think about this differently."
    
    await params.result_callback(
        {"success": True, "analysis": result},
        properties=FunctionCallResultProperties(run_llm=True),
    )
```

**Key insight:** The user never sees "escalating to Opus." Deepseek decides it needs to think harder, calls the tool, gets the result, and speaks it naturally. From the user's perspective, Pearl just "thought for a moment."

**Voice UX during escalation:**
The existing `ToolNarrationProcessor` will emit filler phrases ("Let me think about that..." / "Hmm, working through this...") during the 5-15 second Opus call, preventing dead air.

### 4.4 Channel-Specific Tool Routing

**Voice channel** has 71+ PearlOS tools (notes, YouTube, windows, soundtracks, etc.) plus the new `bot_think_deeply` for Opus escalation.

**Discord/Telegram** have OpenClaw's tool suite (exec, web_search, web_fetch, message, browser, etc.) plus native Opus sub-agent spawning.

**Do NOT try to unify tool sets.** PearlOS tools control a visual desktop — they're meaningless in Discord. OpenClaw tools execute in a sandboxed environment — they don't touch the PearlOS UI. The tools should stay channel-appropriate.

**What to unify:** The PERSONALITY and CONTEXT, not the tools. Pearl should sound the same, remember the same things, and have the same opinions regardless of channel.

---

## 5. Files That Need Changes

### 5.1 Critical Path (Must-have for Wednesday demo)

| # | File | Change | Risk | Effort |
|---|------|--------|------|--------|
| 1 | `apps/pipecat-daily-bot/bot/tools/openclaw_tools.py` | Replace `bot_openclaw_task` with `bot_think_deeply` (synchronous Opus escalation) | Medium | 2-3 hours |
| 2 | `apps/pipecat-daily-bot/bot/pipeline/builder.py` | Add activity-log WRITE after session ends; ensure `bot_think_deeply` is registered | Low | 1-2 hours |
| 3 | `/root/.openclaw/workspace/memory/activity-log.md` | Voice sessions will now append here (currently only Discord/Telegram do) | None | Automatic |
| 4 | `apps/pipecat-daily-bot/.env` | Verify `DEEPSEEK_API_KEY` has credits, `OPENCLAW_API_URL` correct | Low | 15 min |

### 5.2 Nice-to-Have (Post-demo polish)

| # | File | Change | Risk | Effort |
|---|------|--------|------|--------|
| 5 | `/root/.openclaw/openclaw.json` | Switch primary model to Deepseek (once tested with OpenClaw tools) | High | 2-4 hours testing |
| 6 | `/root/.openclaw/workspace/SOUL.md` | Refine to include explicit cross-channel awareness instructions | Low | 30 min |
| 7 | `apps/pipecat-daily-bot/bot/pipeline/builder.py` → `load_workspace_context()` | Add `session-state.json` reading/writing | Low | 1-2 hours |
| 8 | New file: `apps/pipecat-daily-bot/bot/hooks/session_memory.py` | Post-session summary writer (conversation → activity log) | Low | 2-3 hours |
| 9 | `apps/interface/src/app/api/openclaw-bridge/route.ts` | Update or deprecate (no longer needed if voice calls OpenClaw directly) | Low | 30 min |
| 10 | New file: `/root/.openclaw/workspace/memory/session-state.json` | Cross-session real-time state | None | Auto-created |

### 5.3 Files That Must NOT Change (Stability)

| File | Reason |
|------|--------|
| `apps/pipecat-daily-bot/bot/core/transport.py` | Daily transport layer — touching this risks voice stability |
| `apps/pipecat-daily-bot/bot/providers/*` | TTS providers are working — don't touch |
| `apps/pipecat-daily-bot/bot/flows/*` | Flow management works — no reason to change |
| `apps/mesh/*` | GraphQL/database layer — stable, no changes needed |
| OpenClaw Gateway binary | Don't restart unless absolutely necessary |

---

## 6. Migration Plan (Implementation Order)

### Phase 1: Synchronous Opus Escalation (Monday evening, 3-4 hours)
**Goal:** Voice Pearl can "think deeply" using Opus without the user noticing a handoff.

1. **Create `bot_think_deeply` tool** in `openclaw_tools.py`
   - Direct HTTP call to OpenClaw Gateway `/v1/chat/completions`
   - Model: `anthropic/claude-opus-4-6`
   - Timeout: 30 seconds
   - Returns result as tool output → Deepseek incorporates into response
   
2. **Keep `bot_openclaw_task`** as a separate async delegation tool (for truly long-running tasks)
   - Rename description to clarify it's for background tasks that take minutes

3. **Test voice session:**
   - Ask Pearl a complex question ("Explain quantum entanglement and its implications for computing")
   - Verify Deepseek calls `bot_think_deeply`
   - Verify result is spoken naturally
   - Verify `ToolNarrationProcessor` fills the gap during Opus call

### Phase 2: Activity Log Integration (Monday night, 1-2 hours)
**Goal:** Voice sessions contribute to the shared activity log.

1. **Add session end hook** to `run_pipeline_session` (or `bot_gateway.py`)
   - On session end, summarize key topics via Deepseek (1 API call, ~$0.001)
   - Append to `memory/activity-log.md`
   - Format: `[YYYY-MM-DD HH:MM] [voice] — {summary}`

2. **Test cross-session awareness:**
   - Have a voice conversation about topic X
   - Open Discord and ask "What was I talking about earlier?"
   - Verify Discord Pearl reads the activity log and knows about topic X

### Phase 3: System Prompt Alignment (Tuesday morning, 1 hour)
**Goal:** All channels present the same Pearl personality.

1. **Audit SOUL.md** for voice-specific vs universal instructions
2. **Ensure `load_workspace_context()`** captures all context Discord Pearl gets
3. **Add cross-channel identity note** (already partially done — verify it's complete)

### Phase 4: Demo Prep (Tuesday afternoon, 2 hours)
**Goal:** Polish and test the full demo flow.

1. Test voice → Opus escalation (smooth, no dead air)
2. Test cross-session memory (voice ↔ Discord)
3. Test PearlOS tools (notes, YouTube) still work fast
4. Prepare 3-minute demo script showing unified Pearl

---

## 7. Risk Assessment

### 🔴 HIGH RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Deepseek API has no credits** | Voice Pearl goes silent | Check balance NOW. Top up $20. Have GPT-4o-mini as fallback in `BOT_MODEL_SELECTION` |
| **Opus call exceeds 30s timeout** | Dead air in voice session | ToolNarrationProcessor fills gap; add 30s hard timeout; fallback to Deepseek-only response |
| **OpenClaw Gateway crash during demo** | All Discord/Telegram go down | Don't restart gateway unless necessary. Voice is independent (direct API) |
| **Deepseek tool calling quality** | Wrong tools called, weird behavior | Deepseek V3 has good tool calling; test with existing 71 tools before demo |

### 🟡 MEDIUM RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Activity log gets too large** | System prompt bloats, context overflow | Only load last 10 entries (already implemented in `load_workspace_context`) |
| **Simultaneous voice + Discord sessions conflict** | File write race conditions on activity-log.md | Use append-only writes with atomic file operations |
| **`bot_think_deeply` confuses Deepseek** | Deepseek calls it for everything or never | Careful description engineering; test with various prompts |
| **aiohttp dependency missing** | `bot_think_deeply` fails to import | Check if aiohttp is in Pipecat's requirements; install if needed |

### 🟢 LOW RISK

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Session-state.json stale data** | Minor context inaccuracy | Acceptable for demo; add TTL check post-demo |
| **Personality drift between channels** | Slightly different vibes | Already mitigated by shared SOUL.md; fine-tune post-demo |

---

## 8. Rollback Plan

### If Phase 1 (Opus Escalation) fails:
```bash
# Revert openclaw_tools.py to current version
cd /workspace/nia-universal
git checkout -- apps/pipecat-daily-bot/bot/tools/openclaw_tools.py

# Restart bot gateway
kill $(pgrep -f "uvicorn bot_gateway") && cd apps/pipecat-daily-bot && \
python3 -m uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 &
```
**Result:** Voice goes back to Deepseek-only (no Opus escalation). Still works, just less smart on complex queries.

### If Phase 2 (Activity Log) fails:
```bash
# Just remove the session end hook — activity log writes are append-only
# No data loss possible. Revert the specific function in builder.py.
git checkout -- apps/pipecat-daily-bot/bot/pipeline/builder.py
```
**Result:** Voice sessions stop writing to activity log. Cross-session awareness degrades to current state (Discord-only writes).

### If OpenClaw Gateway crashes:
```bash
# Restart gateway (30 second downtime)
openclaw gateway restart

# Voice is UNAFFECTED (uses Deepseek directly)
# Discord/Telegram will auto-reconnect
```

### Nuclear option (revert everything):
```bash
cd /workspace/nia-universal
git stash  # Save all changes

# Restore bot .env to known-good state
# BOT_MODEL_SELECTION=deepseek-chat (already current)
# BOT_USE_SONNET_PRIMARY=false (already current)

# Restart services
kill $(pgrep -f "uvicorn bot_gateway")
cd apps/pipecat-daily-bot
python3 -m uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 &
```

---

## 9. Demo Script (Wednesday)

### Act 1: Voice Intelligence (60 seconds)
> Friend opens PearlOS, starts voice session.
> "Pearl, open my notes and create a new note called 'Demo Ideas'."
> Pearl opens notes instantly (Deepseek → PearlOS tools, sub-second).
> "Now, write a comprehensive analysis of how AI assistants will evolve in the next 5 years."
> Pearl says "Let me think deeply about this..." (Opus escalation triggered)
> 8 seconds later, Pearl speaks a thoughtful, nuanced analysis (Opus result)
> The note is updated with the full text on screen.

### Act 2: Cross-Channel Memory (60 seconds)
> Friend opens Discord.
> "Hey Pearl, what was I just working on?"
> Pearl: "You were just in a voice session where you created a 'Demo Ideas' note about AI assistant evolution. Want me to continue developing those ideas?"
> (Demonstrates shared memory via activity log)

### Act 3: Seamless Personality (60 seconds)
> Switch between voice and Discord rapidly.
> Pearl maintains the same personality, same opinions, same context.
> "She's the same Pearl everywhere — not three different bots with the same name."

---

## 10. Architecture Decision Records

### ADR-1: Keep Sonnet in OpenClaw for now (don't switch to Deepseek)
**Decision:** Don't change OpenClaw's primary model for the Wednesday demo.
**Rationale:** 
- Sonnet is proven with OpenClaw's tool suite (exec, web_search, etc.)
- Deepseek's tool calling with OpenClaw's specific tools is untested
- Model switch risks breaking Discord/Telegram
- The user doesn't care which model runs — they care that Pearl feels unified
**Revisit:** Post-demo, test Deepseek with OpenClaw's full tool suite. If it handles exec/web_search/browser well, switch to save ~90% on API costs.

### ADR-2: Synchronous over Async for Opus escalation
**Decision:** `bot_think_deeply` makes a synchronous HTTP call and waits for the result.
**Rationale:**
- Async (current `bot_openclaw_task`) breaks the conversation flow
- User hears "I've sent that to OpenClaw" which is a visible handoff
- Synchronous + ToolNarrationProcessor = natural "thinking" pause
- 30-second timeout is acceptable for voice (with narration filler)
**Trade-off:** Blocks the voice pipeline for up to 30 seconds. Acceptable because ToolNarrationProcessor fills the gap with natural-sounding filler.

### ADR-3: File-based shared memory (not database)
**Decision:** Keep using workspace files for cross-session memory.
**Rationale:**
- Already working for Discord/Telegram
- Voice just needs to START WRITING (it already reads)
- No new infrastructure needed
- Files are human-readable (Friend can inspect/edit)
- Atomic append operations prevent race conditions
**Revisit:** If Pearl runs on multiple hosts, move to SQLite or Redis. For single-host (current), files are perfect.

### ADR-4: Don't unify tool sets across channels
**Decision:** Voice keeps PearlOS tools, Discord/Telegram keep OpenClaw tools.
**Rationale:**
- PearlOS tools control a visual desktop (meaningless in Discord)
- OpenClaw tools execute in sandbox (can't touch PearlOS UI)
- Trying to expose all tools everywhere would bloat context and confuse the LLM
- Each channel's tools are already optimized for their interface
**Exception:** `bot_think_deeply` is voice-only (Discord already has native Opus via sub-agents).

---

## 11. Monitoring & Success Criteria

### Demo Success Metrics
- [ ] Voice Pearl answers complex questions with Opus-level quality
- [ ] No visible "handoff" or "escalation" language in responses
- [ ] Cross-session memory works (voice topic appears in Discord context)
- [ ] PearlOS tools (notes, YouTube) maintain sub-2-second latency
- [ ] No voice crackling or dead air during Opus calls
- [ ] Pearl personality feels consistent across voice and Discord

### Post-Demo Monitoring
- Track `bot_think_deeply` call frequency (should be <20% of total turns)
- Track Opus call latency (target: <15 seconds P95)
- Monitor Deepseek API costs (target: <$5/day)
- Monitor activity-log.md size (trim at 50 entries)

---

## 12. Estimated Costs

| Component | Cost/Day | Notes |
|-----------|----------|-------|
| Deepseek V3 (voice, primary) | ~$1-3 | $0.27/M input, ~1-5M tokens/day |
| Deepseek V3 (OpenClaw, if switched) | ~$0.50-1 | Lower volume than voice |
| Claude Sonnet (OpenClaw Discord/Telegram) | ~$5-10 | Current cost, stays same for demo |
| Claude Opus (escalation) | ~$2-5 | Only triggered for complex queries |
| PocketTTS (Azelma) | $0 | Self-hosted |
| Deepgram STT | ~$1-2 | Voice transcription |
| **Total** | **~$10-20/day** | Down from ~$25-30 if Sonnet was primary |

---

## 13. Open Questions

1. **Deepseek API credits:** Friend needs to add credits at `platform.deepseek.com`. Is this done? (Activity log from 00:02 says "Insufficient Balance")
2. **HTTPS tunnel for voice testing:** Is cloudflared/ngrok set up for Daily.co WebRTC? (Needed for remote testing)
3. **aiohttp availability:** Is `aiohttp` installed in the Pipecat bot's Python environment? (Needed for `bot_think_deeply`)
4. **OpenClaw Opus model support:** Does OpenClaw Gateway allow specifying `anthropic/claude-opus-4-6` in `/v1/chat/completions` requests? (Should work since it passes through to Anthropic, but needs verification)
5. **Deepseek function calling quality:** Has anyone tested Deepseek V3 with the full 71-tool PearlOS suite? Any tools it struggles with?

---

*This document is the single source of truth for the Unified Pearl architecture. Update it as implementation proceeds.*
