# Pearl Discord Relay Overhaul: Architecture Review and Recommendation

**Date:** 2026-05-03
**Requested by:** Blair Erickson
**Scope:** Audit `production-repair-chat-relays.mjs`, propose overhaul that restores Pearl as a high-quality emotionally intelligent companion while keeping fast conversational responses.

---

## 1. Current Architecture Summary

The relay (`scripts/production-repair-chat-relays.mjs`, ~1230 lines) is a Node.js process that:

- **Receives** Discord messages via WebSocket gateway and Telegram via long-poll
- **Builds context** by reading 9 static files (PEARL.md, AGENTS.md, IDENTITY.md, SOUL.md, MEMORY.md, HANDOFF.md, USER_FACTS.md, CLAUDE.md, TOOLS.md) into system messages every call
- **Calls a model** (OpenClaw gateway, falling back to DeepSeek v4-flash) as a single-turn stateless request
- **Handles special cases** via regex: agency dispatch, live lookups, session resets, durable fact extraction, channel delegation, operational context probes
- **Sanitizes output** with regex to strip tool call artifacts

Current staging config: OpenClaw is skipped (`PEARL_RELAY_SKIP_OPENCLAW=true`), so every message goes to DeepSeek v4-flash as a single-turn completion with no conversation history.

---

## 2. Problems Identified

### 2.1 Stateless / No Conversation History

Every message is a fresh single-turn call. The `sessionKey` header is passed to OpenClaw but OpenClaw is skipped on staging, and the DeepSeek fallback path has no session management at all. Pearl literally cannot remember what was said 30 seconds ago. This is the single biggest quality gap.

**Impact:** Pearl cannot follow up on anything. Every response is context-free. "What did I just say?" produces confusion. Multi-turn conversations are impossible.

### 2.2 Brittle Regex Intent Classification

Intent detection is a wall of hand-tuned regex:

- `wantsOperationalContext()` (lines 197-221): 15+ regex patterns to detect "is this an ops question"
- `isAgencyDispatchRequest()` (lines 738-743): rigid phrase matching for "send to agency"
- `isLiveLookupRequest()` (lines 746-750): pattern matching for "search/lookup/latest news"
- `extractDurableUserFact()` (lines 669-703): regex to catch "my daughter's name is..."
- `sanitizeAssistantText()` (lines 136-144): regex to strip tool artifacts from model output

These break constantly on natural language variations. "Can you look into the latest build?" might trigger live lookup when Blair just wants Pearl to check the loaded context. "Have the agency check this" works but "get someone to look at this" does not.

**Impact:** False positives cause unwanted agency dispatches and unnecessary service probes. False negatives miss valid requests. Every new phrasing requires a new regex.

### 2.3 Context Dump on Every Call

Every message, even "hey", triggers reading of 9 files totaling ~70-90KB of raw markdown and potentially 6+ service health probes. All of this is stuffed into system messages.

**Impact:** Slow response for casual messages. Wasted tokens. The model sees operational rules and AGENTS.md deployment instructions when responding to "good morning." This actively degrades Pearl's warmth because the model's attention is split across infrastructure noise.

### 2.4 No Real Memory Retrieval

Memory is "load everything every time." MEMORY.md, HANDOFF.md, USER_FACTS.md are read in full on every call. No relevance filtering, no recency weighting, no semantic retrieval.

**Impact:** Works OK while files are small. Will degrade as memory grows. No way to prioritize recent context over old entries. Facts from months ago weigh the same as yesterday's conversation.

### 2.5 Stale News / Live Lookup Dead End

`isLiveLookupRequest()` dispatches to Agency and returns a canned "I'm checking the live picture now" message. But there's no mechanism to bring the result back into the chat. The user has to ask about the task later. This feels like filing a ticket, not having a conversation.

**Impact:** Pearl appears unable to actually help with anything that needs current information. The "I'm checking" response is a dead end.

### 2.6 Task Mechanics Leak Into Chat

Agency dispatch returns `Sent it to the Agency. Task \`disp-xxxx\` is queued for Claude CLI.` This exposes internal plumbing. Task IDs, executor names, and queue mechanics are not what a companion should be saying.

