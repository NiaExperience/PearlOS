# Subconscious-for-Text-Chat Design

Design hand-off for Blair (task `disp-8aab883d58`).
Deliverable: architecture decision + concrete implementation plan.
Status: **analysis complete, no code deployed** — see "Why no code yet".

## TL;DR

Voice's `NonBlockingToolRouter` works because Phase 1 plays through TTS in
real time while Phase 2 silently writes to canvas. **That symmetry does
not exist for text.** Text has one channel (the message stream), and
both phases want to use it. Applying the pattern naively makes the user
read the same answer twice or see Pearl contradict herself.

The right port is a **transport-aware split**:

- **Web `/api/chat`**: extend the SSE protocol with phase tags so the
  client renders Phase 1 inline, then appends Phase 2 results below it.
- **Discord text chat**: send Phase 1 as the message body, then **edit
  the same message** with Phase 2 appended (Discord allows edits up to
  15 min — perfect for tool latency).

Recommendation: **GO**, but ship in two phases of work, not one.
Phase A (intent-routed fast path) gets the chitchat win immediately.
Phase B (true two-phase + tool background) gets the weather/web-search
win Blair flagged.

## Voice baseline (so we know what we're porting)

`bot/processors/non_blocking_router.py:328` — `NonBlockingToolRouter`.

- **Phase 1**: `_stream_fast_voice` (line 1868) calls `BOT_FAST_MODEL`
  (groq llama-3.1-8b-instant by default) directly with a tiny system
  prompt (`VOICE_FAST_SYSTEM`, lines 54-83) and last 5 turns. Tokens
  push as `TextFrame` straight to TTS.
- **Phase 2**: `_run_openclaw_background` (line 2501) hits OpenClaw at
  `/v1/chat/completions` with full context + 72 tool schemas. Results
  go to canvas/state via `LLMMessagesAppendFrame`, **never to TTS**.
- **Why no double-speak**: Phase 2 is silent by construction. Plus
  passthrough-tool dedup (1480), enrichable dedup (1488), and the
  `_direct_tool_completed` signal injected into Phase 1's prompt so it
  knows not to narrate an action that already ran.

The thing that makes voice work is **Phase 2 has its own output
channel**. Text doesn't — and that is the hard problem.

## Current text paths

### Web `/api/chat` (`bot/bot_gateway.py:1400`)

```
client → POST /api/chat (auth, x-user-email)
       → _user_chat_session_key  (line 765)
       → _trim_chat_messages      (line 1420, last 25 pairs)
       → _stream_with_fallback    (line 1320)
              ↳ _stream_openclaw_sse  (1262)  POST OpenClaw, SSE back
              ↳ _stream_deepseek_direct_sse (987)  fallback no tools
       → StreamingResponse SSE → client
       → _chat_log_append (assistant) on stream end (1476)
```

The whole call blocks on OpenClaw. No fast path. Tool latency is fully
visible to the user.

### Discord text chat

**Not in this repo.** The PearlOS Discord bot is a separate process.
Inbound Discord messages reach the bot, the bot calls something (likely
`/api/chat` via the same gateway), and posts the reply back to Discord
via the bot's own REST client. Any Discord-side change requires
coordinating with that bot's repo.

Implication: the pipecat-daily-bot side can publish a multi-phase SSE
contract; the Discord bot has to learn to consume it (read Phase 1
chunks → post message; read Phase 2 chunks → edit that message).

### Context and tools

- `bot/pearl/context_loader.py:324` `build_web_chat_system_prompt()` —
  ~25K char system prompt assembled per turn (Pearl rules + identity +
  memory + activity log).
- Tools live server-side in OpenClaw. Web/Discord don't see the tool
  registry directly; they post messages and OpenClaw decides.

## Proposed architecture

### Phase A — intent-routed fast path (small, high-value)

Add a "does this look like it needs tools?" check at the top of
`/api/chat`. If **no**, skip OpenClaw and stream the fast model
(reuse `BOT_FAST_MODEL` infra from voice). If **yes**, fall through to
current behavior unchanged.

