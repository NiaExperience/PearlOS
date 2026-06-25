# PearlOS Staging Chat Quality Audit

**Date:** 2026-05-21  
**Server:** pearl-staging-private-omega (134.209.76.227)  
**Scope:** Discord + Web Chat response quality, error leakage, task followups

---

## 1. THINKING LEAKAGE IN CONVERSATIONAL CHAT

### Root Cause

The problem has **three contributing layers**, not one:

#### A. The system prompt IS explicit about not narrating, but not enforced at the tool layer

Both the OpenClaw main agent system prompt (`/home/deploy/.openclaw/agents/main/system-prompt.md`) and the web chat system prompt (`/workspace/nia-universal/apps/pipecat-daily-bot/bot/pearl/context_loader.py:_PEARL_CORE_RULES`) contain strong anti-narration rules:

```
NEVER start a sentence with "Let me", "I'll check", "I'll look", or any narration of work in progress.
Just do the thing and report the result.
```

However, **OpenClaw's agent loop (sessions_send tool) sends subagent status announcements as visible chat messages** when the model calls `sessions_send` to communicate with spawned subagents or to announce their completion. These come from the OpenClaw runtime (`/home/deploy/.openclaw/plugin-runtime-deps/openclaw-2026.4.29-2d9bf6a9f6fa/dist/openclaw-tools-DuqACH22.js`, lines 6960-6990) where subagent completion/failure announcements are routed through `sessions_send` and end up delivered to the Discord/web chat channel as visible messages.

#### B. The `sanitizeAssistantText` and `normalizeDiscordOutboundText` functions catch SOME patterns but miss the full spectrum

In the Discord relay (`/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs`):

- `sanitizeAssistantText()` (line ~313) strips tool tags, fenced JSON, and a few specific patterns like `"Let me check"` and `"I'm checking"` but does NOT strip all forms of process narration.
- `normalizeDiscordOutboundText()` (line ~330) adds `naturalizeOpenClawSubagentAnnounce()` and `stripOpenClawMachineData()` which help with machine-readable system messages but don't catch "Let me trace the code... now let me fire up..." style narration.

In the web chat (`/workspace/nia-universal/apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts`):
- `stripBannedOpening()` only strips sentences that BEGIN with banned patterns. It does not strip banned patterns mid-paragraph or multi-sentence messages where "Let me..." appears as the second sentence.
- The `BANNED_OPENING_PATTERNS` regex list is incomplete — it doesn't catch variants like "I'm going to", "I will now", "Let's see", "Now I need to", etc.

#### C. The web chat steams raw tool output through SSE without post-processing

In `/workspace/nia-universal/apps/pipecat-daily-bot/bot/bot_gateway.py` (lines 1880-2020), the `_stream_openclaw_sse` function streams raw OpenClaw output to the browser. If OpenClaw (running with the `pearl-llm/deepseek-v4-pro` model in agent mode) emits process narration, tool-call descriptions, or subagent announcements in its stream, those go directly to the user's chat with only em-dash stripping applied. The `sanitizeAssistantText` runs on the CLIENT side after accumulation, but mid-stream the user briefly sees the raw tokens.

### Code Locations

| Location | Role |
|---|---|
| `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs` (lines 313-380) | Discord relay `sanitizeAssistantText` and `normalizeDiscordOutboundText` |
| `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs` (lines 530-560) | `callPearl` system prompt including narration rules |
| `/workspace/nia-universal/apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts` | Web chat client-side sanitization |
| `/workspace/nia-universal/apps/pipecat-daily-bot/bot/pearl/context_loader.py` (lines 83-160) | Web chat system prompt (Core Rules, identity) |
| `/workspace/nia-universal/apps/pipecat-daily-bot/bot/bot_gateway.py` (lines 1880-2020) | `_stream_openclaw_sse` raw streaming |
| `/home/deploy/.openclaw/agents/main/system-prompt.md` | Main agent system prompt (loaded by OpenClaw) |
| `/home/deploy/.openclaw/plugin-runtime-deps/openclaw-2026.4.29-2d9bf6a9f6fa/dist/openclaw-tools-DuqACH22.js` (lines 6960-6990) | OpenClaw sessions_send announce delivery |

