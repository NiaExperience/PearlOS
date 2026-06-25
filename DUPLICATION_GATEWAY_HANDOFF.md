# OpenClaw Gateway Handoff: `sessions_spawn` Dedup

## Context

`nia-universal` voice runtime is using `openclaw_session` mode.  
Duplicate sub-agents are being created server-side when OpenClaw invokes `sessions_spawn`.

Local prompt guard has been added in `nia-universal`, but the bulletproof fix must be in Gateway tool logic.

## Required Change

Implement dedup inside OpenClaw Gateway `sessions_spawn` before creating a new sub-agent.

### Behavior

1. Call `sessions_list(kinds=["subagent"], activeMinutes=10)`.
2. Normalize requested task label and active labels.
3. Match by:
   - exact normalized equality, or
   - containment, or
   - token overlap threshold (start at 0.6).
4. If similar active session exists:
   - do not spawn
   - return existing session info with machine-readable dedup metadata.
5. Otherwise, proceed with normal spawn.

## Suggested Response Shape

```json
{
  "spawned": false,
  "dedup_reason": "similar_active_session",
  "existing_session_key": "agent:main:subagent:....",
  "existing_label": "call-button-fix"
}
```

## Logging (Recommended)

Log one structured event for each spawn decision:

- `action`: `spawn` or `dedup_skip`
- `task_label_normalized`
- `matched_session_key` (if dedup skip)
- `source_channel` (if known)
- `decision_latency_ms`

## Acceptance Criteria

1. Repeating the same task request within 10 minutes does not create a second sub-agent.
2. Similar phrasing of the same intent also dedups.
3. Distinct tasks still spawn normally.
4. Dedup decisions are visible in logs.