- New module: `bot/processors/text_subconscious.py`
  - `classify_intent(messages) -> "fast" | "tools"` — keyword + simple
    LLM call with cap of ~50 tokens. Mirror voice's heuristic.
  - `stream_fast_text(messages) -> AsyncIterator[bytes]` — direct call
    to `BOT_FAST_MODEL` with the lightweight system prompt.
- Wire in `_stream_with_fallback` (line 1320) before the OpenClaw
  branch:
  ```python
  intent = await classify_intent(messages)
  if intent == "fast":
      async for chunk in stream_fast_text(messages):
          yield chunk
      return
  # else: existing OpenClaw branch
  ```
- Persistence: identical to today (one message in, one message out).
  No protocol change. No client change.

**Win**: chitchat ("hi", "thanks", "what time is it" once memory has
the answer) bypasses 25K-token context build and the slow main agent.
Latency cut from ~2-5s to <1s for the easy half of traffic.

### Phase B — true two-phase for tool queries (the Blair-weather case)

Only run when intent classifier says `"tools"`.

- **Phase 1** (immediate): fast model produces a short, hedged
  acknowledgment ("Let me check the weather…"). Streamed via SSE
  immediately with a phase marker.
- **Phase 2** (background): existing OpenClaw call with full tool
  exec. Streamed via the SAME SSE response with a different phase
  marker.

#### SSE protocol extension

```
event: phase1
data: {"delta":"Let me check"}

event: phase1
data: {"delta":" the weather…"}

event: phase1_end
data: {}

event: phase2
data: {"delta":"It's 72°F"}

event: phase2
data: {"delta":" and sunny in NYC."}

event: phase2_end
data: {}
```

The web chat client renders `phase1` text greyed/italic, then on
`phase2_end` either replaces it with phase2 text (clean UX) or appends
phase2 below it (transparent UX — Blair to choose).

#### Discord client behavior

The Discord bot:
1. POST /api/chat, read SSE.
2. On `phase1_end`: post a Discord message with the phase 1 text.
3. On `phase2_end`: **edit** that same message — replace body with
   phase 2 text. (Discord edit window: 15 min, well over any tool
   latency.)
4. Persist only phase 2 text in `_chat_log_append`.

#### Persistence

`_chat_log_append` (line 1476) is called once on stream end with the
final assistant message. Define final = phase 2 text if phase 2 ran,
else phase 1 text. Phase 1 hedge text is **never** persisted alone
when phase 2 runs — it would corrupt history (next turn's context
would include "let me check the weather" with no resolution).

#### Concurrency

Phase 1 and Phase 2 fire **truly concurrently**, not sequentially:

```python
phase1_task = asyncio.create_task(stream_phase1(...))
phase2_task = asyncio.create_task(run_phase2(...))
# pump phase1_task chunks → SSE while phase2_task runs in background
# after phase1_task done, await phase2_task and stream its chunks
```

If phase 2 finishes BEFORE phase 1 completes (rare for tool queries,
but possible for cached tool results), drain phase 1 first to avoid
out-of-order rendering — the client cannot reorder once chunks ship.

## Adversarial findings

### 1. Race & contradiction
Phase 1 fast model could say "weather is sunny" (hallucinated) before
phase 2 returns the real answer. Voice dodges this because its phase
1 prompt is tightly constrained to acknowledgments + passthrough
tools. **Mitigation**: text phase 1 system prompt hard-forbids
substantive claims when intent = tools — it can only acknowledge
("Let me check…", "Looking that up…"). No hallucinated content.

### 2. Persistence ambiguity
If we persist both phases, conversation history becomes incoherent
("Let me check…" / "It's 72°F" as two separate turns). **Mitigation**:
persist only phase 2 when it runs. Phase 1 is ephemeral UX.