**Impact:** Breaks immersion. Pearl sounds like a ticketing system, not a person.

### 2.7 DeepSeek v4-flash as Primary Chat Model

DeepSeek is fast and cheap but not great at maintaining a consistent personality, emotional nuance, or following complex character instructions. Pearl's warmth and identity suffer when the model doesn't deeply understand the character.

**Impact:** Pearl feels generic. The personality instructions in the system prompt are partially followed at best.

### 2.8 Durable Fact Extraction is Fragile

`extractDurableUserFact()` catches "my daughter's name is X" and "remember that Y" but misses most natural forms of sharing personal information. "Blair's daughter Cora starts school next week" would not be captured.

**Impact:** Pearl's durable memory only grows through very specific phrasings. Most organic fact-sharing is lost.

---

## 3. Recommended Architecture

### 3.1 Core Principle: Two-Layer Fast/Slow Path

```
Message arrives
    |
    v
[Fast Path: DeepSeek v4-flash, <2s]
    - Conversation history (last 20 turns)
    - Minimal system prompt (identity + soul + recent user facts)
    - Handles: greetings, casual chat, follow-ups, emotional support, opinions
    |
    v
[Slow Path: Claude via Agency, 5-30s]
    - Triggered by model classification, not regex
    - Handles: live lookups, code work, file inspection, complex questions
    - Result posted back to channel asynchronously
```

The fast path handles 80% of messages. The slow path handles the 20% that need tools, search, or deep context. The key insight: **let the model decide which path to take**, not regex.

### 3.2 Conversation History (Critical)

Add a per-channel message buffer. This is the single highest-impact change.

**Implementation:**

```javascript
// In-memory conversation store, keyed by channel
const conversationHistory = new Map();
const MAX_HISTORY_TURNS = 20;
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 min

function getHistory(channelKey) {
    const entry = conversationHistory.get(channelKey);
    if (!entry || Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
        return [];
    }
    return entry.messages;
}

function addToHistory(channelKey, role, content) {
    let entry = conversationHistory.get(channelKey);
    if (!entry || Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
        entry = { messages: [], lastActivity: Date.now() };
    }
    entry.messages.push({ role, content });
    entry.lastActivity = Date.now();
    // Keep last N turns (N user + N assistant = 2N messages)
    while (entry.messages.length > MAX_HISTORY_TURNS * 2) {
        entry.messages.shift();
    }
    conversationHistory.set(channelKey, entry);
}
```

Then in `callPearl()`, insert history between system messages and the current user message:

```javascript
const messages = [
    { role: "system", content: systemPrompt },
    ...getHistory(channelKey),
    { role: "user", content: currentMessage }
];
```

And after getting a reply:

```javascript
addToHistory(channelKey, "user", currentMessage);
addToHistory(channelKey, "assistant", reply);
```

**Cost:** Minimal. DeepSeek v4-flash handles 20 turns easily within its context window. Memory is ephemeral (process restart clears it), which is fine -- durable memory is handled separately.

**Persistence option:** For durability across relay restarts, write conversation buffers to JSON files in the state directory. Not critical for v1.

### 3.3 Tiered Context Loading

Replace the "load everything every time" approach with three tiers:

**Tier 1 -- Always loaded (every message, ~3KB):**
- Pearl identity core (compact version of SOUL.md)
- User facts from USER_FACTS.md (currently tiny)
- Model behavior rules (no EM dashes, no LLM voice, etc.)
- Current date and surface info

**Tier 2 -- Loaded on relevance (ops/task/build questions, ~8KB):**
- Operational context (service probes, build manifest, tunnel URLs)
- Task snapshot
- AGENTS.md operational rules

**Tier 3 -- Loaded on explicit request or slow path (~20KB+):**
- Full MEMORY.md / HANDOFF.md
- PEARL.md agent guide
- TOOLS.md

**Implementation:** Replace `buildPrivateMemoryContext()` with a function that builds tier-appropriate context:

```javascript
function buildContextForMessage(text, context) {
    const tier1 = buildIdentityContext(context);  // always
    const tier2 = needsOpsContext(text) ? buildOpsContext(text, context) : null;
    // tier3 only loaded by slow-path Agency tasks
    return [tier1, tier2].filter(Boolean);
}
```