### Recommended Fixes

**Fix 1A: Hard post-processing in the Discord relay (surgical, high impact)**

Enhance `sanitizeAssistantText` in the relay to catch more banned patterns:

```javascript
// In production-repair-chat-relays.mjs, around line 313:
// Extend the sanitizeAssistantText regex patterns:
value = value.replace(/^\s*(?:exec|tool|function_call|recipient_name)\s+\/?[^\n]*(?:\n|$)/gim, "");
value = value.replace(/^\s*(?:Dispatching to CLI|Loading memory context|Checking the actual|Let me check|I'?m checking|Now let me|Let me now|I will now|I'?m going to|First I|Next I|Now I) [^\n]*(?:\n|$)/gim, "");
// ADD new patterns:
value = value.replace(/(?:^|\n)\s*(?:Let me |Let's |I(?:'| a)?ll |I(?:'| a)m (?:going to |gonna )|Now I need to |I should |First[ ,]|Next[ ,]|Then[ ,])[^\n]*(?:\n|$)/gim, "");
```

**Fix 1B: Strip banned patterns mid-text, not just sentence start**

In `sanitize-assistant-text.ts`, change `stripBannedOpening` to operate on all sentences, not just the first:

```typescript
function stripAllBannedPatterns(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const filtered = sentences.filter(sentence => {
    return !BANNED_OPENING_PATTERNS.some(pattern => pattern.test(sentence.trimStart()));
  });
  return filtered.join(' ');
}
```

**Fix 1C: System prompt reinforcement**

The system prompts already contain strong rules. The gap is that the model (DeepSeek V4 Pro) doesn't consistently follow them in agent mode when tool calls are involved. Add a pre-prompt instruction at the TOP of the system message (highest priority position):

```text
CRITICAL — READ FIRST: You are in a TEXT CHAT with a human. All tool calls
happen silently behind the scenes. Your visible output is ONLY the final
answer. NEVER type process narration like "Let me check" or "Now I'll look at..."
Not once. Not for any tool call. If you find yourself about to narrate a step,
delete it and write the result instead.
```

---

## 2. INTERNAL ERROR MESSAGES LEAKING TO USERS

### Root Cause

The error message `⚠️ 📨 Session Send: \`496705799687766016\` failed: No session found: 496705799687766016` originates from **OpenClaw's agent-runner runtime**.

Source: `/home/deploy/.openclaw/plugin-runtime-deps/openclaw-2026.4.29-2d9bf6a9f6fa/dist/agent-runner.runtime-Bf-1Z53T.js` (line 1707):

```javascript
text: isBilling ? BILLING_ERROR_USER_MESSAGE 
  : isRateLimit && !isOverloadedErrorMessage(message) ? buildRateLimitCooldownMessage(err) 
  : rateLimitOrOverloadedCopy ? rateLimitOrOverloadedCopy 
  : isContextOverflow ? "⚠️ Context overflow — ..." 
  : isRoleOrderingError ? "⚠️ Message ordering conflict ..." 
  : shouldSurfaceToControlUi ? `⚠️ Agent failed before reply: ${trimmedMessage}.\nLogs: openclaw logs --follow` 
  : externalRunFailureReply?.text ?? GENERIC_EXTERNAL_RUN_FAILURE_TEXT,
```

This is the "fallthrough" error path. When OpenClaw's agent runner encounters an error it doesn't have a specific handler for, it creates a visible error message with emoji (`⚠️ 📨`) and internal IDs. These get delivered directly to the Discord channel and web chat because **the relay does not filter these error patterns**.

Additionally, there are two more sources:

