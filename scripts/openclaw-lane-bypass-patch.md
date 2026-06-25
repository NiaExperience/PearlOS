# OpenClaw Global Lane Bypass Patch

**Date:** 2026-04-30
**File patched:** `/usr/lib/node_modules/openclaw/dist/pi-embedded-runner-DN0VbqlW.js`
**Lines:** 7148 (compactEmbeddedPiSession) and 8344 (runEmbeddedPiAgent)

## Problem

PearlOS Discord/web chat persistently failed with "All models failed (2): kimi timeout | deepseek timeout" simultaneously, even though both upstream APIs were healthy in direct curl tests.

## Root cause

OpenClaw double-locks every chat: first on `sessionLane` (per-session), then INSIDE that callback on `globalLane` (defaults to "main" for ALL sessions). Per the orchestration audit:

- The lane queue has no per-task timeout
- The 600s abort timer only starts AFTER lane admission, so queued requests never get their own timeout started
- Model fallback (DeepSeek -> Kimi) lives INSIDE the lane callback and is unreachable when the queue is wedged
- One stuck task on the global "main" lane wedges every subsequent chat across every session

This explains the simultaneous-timeout signature: the failover loop never runs, so both providers "appear" to fail at the same budget.

## Fix

Bypass the global lane when no explicit lane is set by the caller. Per-session serialization stands alone; cross-tenant contention disappears.

```js
// Before:
const enqueueGlobal = params.enqueue ?? ((task, opts) => enqueueCommandInLane(globalLane, task, opts));

// After:
const _hasExplicitGlobalLane = Boolean(params.lane?.trim());
const enqueueGlobal = params.enqueue ?? (_hasExplicitGlobalLane
    ? ((task, opts) => enqueueCommandInLane(globalLane, task, opts))
    : ((task) => Promise.resolve(task())));
```

## Re-applying after OpenClaw upgrade

This patch lives in compiled JS. On `npm install -g openclaw@<newer>`, it will be wiped. To re-apply:

1. Find the file: `find /usr/lib/node_modules/openclaw/dist/ -name "pi-embedded-runner*.js"` (hash may change)
2. Search for the two `enqueueGlobal = params.enqueue` lines
3. Apply the patch above to both
4. Restart openclaw-gateway

Or upstream the fix to https://github.com/openclaw/openclaw if they accept it.