The `needsOpsContext()` function stays regex-based for now (it's OK for tier selection, which is coarse-grained), but the actual intent classification moves to the model.

### 3.4 Model-Based Intent Classification

Replace `isAgencyDispatchRequest()`, `isLiveLookupRequest()`, and `extractDurableUserFact()` with a structured output instruction in the system prompt:

```
When replying, if the user's message requires any of the following, include
a JSON block at the END of your reply (after the conversational text) wrapped
in <pearl-action>...</pearl-action> tags:

{
  "dispatch_agency": "task description for Agency, or null",
  "remember_fact": "fact to save about the user, or null",
  "needs_live_lookup": true/false
}

Only include this block when action is needed. For normal conversation, just reply naturally.
```

The relay then parses this structured block from the model output, strips it before sending to Discord, and acts on it:

```javascript
function extractActions(rawReply) {
    const actionMatch = rawReply.match(/<pearl-action>([\s\S]*?)<\/pearl-action>/);
    const cleanReply = rawReply.replace(/<pearl-action>[\s\S]*?<\/pearl-action>/, '').trim();
    let actions = null;
    if (actionMatch) {
        try { actions = JSON.parse(actionMatch[1]); } catch {}
    }
    return { reply: cleanReply, actions };
}
```

**Why this is better:** The model understands natural language. "Get someone to look at the deploy" becomes a dispatch. "My kid starts kindergarten in September" becomes a remembered fact. No regex needed. The model already has the context to make these decisions.

**Risk:** The model might hallucinate actions. Mitigation: only act on `dispatch_agency` if the text is >20 chars. Only save facts if they contain a personal detail (light validation). If the model fails to produce the block, nothing breaks -- the message is just a normal reply.

### 3.5 Async Lookup UX

For requests that need live data, the relay should:

1. **Immediately reply** with a natural acknowledgment (generated by the model, not canned)
2. **Dispatch to Agency** (the task system that already exists)
3. **Post the result back** to the same channel when the task completes

The missing piece is step 3. Currently, Agency tasks complete and the result sits in the task API. The relay should poll or subscribe to task completion:

```javascript
async function watchTaskResult(taskId, channelId, token, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        await sleep(5000);
        const task = await fetchJson(`${TASKS_API_URL}/${taskId}`, { method: 'GET' });
        if (task?.status === 'completed' && task?.result) {
            // Summarize the result through Pearl's voice
            const summary = await callPearl({
                surface: 'discord',
                sessionKey: `task-result:${taskId}`,
                text: `Summarize this task result for Blair in 2-3 sentences, naturally: ${task.result.slice(0, 2000)}`,
                author: 'system'
            });
            await sendDiscordMessage(token, channelId, summary);
            return;
        }
        if (task?.status === 'failed') {
            await sendDiscordMessage(token, channelId,
                `I looked into that but hit a wall. The short version: ${task.result?.slice(0, 300) || 'unknown error'}`);
            return;
        }
    }
}
```

Launch this as a fire-and-forget promise after dispatching the task. This closes the loop: Blair asks a question, Pearl says "let me check," and a minute later Pearl comes back with the answer in the same channel.

### 3.6 Clean Up Pearl's Chat Voice

The current system prompt in `callPearl()` is a paragraph of operational instructions mixed with personality guidance. Split it:

**Identity prompt (Tier 1, always loaded):**

```
You are Pearl. You are Blair's companion and co-builder.

Voice: warm, direct, present. You have opinions and personality. You are
not a status bot or a ticket system. When Blair says hi, be a friend.
When Blair needs help, be capable. When something is hard, be honest.

Style rules Blair has set:
- No EM dashes
- No LLM voice (no "I'd be happy to", no "certainly", no "let me")
- Concise when the moment calls for it, thorough when it matters
- Never lead with backend state or task machinery unless asked

You have conversation history loaded. Use it. Reference what Blair said
earlier. Follow up on threads. Be a person in a conversation, not a
stateless endpoint.

You have durable memory (loaded below). Use it naturally. If asked what
you know about Blair, answer warmly from memory. If something isn't in
memory, say so plainly.

When you need to do real work (code, search, file ops), you can dispatch
it through your Agency -- but frame it like you're taking care of it,
not like you're filing a ticket. Never expose task IDs or internal
mechanics unless Blair asks for them.

Current date: {date}
Surface: {surface}
```

**Operational prompt (Tier 2, only when relevant):**

```
Live PearlOS context (use only when Blair asks about ops/build/tasks):
{operational context}
```

### 3.7 Memory Retrieval Improvements

Short-term:
- Conversation history (section 3.2) solves the immediate "what did I just say" problem
- USER_FACTS.md is small enough to load every time for now

Medium-term (when memory grows):
- Split MEMORY.md into dated files (already partially done with `memory/2026-05-02.md`)
- Load only the most recent 2-3 memory files in Tier 1
- Load older memory only when the model's action block requests it or when Blair asks about history

Long-term:
- Embed memory entries and do vector similarity retrieval
- This requires a small embedding service (could be a local model or API call)
- Not worth building until memory exceeds ~50KB

### 3.8 Fact Extraction via Model

Replace `extractDurableUserFact()` regex with the model-based approach from 3.4. The model tags facts in `<pearl-action>` blocks. The relay writes them to USER_FACTS.md.

Add a lightweight dedup check: before writing, scan existing facts for semantic overlap (substring match is fine for now).

### 3.9 Model Selection

For the fast path, DeepSeek v4-flash is acceptable for speed/cost but Pearl's personality suffers. Options:

1. **Keep DeepSeek v4-flash** but invest more in the system prompt and conversation history. Cheapest, fastest. Personality is "good enough" with better prompting.

2. **Use Claude Haiku via Anthropic API** for the fast path. Better personality adherence, still fast (~1-2s), moderate cost. This is the recommended option if budget allows.

3. **Use OpenClaw with a tuned routing** for the fast path. Requires fixing the OpenClaw auth issue on staging (currently skipped). Best long-term option since it centralizes model routing.

**Recommendation:** Start with option 1 (improved DeepSeek prompting + conversation history) and evaluate. If personality is still flat, move to option 2. The architecture change is the same regardless of model choice.

---

## 4. Concrete File Changes

### 4.1 `scripts/production-repair-chat-relays.mjs` (Major Refactor)

**Add:**
- Conversation history store (Map-based, ~40 lines)
- `buildContextForMessage()` with tiered loading (~60 lines)
- `extractActions()` to parse model action blocks (~20 lines)
- `watchTaskResult()` for async result delivery (~30 lines)
- Compact identity system prompt (~30 lines)

**Modify:**
- `callPearl()`: add conversation history to messages array, use tiered context
- `buildPrivateMemoryContext()`: split into tier functions
- Discord message handler: store history, parse actions, handle async results
- System prompt: replace operational paragraph with identity-focused prompt

**Remove or deprecate:**
- `isAgencyDispatchRequest()` regex (replaced by model classification)
- `isLiveLookupRequest()` regex (replaced by model classification)
- `extractDurableUserFact()` regex (replaced by model classification)
- Bulk of `sanitizeAssistantText()` regex (model output is cleaner with structured actions)

**Estimated delta:** ~+200 lines, ~-150 lines of regex. Net ~+50 lines but dramatically simpler logic.

### 4.2 `SOUL.md` (Minor Update)

Add explicit voice guidelines that the relay system prompt references:
- No EM dashes (from USER_FACTS.md, should be canonical in SOUL.md)
- No LLM voice patterns
- Conversation history awareness
- How to frame Agency dispatch naturally

### 4.3 `USER_FACTS.md` (No Change)

Keep as-is. Model-based fact extraction writes here. File grows organically.

### 4.4 New: `scripts/pearl-chat-context.mjs` (Optional)

If the relay file gets too large, extract context-building into a separate module:
- `buildIdentityContext()`
- `buildOpsContext()`
- `buildMemoryContext()`
- `extractActions()`

This is optional -- the relay is already a single file and could stay that way.

---

## 5. Migration Path

### Phase 1: Conversation History (Highest Impact, Lowest Risk)

Add the in-memory conversation buffer to the relay. This is a pure addition with no breaking changes. Every other improvement builds on this.

**Effort:** ~2 hours. **Risk:** Minimal. History is ephemeral; worst case is slightly larger API calls to DeepSeek.

### Phase 2: Tiered Context Loading

Restructure `buildPrivateMemoryContext()` into tiers. Stop loading PEARL.md, AGENTS.md, HANDOFF.md on every casual message.

**Effort:** ~3 hours. **Risk:** Low. May miss some edge cases where ops context was needed but tier check didn't trigger. Mitigated by keeping the `wantsOperationalContext()` check for tier 2.

### Phase 3: System Prompt Overhaul

Replace the current system prompt paragraph with the identity-focused prompt from 3.6. This is where Pearl's voice quality improves most.

**Effort:** ~2 hours. **Risk:** Low. The prompt is better-structured but functionally equivalent.

### Phase 4: Model-Based Intent Classification

Add `<pearl-action>` structured output to the system prompt. Add `extractActions()` parsing. Deprecate regex classifiers.

**Effort:** ~4 hours. **Risk:** Medium. The model might not always produce the structured block. Keep regex as fallback for the first week, then remove.

### Phase 5: Async Result Delivery

Add `watchTaskResult()` to close the Agency dispatch loop. Pearl dispatches a task and brings the result back to the channel.

**Effort:** ~3 hours. **Risk:** Low. Fire-and-forget; if polling fails, behavior is the same as today.

### Phase 6: Model Evaluation

After phases 1-5 are stable, evaluate whether DeepSeek v4-flash with the improved architecture is "good enough" or whether upgrading to Claude Haiku is worth the cost.

**Effort:** ~1 day of evaluation. **Risk:** Cost increase if moving to Claude Haiku.

---

## 6. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Conversation history grows too large for DeepSeek context | Low | Medium | Cap at 20 turns, 30-min TTL, trim oldest first |
| Model-based intent classification hallucinates dispatch | Medium | Low | Validate task text length, keep regex fallback initially |
| Tiered loading misses needed context | Medium | Low | Keep wantsOperationalContext() for tier 2 selection |
| Async task result polling creates runaway promises | Low | Low | Hard timeout, max one watcher per task |
| DeepSeek v4-flash ignores personality instructions | High | Medium | Improve prompt, evaluate Claude Haiku as backup |
| Memory files grow beyond tier 1 budget | Low (long-term) | Medium | Split into dated files, load recent only |

---

## 7. What NOT to Do

- **Do not add a database** for conversation history. In-memory Map with file-backed persistence is sufficient for the scale of this system (a few channels, a few dozen messages per hour).
- **Do not build a custom embedding/vector store** for memory retrieval yet. The memory corpus is small enough for full-text loading. Revisit when it exceeds ~50KB.
- **Do not switch to a long-running WebSocket-based model API**. The stateless HTTP call pattern is simpler and sufficient with conversation history prepended.
- **Do not try to make the relay handle complex multi-step tasks**. That's what the Agency/pearl-worker path is for. The relay should be fast chat with a dispatch escape hatch.
- **Do not route DeepSeek through OpenRouter**. Keep it direct per existing rules.

---

## 8. Summary

The relay is fundamentally sound as infrastructure -- it handles Discord WebSocket lifecycle, message routing, trust boundaries, and service probes well. The problems are all in the **intelligence layer**: no conversation memory, regex intent detection, context dumping, and a system prompt that prioritizes ops instructions over personality.

The overhaul keeps the infrastructure intact and replaces the intelligence layer:

1. **Conversation history** makes Pearl a person in a conversation instead of a stateless endpoint
2. **Tiered context** keeps fast messages fast and deep messages deep
3. **Model-based classification** replaces brittle regex with natural language understanding
4. **Better system prompt** puts Pearl's identity first and ops details second
5. **Async result delivery** closes the Agency dispatch loop so Pearl can actually bring back answers

The phased approach means each change can be deployed and tested independently. Phase 1 (conversation history) alone would be a major quality improvement.