1. **OpenClaw's `action-send` module** (`action-send-FdYk1xAm.js`, line 24): returns `⚠️ send failed` and `⚠️ Subagent error: ${result.error}` as visible text
2. **OpenClaw's `bash-tools` module** (`bash-tools-C8SRwBd3.js`, line 2909): returns `No session found for ${params.sessionId}` as tool-call result text

### Code Locations

| Location | Error Type |
|---|---|
| `agent-runner.runtime-Bf-1Z53T.js` (line 1707) | Generic agent-runner failure → `⚠️ Agent failed before reply: ...` |
| `action-send-FdYk1xAm.js` (lines 24, 33-34) | Subagent send failures → `⚠️ send failed`, `⚠️ Subagent error: ...` |
| `bash-tools-C8SRwBd3.js` (line 2909) | Session resolution failure → `No session found for ...` |
| `openclaw-tools-DuqACH22.js` (lines 7098-7110) | sessions_send label lookup failure → `No session found with label: ...` |

### Recommended Fix

**Fix 2A: Add error-pattern filtering to the Discord relay output path**

In `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs`, extend `normalizeDiscordOutboundText` to catch OpenClaw error patterns:

```javascript
function filterInternalErrors(text) {
  // Catch "⚠️ ... failed: No session found" patterns
  if (/⚠️.*📨/.test(text) && /\b(session|send|failed|error|no session found)\b/i.test(text)) {
    return "I hit a minor internal routing issue. Try that again?";
  }
  // Catch "⚠️ Agent failed before reply" patterns
  if (/⚠️\s*Agent\s+failed\s+before\s+reply/i.test(text)) {
    return "I hit a snag processing that. Can you try again?";
  }
  // Catch "⚠️ Subagent error" patterns
  if (/⚠️\s*Subagent\s+error/i.test(text)) {
    return "A background task ran into trouble. Let me know if you want me to retry it.";
  }
  // Catch "No session found" patterns
  if (/No session found/i.test(text) && /\d{10,}/.test(text)) {
    return "A routing glitch hit one of my background processes. Try sending that again.";
  }
  return text;
}

function normalizeDiscordOutboundText(text) {
  let value = redactInternalIdentifiers(sanitizeAssistantText(text));
  value = naturalizeOpenClawSubagentAnnounce(value);
  value = stripOpenClawMachineData(value);
  value = filterInternalErrors(value);  // ADD THIS LINE
  // ... rest of normalization
}
```

**Fix 2B: Add error filtering to the web chat SSE stream**

In `/workspace/nia-universal/apps/pipecat-daily-bot/bot/bot_gateway.py`, add a pre-delivery filter in the SSE streaming path:

```python
# After extracting delta.content but before yielding
ERROR_PATTERNS = [
    (r"⚠️.*📨.*Session Send.*failed", "One of my routing steps had an issue. Try that again."),
    (r"⚠️\s*Agent\s+failed\s+before\s+reply", "I hit a snag. Can you try again?"),
    (r"No session found for \d+", "A routing glitch hit one of my background processes."),
]

def _filter_error_text(text: str) -> str:
    for pattern, replacement in ERROR_PATTERNS:
        if re.search(pattern, text):
            return replacement
    return text
```

---

## 3. WEB CHAT QUALITY

### Findings

#### A. Web Chat Backend → Bot Gateway Proxy

**Status: Working.** The `/api/chat` route (`/workspace/nia-universal/apps/interface/src/app/api/chat/route.ts`) correctly:
- Authenticates via NextAuth session
- Resolves tenant ID from the session
- Proxies to `http://localhost:4444/api/chat` (the Bot Gateway)
- Streams SSE response through

**One issue:** The error response for upstream failures returns `{"error": "Upstream error: ${upstream.status}"}` instead of a user-friendly message. If the Bot Gateway is down, the user sees "Upstream error: 502" which is unhelpful.

#### B. Studio Integration (Wonder Canvas games/presentations)

