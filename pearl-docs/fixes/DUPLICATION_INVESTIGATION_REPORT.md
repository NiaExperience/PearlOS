# Task Duplication & Unsolicited Spawning Investigation Report

**Date:** 2026-02-24  
**Investigator:** Pearl  
**Requested by:** Paddy

---

## Executive Summary

**Findings:**
1. ✅ **Confirmed duplicate spawns:** 2x "Call Button Fix" agents spawned within ~1 minute
2. ⚠️ **Root cause:** Pearl doesn't check for existing similar tasks before spawning
3. 📋 **Unsolicited spawning:** Likely triggered by autocorrection/proactive suggestions

---

## Evidence: Duplicate Spawns

### Identified Duplicates

From `/root/.openclaw/agents/main/sessions/sessions.json`:

```
agent:main:subagent:6fd43ed3-c72b-4d9e-848a-2108a9bc1293
  Session ID: 76c38745-e1c4-4ec4-9b39-4a6100e68fdf
  Label: call-button-fix
  Created: 2026-02-24 13:17 UTC (537KB transcript)

agent:main:subagent:349b68e0-6867-4526-80b1-05f143cc99c8
  Session ID: a10454ee-bc1d-4835-b139-fd7b84893794
  Label: call-button-fix
  Created: 2026-02-24 13:16 UTC (374KB transcript)
```

**Timeline:** Both spawned within ~1 minute window (13:16-13:17 UTC / 08:16-08:17 EST)

### Related Task (Not Duplicate)

```
agent:main:subagent:e1e3235d-f331-4aa1-8613-d9704ceafc03
  Label: call-toggle-fix
  Created: same timeframe
```

This is a **separate task** (toggle vs button), not a duplicate.

---

## Root Cause Analysis

### 1. No Duplicate Prevention Logic

**Current Behavior:**
- Pearl receives request for "fix the call button"
- Immediately calls `sessions_spawn(task="Call Button Fix", ...)`
- **DOES NOT CHECK** if a similar task is already running
- Spawns duplicate agent even if one already exists

**Code Path:**
The `sessions_spawn` tool has NO guard logic:
```python
# Current implementation (pseudo-code)
def sessions_spawn(task, model, ...):
    # ❌ NO CHECK FOR EXISTING SIMILAR TASKS
    spawn_new_agent(task)  # Always spawns
```

**Fix Required:**
```python
# Proposed fix (pseudo-code)
def sessions_spawn(task, model, ...):
    # ✅ CHECK FOR DUPLICATES FIRST
    existing = sessions_list(kinds=["subagent"], activeMinutes=10)
    for session in existing:
        if similar_label(session.label, task):
            return f"Already working on '{session.label}' (skipping duplicate)"
    
    # Safe to spawn
    spawn_new_agent(task)
```

**Where to Implement:**
- Option A: In `sessions_spawn` tool itself (best - automatic guard)
- Option B: In Pearl's agent prompt/system instructions (manual check before each spawn)
- Option C: In OpenClaw Gateway spawn handler (server-side dedup)

**Recommended:** Option A - tool-level guard prevents all duplicates automatically.

---

### 2. Likely Trigger: Proactive Suggestions

**Hypothesis:** Pearl may have spawned both agents due to:

1. **Autocorrection/re-parsing:** User said something vague, Pearl interpreted it as "fix call button", spawned agent #1, then re-interpreted and spawned agent #2
2. **Multi-turn suggestion:** Pearl suggested "I'll fix the call button" in one message, user confirmed in next message, triggering second spawn
3. **Parallel execution bug:** If Pearl is processing multiple messages concurrently (e.g., voice + webchat), both could spawn the same agent

**Evidence Needed to Confirm:**
- Voice session transcript from ~13:15-13:20 UTC showing what user actually said
- Webchat session transcript (if active) during same timeframe
- OpenClaw gateway logs showing spawn requests

---

### 3. Unsolicited Spawning (Agents Starting Without Explicit Request)

**Possible Causes:**

#### A. Heartbeat-Triggered Spawns
- `HEARTBEAT.md` may contain logic that spawns agents automatically
- If heartbeat checks detect issues, Pearl might spawn fix agents without asking

**Check:**
```bash
grep -i "spawn\|subagent" /root/.openclaw/workspace/HEARTBEAT.md
```

#### B. Tool Side Effects
- Some tools may spawn agents as a side effect
- Example: "check voice pipeline" tool might spawn "fix voice pipeline" agent if it detects issues

**Check:** Review all tool definitions for spawn calls

#### C. Proactive Suggestion Misfire
- Pearl might be spawning agents for suggestions before user confirms
- Example: Pearl says "I can fix that for you", spawns agent immediately, but user didn't say yes yet

**Fix:** Add confirmation step before spawning any non-urgent agent

---

## Recommended Fixes (Priority Order)

### 1. **IMMEDIATE: Add Duplicate Prevention Guard**
**File:** OpenClaw `sessions_spawn` tool implementation  
**Change:** Check for existing similar tasks before spawning  
**Impact:** Prevents ALL future duplicates automatically

### 2. **HIGH: Add Confirmation for Proactive Spawns**
**File:** Pearl's system prompt / agent instructions  
**Change:** Require explicit user confirmation before spawning agents for suggestions  
**Impact:** Prevents unsolicited spawns

### 3. **MEDIUM: Add Spawn Logging**
**File:** OpenClaw gateway spawn handler  
**Change:** Log every spawn with trigger source (heartbeat/user_request/tool_call)  
**Impact:** Makes future investigations easier

### 4. **LOW: UI Feedback for Spawns**
**File:** PearlOS interface  
**Change:** Show toast/notification when agent is spawned with reason  
**Impact:** User awareness

---

## Next Steps

1. **Paddy:** Review this report, confirm findings
2. **Pearl:** Implement duplicate prevention guard in `sessions_spawn` tool
3. **Pearl:** Review HEARTBEAT.md and tool definitions for auto-spawning logic
4. **Pearl:** Add spawn confirmation logic to agent prompt
5. **Testing:** Reproduce scenario to verify fix works

---

## Questions for Paddy

1. Do you have access to voice session transcript from ~13:15-13:20 UTC today?
2. Was anyone using webchat + voice simultaneously during that timeframe?
3. Should ALL spawns require explicit user confirmation, or only "suggestion" spawns?
4. Preferred implementation: tool-level guard (Option A) or prompt-level check (Option B)?

---

**Report Status:** Draft - awaiting Paddy's review  
**Files Generated:**
- `/workspace/nia-universal/DUPLICATION_INVESTIGATION_REPORT.md` (this file)
- `/workspace/nia-universal/TASK_CONTROL_IMPLEMENTATION.md` (implementation plan)