### 3. Latency math for tool-heavy turns
Voice runs phase 1 in parallel with phase 2 (TTS plays during tool
exec). Text users **can read faster than tools execute**, so they
see the hedge, then wait. We have to either: (a) accept that the
hedge is ~200ms of latency added but provides "Pearl is alive" UX
value, or (b) skip phase 1 entirely if expected tool latency is low.
**Recommendation**: (a). The acknowledgment is the win.

### 4. Discord is cross-system
PearlOS Discord bot is in a different repo. We cannot change Discord
client behavior from pipecat-daily-bot. **Mitigation**: ship the SSE
protocol extension here first; coordinate Discord-bot change as a
separate PR in that repo. Until the Discord bot consumes the new
protocol, it should keep using the simple `final-message-only` mode
(no edit, no phase 1). Backward compat: if `Accept: text/event-stream;
phases=1` header is missing, gateway returns the legacy single-phase
SSE.

### 5. Intent classifier reliability
Wrong classification feels worse on text (re-readable) than voice
(heard once). **Mitigation**: bias toward false-negative (route to
OpenClaw on doubt). Cost = some chitchat goes through the slow path,
which is the current state — no regression.

### 6. Token cost
Phase 1 + Phase 2 = two LLM calls per tool turn. Phase 1 is the cheap
8B model, so cost is small (<5% increase in spend on tool turns).
Acceptable.

### 7. Voice pipeline coupling
The voice router has its own copy of phase 1 logic. Sharing code
between text and voice routers means one of them changes and breaks
the other. **Mitigation**: extract `phase1_acknowledge(messages)` to
a shared utility module both routers import. Test both pipelines.

## Acceptance criteria

Phase A done when:

- [ ] `/api/chat` with a chitchat message returns first token in <800ms
      P50 (vs. current ~2-3s).
- [ ] `/api/chat` with a tool-requiring message routes to OpenClaw
      unchanged (no regression).
- [ ] Web chat client renders fast-path responses identically to
      OpenClaw responses (same SSE shape).
- [ ] Discord bot path unchanged (still single-phase).

Phase B done when:

- [ ] Tool query through `/api/chat` returns a phase 1 ack within
      <800ms.
- [ ] Phase 2 result arrives within current OpenClaw latency (no added
      tool latency).
- [ ] Web chat client renders the two phases coherently (Blair
      approves the visual).
- [ ] Discord bot, after its update, posts phase 1 then edits with
      phase 2.
- [ ] `_chat_log_append` records phase 2 only — JSONL has no orphan
      "let me check…" messages.
- [ ] Voice pipeline still passes its smoke tests.

## Why no code yet

1. **Staging blanket approval expired 2026-04-29 14:00 UTC**, today is
   2026-04-30. This change touches `pipecat-gateway` (port 4444), a
   core staging service, and requires a restart to take effect.
2. **Discord side is cross-repo.** Shipping just the gateway side
   leaves an unused contract; Blair may prefer to coordinate both at
   once.
3. **Phase B has UX choices** (replace vs. append) that need Blair's
   call before client code is meaningful.

Once Blair greenlights, the implementation slices into ≤15-min
sub-tasks naturally:

| # | Task | Target file | Engine |
|---|------|-------------|--------|
| 1 | Extract `phase1_acknowledge()` into shared util | new `bot/processors/phase1_shared.py` | Claude `Agent` |
| 2 | Add `classify_intent()` | new `bot/processors/text_subconscious.py` | Claude `Agent` |
| 3 | Wire fast path into `_stream_with_fallback` | `bot/bot_gateway.py:1320` | Claude `Agent` |
| 4 | Add SSE multi-phase protocol behind opt-in header | `bot/bot_gateway.py` (new helper) | Claude `Agent` |
| 5 | Update web chat client to render phases | `apps/interface/...` (separate repo path) | `the_agency` swarm |
| 6 | Update Discord bot to consume phases | external Discord repo | separate task |
| 7 | Smoke-test both voice and text pipelines | shell + Playwright | mechanical |
| 8 | Deploy + verify-build | `/opt/pearlos/scripts/verify-build.sh` | mechanical |

Each task is self-contained, ≤15 min, and dispatchable as its own
`pearl-task` row.