**Status: Partially functional.** The web chat tool handlers (`/workspace/nia-universal/apps/interface/src/features/ChatMode/lib/chat-tool-handlers.ts`) support:
- `bot_wonder_canvas_template` — inject template into Wonder Canvas
- `bot_wonder_canvas_scene` — inject custom HTML scene
- `bot_wonder_canvas_clear` — clear the canvas

These route through `invokeBotGatewayTool()` which posts to the Bot Gateway. The ChatMode component listens for `nia:wonder.scene` events and auto-collapses the chat to show the full canvas.

**Potential issues:**
1. The tool calling path (`bot_wonder_canvas_*`) requires the Bot Gateway to have these endpoints mounted. Need to verify they're registered.
2. Games/presentations delivered via webhooks depend on the task pipeline and the `pearl-task-dispatch` command being available inside OpenClaw's exec tool.

#### C. Notes Creation from Web Chat

**Status: Functional with one gap.**

The Notes API (`/workspace/nia-universal/apps/interface/src/features/Notes/routes/route.ts`) supports `POST /api/notes?agent=pearlos` to create notes. The implemention resolves assistant name to tenant ID, validates session, and creates the note.

**Gap:** The web chat user says "create a note with..." and Pearl needs the `bot_create_note` web tool to execute. This tool is defined in the chat-tool-handlers but requires the Bot Gateway to expose a corresponding endpoint. The web chat `parseDirectToolCall()` in `useChatSession.ts` parses `call bot_create_note titled "..." content "..."` and routes it locally, NOT through the gateway.

**The ChatMode.tsx archive button** saves chat transcripts to both localStorage AND `POST /api/notes?agent=pearlos`. This path works directly.

### Recommended Fixes

**Fix 3A: Improve upstream error messages in chat proxy**

```typescript
// In /workspace/nia-universal/apps/interface/src/app/api/chat/route.ts
if (!upstream.ok) {
  return new Response(JSON.stringify({ 
    error: "Pearl's chat backend is unavailable right now. Try again in a moment."
  }), {
    status: 502,
    headers: { 'Content-Type': 'application/json' },
  });
}
```

**Fix 3B: Verify Wonder Canvas tool endpoints on Bot Gateway**

Check that the Bot Gateway has `bot_wonder_canvas_template`, `bot_wonder_canvas_scene`, and `bot_wonder_canvas_clear` endpoints registered and functional.

```bash
# Verification command:
curl -s http://localhost:4444/api/chat -X POST \
  -H "Content-Type: application/json" \
  -H "x-user-email: blair@pearlos.org" \
  -d '{"messages":[{"role":"user","content":"show me a game"}]}' | head -50
```

---

## 4. REPETITIVE TASK STATUS UPDATES

### Root Cause

The "Still working..." / "Done..." spam originates from **two independent timer-based polling loops** in the relay script, and a **third loop** in the Bot Gateway. If the user dispatches a task, all three may fire progress messages for the same task.

#### Loop 1: `conversationWorkHeartbeatTimer` (Discord)

In the relay script (`/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs`):

```javascript
const CONVERSATION_WORK_CHECK_INTERVAL_MS = Number(process.env.PEARL_CONVERSATION_WORK_CHECK_MS ?? 15_000);
const CONVERSATION_WORK_REPEAT_MS = Number(process.env.PEARL_CONVERSATION_WORK_REPEAT_MS ?? 10 * 60_000);
```

- Checks every **15 seconds** (default) whether any `conversationWorkItems` need attention
- For running items, posts progress to Discord every `CONVERSATION_WORK_REPEAT_MS` (default **10 minutes**)
- The progress message format: `Tracking "title" — running.` → `"title" — still running.` → `"title" — still running.` ...

This creates a pattern of:
1. First notice: "Tracking — running" (at 90s)
2. Repeat 1: "still running" (at 10min)
3. Repeat 2: "still running" (at 20min)

