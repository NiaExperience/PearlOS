# Unified Pearl Architecture — Testing & Validation Plan

> **Architecture:** Deepseek R1 (primary/voice) → Opus escalation (complex tasks) → Shared memory (cross-session)
> **Target:** Wednesday demo readiness
> **Last updated:** 2026-02-16

---

## Table of Contents

1. [Test Scenarios](#test-scenarios)
2. [Pre-Test Checklist](#pre-test-checklist)
3. [Test Script (Step-by-Step)](#test-script)
4. [Success Criteria Matrix](#success-criteria-matrix)
5. [Rollback Triggers](#rollback-triggers)
6. [Wednesday Demo Walkthrough](#wednesday-demo-walkthrough)

---

## Pre-Test Checklist

Before running any tests, verify the stack is up:

- [ ] OpenClaw gateway running (`openclaw gateway status`)
- [ ] Deepseek R1 model accessible (local or API endpoint responding)
- [ ] Opus model accessible via OpenClaw (`anthropic/claude-opus-4-6`)
- [ ] PearlOS voice pipeline active (STT → Deepseek → TTS)
- [ ] Discord bot online and connected to test server
- [ ] Shared memory store accessible (workspace files / memory directory)
- [ ] Network connectivity stable (for API calls)
- [ ] Test Discord channel identified (use `#general` or a dedicated `#testing` channel)

---

## Test Scenarios

### Scenario 1: Cross-Session Memory

**What we're proving:** A fact stored via Voice Pearl persists and is retrievable from Discord Pearl.

**Architecture path:**

```
Voice STT → Deepseek → writes to memory file → (time passes)
Discord message → Sonnet/Deepseek → reads memory file → responds
```

**Depends on:** Shared workspace (`memory/` directory), both sessions reading memory on startup.

---

### Scenario 2: Opus Escalation (Voice → Tool Use)

**What we're proving:** Voice Pearl recognizes it can't handle tool-heavy tasks, escalates to Opus seamlessly, and reports back naturally.

**Architecture path:**

```
Voice STT → Deepseek (detects tool need) → bridges to Opus subagent
→ Opus executes (send Discord message) → result returns to Deepseek
→ Deepseek responds via TTS: "I sent that message"
```

**Critical UX requirement:** User must NEVER hear "delegating" or "escalating." It should feel like one agent doing everything.

---

### Scenario 3: Tool Speed — Simple (Local Deepseek)

**What we're proving:** Simple local tasks stay fast on Deepseek without unnecessary escalation.

**Architecture path:**

```
Voice STT → Deepseek → local action (open app/file) → TTS response
```

**No Opus involved.** This tests that the routing logic correctly keeps simple tasks local.

---

### Scenario 4: Tool Speed — Complex (Opus Escalation)

**What we're proving:** Complex multi-step tasks escalate to Opus and still complete within acceptable latency.

**Architecture path:**

```
Voice STT → Deepseek (detects complexity) → Opus subagent
→ web_search + file write → result summary back to Deepseek → TTS
```

---

### Scenario 5: Fallback / Graceful Degradation

**What we're proving:** When the backend is unreachable, the voice Pearl doesn't crash or hallucinate — it tells the user clearly.

**Architecture path:**

```
Voice STT → Deepseek → attempts Opus bridge → connection refused
→ Deepseek catches error → TTS: "I can't access my backend right now"
```

---

### Scenario 6: Session Continuity

**What we're proving:** Mid-conversation context carries across channels via shared memory.

**Architecture path:**

```
Voice session → conversation stored in memory file
→ User opens Discord → Discord session reads memory → has full context
```

---

## Test Script

### Round 1: Baseline Health (2 min)

| Step | Action                             | Expected                            |
| ---- | ---------------------------------- | ----------------------------------- |
| 1.1  | Run `openclaw gateway status`      | Gateway shows "running"             |
| 1.2  | Send "hello" in Discord `#general` | Bot responds within 3s              |
| 1.3  | Say "hello" to Voice Pearl         | Voice responds within 3s            |
| 1.4  | Check `memory/` directory exists   | Directory present with recent files |

**If any fail:** Stop. Fix infrastructure before proceeding.

---

### Round 2: Cross-Session Memory (5 min)

| Step | Action                                                                                      | Expected                                                        | Pass/Fail |
| ---- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------- |
| 2.1  | Voice: "Remember that my favorite soundtrack is the Interstellar soundtrack by Hans Zimmer" | Voice confirms: "Got it" or similar                             |           |
| 2.2  | Verify memory file updated                                                                  | Check `memory/YYYY-MM-DD.md` or `MEMORY.md` contains the fact   |           |
| 2.3  | Wait 2-5 minutes (or restart Discord session)                                               | —                                                               |           |
| 2.4  | Discord: "What's my favorite soundtrack?"                                                   | Bot responds with "Interstellar" / "Hans Zimmer"                |           |
| 2.5  | Discord: "Who composed it?"                                                                 | Bot responds correctly (tests memory context, not just keyword) |           |

**Failure modes to watch for:**

- Voice says "got it" but doesn't actually write to file → memory loss
- Discord reads the file but can't find the fact → storage format issue
- Discord gives wrong answer → reading wrong memory file or stale context

---

### Round 3: Opus Escalation via Voice (5 min)

| Step | Action                                                      | Expected                                                          | Pass/Fail |
| ---- | ----------------------------------------------------------- | ----------------------------------------------------------------- | --------- |
| 3.1  | Voice: "Send a message in Discord saying 'test from voice'" | Message appears in `#general` within 5s                           |           |
| 3.2  | Check Discord for the message                               | Message text reads "test from voice"                              |           |
| 3.3  | Listen to voice response                                    | Voice says "I sent that message" or "Done" — NOT "I'm delegating" |           |
| 3.4  | Measure total latency (STT → message appears)               | < 5 seconds                                                       |           |
| 3.5  | Voice: "Send a DM to Blair saying 'voice escalation works'" | DM arrives (if DM supported), or graceful error                   |           |

**Failure modes to watch for:**

- Voice says "I can't do that" → escalation bridge not configured
- Voice says "I'm passing this to Opus" → UX leak, needs prompt fix
- Message appears but voice doesn't confirm → return path broken
- Latency > 10s → bridge overhead too high, investigate

---

### Round 4: Tool Speed — Simple Tasks (3 min)

| Step | Action                              | Expected                            | Pass/Fail |
| ---- | ----------------------------------- | ----------------------------------- | --------- |
| 4.1  | Voice: "What time is it?"           | Response < 2s, correct time         |           |
| 4.2  | Voice: "Open my notes"              | App opens or file accessed < 3s     |           |
| 4.3  | Voice: "Set a reminder for 5 PM"    | Confirmation < 3s (local Deepseek)  |           |
| 4.4  | Verify NO Opus subagent was spawned | Check logs — Deepseek handled alone |           |

**Failure modes to watch for:**

- Simple tasks escalating to Opus unnecessarily → routing logic too aggressive
- Local tasks taking > 5s → Deepseek model too slow or overloaded
- Tasks that should be local hitting the network → misconfigured routing

---

### Round 5: Tool Speed — Complex Tasks (5 min)

| Step | Action                                                          | Expected                                | Pass/Fail |
| ---- | --------------------------------------------------------------- | --------------------------------------- | --------- |
| 5.1  | Voice: "Research the latest AI news and create a note about it" | Opus escalation triggers                |           |
| 5.2  | Wait for response                                               | Voice summarizes findings within 10-15s |           |
| 5.3  | Check workspace for new note file                               | File exists with AI news content        |           |
| 5.4  | Voice: "Summarize my last 3 Discord conversations"              | Opus handles, responds within 10s       |           |

**Failure modes to watch for:**

- Deepseek tries to handle complex task itself → hallucinations, no tool use
- Opus takes > 20s → latency unacceptable for voice UX
- Note file created but voice doesn't mention it → return path issue

---

### Round 6: Fallback Behavior (3 min)

| Step | Action                                                 | Expected                                                       | Pass/Fail |
| ---- | ------------------------------------------------------ | -------------------------------------------------------------- | --------- |
| 6.1  | Stop the gateway: `openclaw gateway stop`              | Gateway stops cleanly                                          |           |
| 6.2  | Voice: "Send a Discord message saying 'fallback test'" | Voice says "I can't access my backend right now" or equivalent |           |
| 6.3  | Voice: "What time is it?"                              | Still works (local Deepseek, no backend needed)                |           |
| 6.4  | Restart gateway: `openclaw gateway start`              | Gateway comes back                                             |           |
| 6.5  | Voice: "Send a Discord message saying 'recovery test'" | Works normally again                                           |           |

**Failure modes to watch for:**

- Voice crashes or hangs when gateway is down → no error handling
- Voice hallucinates a response ("I sent it!") when it didn't → dangerous
- Gateway doesn't recover cleanly → restart issues
- Local tasks also break when gateway is down → over-dependency

---

### Round 7: Session Continuity (5 min)

| Step | Action                                                                      | Expected                              | Pass/Fail |
| ---- | --------------------------------------------------------------------------- | ------------------------------------- | --------- |
| 7.1  | Voice: "I'm working on a project called Midnight. It's a music visualizer." | Voice acknowledges                    |           |
| 7.2  | Voice: "The tech stack is Three.js and Web Audio API"                       | Voice acknowledges                    |           |
| 7.3  | Verify conversation written to memory                                       | Check `memory/` files                 |           |
| 7.4  | Switch to Discord: "What project am I working on?"                          | Bot says "Midnight"                   |           |
| 7.5  | Discord: "What tech stack?"                                                 | Bot says "Three.js and Web Audio API" |           |
| 7.6  | Discord: "Add React to the tech stack"                                      | Bot updates memory                    |           |
| 7.7  | Switch back to Voice: "What's the full tech stack for Midnight?"            | Voice includes React                  |           |

**Failure modes to watch for:**

- Voice writes to memory but Discord doesn't read it → session isolation
- Discord reads memory but can't find conversational context → format mismatch
- Bi-directional sync fails (Discord→Voice) → one-way only
- Context is there but lacks specificity → memory too vague

---

## Success Criteria Matrix

| Scenario                | Metric                        | Target    | Minimum Acceptable | Demo Blocker? |
| ----------------------- | ----------------------------- | --------- | ------------------ | ------------- |
| 1. Cross-Session Memory | Recall accuracy               | 100%      | 80% (gets gist)    | **YES**       |
| 2. Opus Escalation      | End-to-end latency            | < 5s      | < 10s              | **YES**       |
| 2. Opus Escalation      | UX (no "delegating" language) | Clean     | Clean              | **YES**       |
| 3. Simple Tool Speed    | Response time                 | < 3s      | < 5s               | No            |
| 4. Complex Tool Speed   | Response time                 | < 10s     | < 20s              | No            |
| 5. Fallback             | Graceful error message        | Clear msg | No crash           | **YES**       |
| 6. Session Continuity   | Context transfer accuracy     | 100%      | 80%                | **YES**       |

---

## Rollback Triggers

### 🔴 ABORT — Revert Everything

These failures mean the architecture isn't ready. Revert to previous setup:

1. **Opus escalation crashes or hangs** — Voice becomes unresponsive when trying to use tools
2. **Memory corruption** — Cross-session memory writes garbage or overwrites important data
3. **Latency > 20s consistently** — Voice UX is broken, worse than no tools at all
4. **Fallback doesn't work** — Gateway down causes crashes instead of graceful degradation
5. **Security leak** — Private memory content exposed in wrong channels

**Rollback procedure:**

1. Stop the unified Pearl config
2. Restore previous Voice Pearl config (standalone, no escalation)
3. Restore previous Discord bot config (standard Sonnet)
4. Verify both work independently
5. Document what failed and why

### 🟡 PAUSE — Fix Before Demo

These are fixable but need attention:

1. **Escalation language leaks** ("I'm delegating...") — Prompt engineering fix
2. **Latency 10-20s** on complex tasks — Optimize bridge, may need caching
3. **Memory recall at 60-80%** — Memory format or retrieval needs tuning
4. **One-way session continuity** — Voice→Discord works but not reverse

### 🟢 ACCEPTABLE — Note and Continue

These can be demoed around:

1. **Simple task latency 3-5s** — Slightly slow but not broken
2. **Complex task latency 10-15s** — Noticeable but explainable for demo
3. **Memory needs specific phrasing** — Can coach demo queries

---

## Wednesday Demo Walkthrough

### Demo Order (Optimized for Impact)

**Total time: ~8-10 minutes**

---

#### Act 1: "She Remembers" (2 min)

_Start with the wow factor — cross-session memory_

1. **Voice:** "Hey Nia, remember that I'm working on a new track called Echoes"
2. Nia confirms via voice
3. **Switch to Discord:** "What track am I working on?"
4. Nia responds: "Echoes"
5. **Narrate:** "Same agent, different interface, shared brain."

---

#### Act 2: "She Can Do Things" (2 min)

_Show Opus escalation — voice controlling Discord_

1. **Voice:** "Send a message in Discord saying 'hello from the other side'"
2. Watch message appear in Discord in real-time
3. **Voice response:** "Done, I sent it" (natural, no technical jargon)
4. **Narrate:** "She recognized this needed tools, escalated to a more capable model, executed, and reported back — all in under 5 seconds."

---

#### Act 3: "She's Fast" (1 min)

_Quick-fire simple tasks showing local Deepseek speed_

1. **Voice:** "What day is it?"
2. **Voice:** "How do you say 'good morning' in Japanese?"
3. **Voice:** "Tell me a one-line joke"
4. **Narrate:** "Simple tasks stay on the fast local model. No round-trip needed."

---

#### Act 4: "She's Smart" (2 min)

_Complex task showing Opus power_

1. **Voice:** "Look up what happened in AI news today and give me the highlights"
2. Wait for response (~10s)
3. **Narrate:** "That required web search and synthesis — automatically escalated to Claude Opus, which did the research and summarized it back through voice."

---

#### Act 5: "She's Resilient" (1 min)

_Optional — only if fallback is solid_

1. _(Pre-stage: gateway stopped)_
2. **Voice:** "Send a Discord message"
3. Nia: "I can't access my backend right now"
4. **Voice:** "What time is it?"
5. Nia responds correctly (local still works)
6. **Narrate:** "Graceful degradation. She knows what she can and can't do."

---

#### Act 6: "She Flows" (2 min)

_Session continuity — the killer feature_

1. **Voice:** "I'm thinking about adding reverb to the Echoes track, maybe a cathedral-style reverb"
2. Nia discusses options via voice
3. **Switch to Discord:** "What reverb style was I considering for Echoes?"
4. Nia: "Cathedral-style reverb"
5. **Discord:** "Actually, let's go with plate reverb instead"
6. **Switch back to Voice:** "What reverb did we decide on?"
7. Nia: "Plate reverb"
8. **Narrate:** "Seamless. Start a thought in voice, continue in text, come back to voice. It's all one conversation."

---

### Demo Tips

- **Have Discord open on screen** during voice tests so the audience sees messages appear in real-time
- **Keep a terminal with logs** visible (optional) to show escalation happening under the hood
- **Prepare backup talking points** in case any step is slow — explain the architecture while waiting
- **Test the full demo twice** before Wednesday, once on Tuesday night
- **Have the rollback ready** — if something breaks mid-demo, gracefully say "let me show you the next feature" and skip

---

## Test Log

_Fill in during testing sessions:_

| Date | Tester | Scenario | Result | Notes |
| ---- | ------ | -------- | ------ | ----- |
|      |        |          |        |       |
|      |        |          |        |       |
|      |        |          |        |       |

---

## Open Questions

- [ ] How does Deepseek determine when to escalate? (keyword-based? complexity scoring? explicit rules?)
- [ ] What's the exact memory format that both sessions read/write? (daily files? MEMORY.md? both?)
- [ ] Is there a message queue between Voice and Opus, or is it synchronous?
- [ ] What happens if Opus is rate-limited mid-escalation?
- [ ] Does the voice pipeline buffer TTS while waiting for Opus, or is there silence?
- [ ] How do we handle overlapping writes to memory from both sessions simultaneously?
