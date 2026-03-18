# Duplication Fix Plan (Final, Lean)

**Date:** 2026-02-25  
**Status:** Approved direction  
**Scope:** Fix duplicate subagent spawns without degrading voice UX

---

## Final Decision

Drop timer-based voice throttling from the plan.  
It is a responsiveness tradeoff, not a true dedup solution.

Keep only the two fixes that directly solve the problem:

1. **P0: Prompt guard** (agent self-check before spawn)
2. **P1: Gateway `sessions_spawn` dedup** (server-side enforcement)

Optional but recommended:

3. **P2: Minimal observability** (spawn decision logs for audit/debug)

---

## Why This Is The Right Plan

- Current voice runtime is `openclaw_session` mode.
- Spawn decisions happen server-side in OpenClaw tooling (`sessions_spawn`), not in local fallback tools.
- Any fix outside the Gateway can reduce incidents but cannot guarantee dedup across channels.
- Raising `_min_processing_secs` does not guarantee dedup and can make voice interaction feel laggy.

---

## P0: Prompt Guard (Immediate)

**Owner:** this repo + OpenClaw prompt source  
**Effort:** ~30 minutes  
**Goal:** stop obvious duplicate/proactive spawns quickly

### Change

Add explicit spawn rules to the OpenClaw-facing prompt policy:

```text
SPAWN RULES:
- Before spawning any sub-agent, ALWAYS run sessions_list(activeMinutes=10) and check for similar labels.
- If a similar active task exists, DO NOT spawn. Reuse and report that existing task.
- Only spawn when the user explicitly asked for it.
- If spawn is only a suggestion, ask for confirmation first.
```

### Location

- Voice prompt section in `apps/pipecat-daily-bot/bot/pipeline/builder.py` (`oc_system_prompt`)
- Equivalent OpenClaw agent prompt source (if maintained outside this repo)

### Notes

- This is fast and practical.
- It is policy-level, so not fully bulletproof on its own.

---

## P1: Gateway `sessions_spawn` Dedup (Primary Fix)

**Owner:** OpenClaw Gateway repo (outside `nia-universal`)  
**Effort:** 1 to 2 hours  
**Goal:** enforce dedup at the only true choke point

### Required behavior

Before creating a subagent in `sessions_spawn`:

1. Query active subagent sessions (`sessions_list(activeMinutes=10)`).
2. Normalize requested task label and candidate labels.
3. Apply deterministic similarity checks:
   - exact match
   - containment
   - token overlap threshold (start around 0.6)
4. If match found, return existing session (no new spawn).
5. Return structured decision metadata (`spawned`, `dedup_reason`, `existing_session_key`).

### Pseudocode

```python
def sessions_spawn(task, model, ...):
    requested = normalize(task)
    active = sessions_list(kinds=["subagent"], activeMinutes=10)

    for session in active:
        label = normalize(session.label or "")
        if labels_similar(requested, label):
            return {
                "spawned": False,
                "dedup_reason": "similar_active_session",
                "existing_session_key": session.key,
                "existing_label": session.label,
            }

    return create_subagent(task=task, model=model, ...)
```

### Why this is bulletproof

It blocks duplicates regardless of:

- channel (voice, webchat, discord)
- client implementation
- prompt drift
- timing races between callers

---

## P2: Minimal Observability (Recommended)

**Owner:** Gateway + this repo  
**Effort:** ~30 to 60 minutes  
**Goal:** make dedup behavior verifiable

Log structured spawn decisions at Gateway:

- `action`: `spawn` or `dedup_skip`
- `task_label_normalized`
- `matched_session_key` (if skipped)
- `source_channel` (if known)
- `decision_latency_ms`

This is enough to validate fix effectiveness and tune similarity thresholds safely.

---

## Explicitly Removed

These are intentionally removed from final plan:

- Increasing `_min_processing_secs` as a dedup strategy
- Redis lock additions for this specific issue
- New Next.js dedup API routes as primary prevention
- UI-level dedup enforcement
- Broad changes in `openclaw_tools.py` for current `openclaw_session` path

---

## Rollout

1. **Today:** apply P0 prompt guard.
2. **Next:** implement P1 in OpenClaw Gateway `sessions_spawn`.
3. **After deploy:** validate with logs (P2), then tune matching threshold if needed.

---

## Success Criteria

- Repeating the same spawn request within 10 minutes does not create a second subagent.
- Proactive suggestions do not spawn without user confirmation.
- No measurable voice UX slowdown from artificial timing gates.