#### Loop 2: `discordTaskFollowupTimers` (Discord, per-task)

```javascript
const DISCORD_TASK_FOLLOWUP_INTERVAL_MS = Number(process.env.PEARL_DISCORD_TASK_FOLLOWUP_MS ?? 600_000);
```

- Per-task timers check every **10 minutes** (default)
- Posts task status to Discord when status changes
- For terminal states, posts "Done: title" / "That failed: title"

**Problem:** If Loop 1 and Loop 2 both fire for the same task, the user gets TWO progress messages close together. Both say essentially "still running."

#### Loop 3: `webChatTaskFollowupTimer` (Web chat inbox)

```javascript
const WEBCHAT_TASK_FOLLOWUP_INTERVAL_MS = Number(process.env.PEARL_WEBCHAT_TASK_FOLLOWUP_MS ?? 120_000);
const WEBCHAT_TASK_REPEAT_MS = Number(process.env.PEARL_WEBCHAT_TASK_REPEAT_MS ?? 30 * 60_000);
```

- Checks every **2 minutes** (default) 
- Pushes to web chat inbox on status change
- **Posts repeat updates every 30 minutes** for stale tasks

#### Loop 4: `conversationWorkItems` overlap with `PearlAgentObligations`

The relay maintains TWO parallel tracking systems:
- `conversationWorkItems` (for general background work)
- `pearlAgentObligations` (for agent-launched background continuations)

Both can track the same underlying task and both have independent notification logic. An obligation with `kind: "agency_task_watch"` and a conversation work item with `kind: "agency_task"` can BOTH fire for the same dispatched task.

### Code Locations

| Location | Loop | Interval |
|---|---|---|
| `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs` lines 92-98 | conversationWorkHeartbeat | Check: 15s, Post: 10min |
| Same file lines 89-91 | discordTaskFollowupTimers | Per-task: 10min |
| Same file lines 93-97 | webChatTaskFollowupTimer | Check: 2min, Post: 30min |
| Same file lines 1364-1430 | `conversationWorkProgressMessage` | Progress message generation |
| Same file lines 1460-1520 | `pollConversationWorkItems` | Dedup/notification logic |
| Same file lines 1530-1670 | `pollDiscordTaskFollowup` | Per-task notification logic |

### Recommended Fixes

**Fix 4A: Deduplicate conversation work items and task followups**

When creating a conversation work item AND a task followup for the same task, mark them with a shared dedupe key so only ONE notification fires per status change:

```javascript
// When creating both, use the taskId as a dedupe key
function isDuplicateNotice(taskId, surface) {
  // Check if another notice type for this taskId was sent within the last 60 seconds
  const key = `notice:${surface}:${taskId}`;
  const lastNotice = noticeTimestamps.get(key);
  if (lastNotice && Date.now() - lastNotice < 60_000) return true;
  noticeTimestamps.set(key, Date.now());
  return false;
}
```

**Fix 4B: Increase default intervals (environment variables)**

Set in the PM2 environment or `.env`:

```bash
# More reasonable defaults for a conversation companion:
PEARL_CONVERSATION_WORK_CHECK_MS=300000      # 5 min between checks (was 15s)
PEARL_CONVERSATION_WORK_REPEAT_MS=1800000    # 30 min between repeats (was 10min)
PEARL_CONVERSATION_WORK_CHAT_FIRST_MS=300000 # 5 min before first notice (was 90s)
PEARL_DISCORD_TASK_FOLLOWUP_MS=900000        # 15 min between task checks (was 10min)
PEARL_WEBCHAT_TASK_FOLLOWUP_MS=300000        # 5 min between web chat checks (was 2min)
```

**Fix 4C: Cap progress messages at 2 for non-terminal statuses**

In `conversationWorkProgressMessage` (line ~1360):

```javascript
function conversationWorkProgressMessage(item, task = null) {
  const title = normalizeDiscordOutboundText(trimMessage(item?.title || ...));
  const status = taskStatusWord(task?.status || item?.status || "running");
  
  if (isTerminalTaskStatus(task?.status)) {
    return summarizeTaskResultForDiscord(task, title);
  }
  
  const noticeNum = (item?.noticeCount || 0) + 1;
  
  // Cap at 2 progress messages; after that, silence until terminal
  if (noticeNum > 2) return null;
  
  if (noticeNum === 1) {
    return `Tracking "${title}" — ${status}.`;
  }
  if (noticeNum === 2) {
    return `"${title}" — still ${status}. I'll ping you when it finishes.`;
  }
}
```

**Fix 4D: Remove conversation-work-item progress for tasks that already have task-followup tracking**

In `createAgencyTask` (around line 2129), the relay creates both a conversation work item AND a task followup. Remove the conversation work item creation when the task already has dedicated followup tracking:

```javascript
// In createAgencyTask():
await trackDiscordTaskFollowup({ token, msg, task, taskText });

// REMOVE this duplicate:
// createConversationWorkItem({
//   surface: "discord",
//   kind: replyStyle === "lookup" ? "lookup_task" : "agency_task",
//   msg,
//   title: taskTitle,
//   taskId,
//   taskText,
//   firstCheckMs: CONVERSATION_WORK_CHAT_FIRST_MS
// });
```

---

## PRIORITY ORDER (What to Fix First)

### 🔴 Critical (Visible to users, needs immediate fix)

1. **Fix 2A — Error pattern filtering in Discord relay**  
   The `⚠️ 📨 Session Send failed` error is the most glaring UX issue. Users see internal infrastructure errors. Add `filterInternalErrors()` to `normalizeDiscordOutboundText`.

2. **Fix 4C — Cap progress messages at 2**  
   The "Still working..." spam is the most commonly reported annoyance. Simple change with high impact.

### 🟡 High (Quality degradation, should fix this week)

3. **Fix 1A — Enhanced process narration filtering**  
   Extend the regex patterns in the relay's `sanitizeAssistantText` to catch more "let me" variants.

4. **Fix 1B — Client-side mid-text narration stripping**  
   Update `sanitize-assistant-text.ts` to strip banned patterns from ALL sentences, not just the first one.

5. **Fix 4D — Remove duplicate task tracking**  
   Eliminate the conversation-work-item creation when dedicated task-followup already exists.

### 🟢 Medium (UX polish)

6. **Fix 3A — User-friendly error messages in chat proxy**
7. **Fix 4B — Increase default check intervals via env vars**
8. **Fix 1C — System prompt reinforcement at the top**

### ⚪ Low (Monitor, fix when convenient)

9. **Fix 3B — Verify Wonder Canvas tool endpoints**
10. **Fix 2B — Add error filtering to web chat SSE stream**

---

## APPLIED FIXES (Surgical, applied during this audit)

### Fix: Error pattern filtering in Discord relay

**File:** `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs`  
**Change:** Added `filterOpenClawToolErrors()` function and integrated into `normalizeDiscordOutboundText()`

### Fix: Capped conversation work progress to 2 messages

**File:** `/home/deploy/pearlos/scripts/production-repair-chat-relays.mjs`  
**Change:** Modified `conversationWorkProgressMessage()` to return null after 2 progress messages

### Fix: Enhanced narrative-filtering regex

**File:** `/workspace/nia-universal/apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts`  
**Change:** Extended `BANNED_OPENING_PATTERNS` and `stripBannedOpening` to strip banned patterns from all sentences, not just the first

### Fix: Deploy changes to staging

After applying edits to source files, copy to deploy tree and restart:

```bash
cp /workspace/nia-universal/apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts \
   /home/deploy/pearlos/apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts

# Build and restart interface (this will be needed for .ts/.tsx changes)
cd /workspace/nia-universal && npm run build --prefix apps/interface
su - deploy -c "pm2 restart interface --update-env && pm2 save"
```
