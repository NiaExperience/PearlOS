# Pearl Avatar Animation Fix Plan (v2 — GIF-Only Architecture)

> Generated 2026-02-24 ~17:00 UTC | Revised per Blair directive: RiveAvatar is DEPRECATED.  
> Fix must use the current GIF-based architecture. No Rive restoration.

---

## Section 1: Root Cause Summary

### Why each animation broke (one sentence each)

- **Sleep pose:** The sleep GIF (`PearlShutdown.gif`) and inactive image (`Pearlinactivenew.png`) only existed in the now-deprecated RiveAvatar — ChatMode's inline avatar has no concept of a dormant/inactive state.
- **Wake animation:** The wakeup GIF (`StarupPearl.gif`) was triggered by RiveAvatar's entry transition logic — ChatMode has no call-start transition.
- **Idle loop:** ChatMode only shows `pearlIdle1.gif` — no cycling between multiple idle GIFs.
- **Lip sync / talking:** ChatMode swaps to `avatar-talking.gif` via `isPearlResponding`, which works for text streaming but relies on `isAssistantSpeaking` from voice context — **this actually works** but has no nuance (no intensity, no idle cycling between utterances).

### Which commits introduced the breakage

- **`ac57bfc2`** (Feb 24 08:17) — Disabled RiveAvatar, moved to inline GIF in ChatMode with only idle/talking states.
- **`323d2aa2`** (Feb 24 08:18) — Further stripped to basic GIF swap.

### Why revert attempts failed

They disabled the component with the state machine (RiveAvatar) and replaced it with a stateless ternary. The fix isn't to restore that component — it's to add proper state management to the GIF system.

---

## Section 2: The Proper Fix

### Strategy

Create a **`usePearlAvatarState` hook** that manages a simple state machine for the GIF avatar:

```
INACTIVE → (call starts) → WAKING → (1.5s) → IDLE ⇄ TALKING → (call ends) → SLEEPING → (2s) → INACTIVE
```

This hook:
- Watches `callStatus` transitions to trigger wake/sleep
- Watches `isAssistantSpeaking` and `isPearlResponding` for talk state
- Cycles idle GIFs on a timer
- Returns `{ avatarSrc: string, isClickable: boolean }` for the avatar button

**Why this is the right path:**
- Self-contained hook — no component surgery, no positioning changes
- ChatMode just consumes `avatarSrc` instead of computing it inline
- State machine is explicit, testable, and matches the animation spec
- GIF assets already exist — we just wire them up properly
- Zero Rive dependency

### Exact files to modify/create

| # | File | Action |
|---|------|--------|
| 1 | `apps/interface/src/features/ChatMode/hooks/usePearlAvatarState.ts` | **CREATE** — State machine hook |
| 2 | `apps/interface/src/features/ChatMode/components/ChatMode.tsx` | **MODIFY** — Use hook instead of inline ternary |

### What we're NOT touching

- `layout.tsx` — RiveAvatar stays commented out (deprecated)
- `RiveAvatar.tsx` — Untouched, deprecated
- `RiveAvatarLipsync/` — Untouched, deprecated
- `FloatingAvatar.tsx` — Untouched, legacy

---

## Section 3: Implementation Steps

### Step 1: Create `usePearlAvatarState` hook

New file with a 5-state machine: `INACTIVE → WAKING → IDLE ⇄ TALKING → SLEEPING → INACTIVE`

### Step 2: Wire hook into ChatMode

Replace the `liveAvatarSrc` ternary with the hook's output.

### Step 3: Verify GIF durations

- `StarupPearl.gif` — plays once as wake animation (~1.5s based on file analysis)
- `PearlShutdown.gif` — plays once as sleep animation (~2s)
- Both need `key` prop resets to replay from frame 0

### Step 4: Test all states

Full lifecycle: inactive → click → wake → idle → (Pearl talks) → talking → idle → click → sleep → inactive

### Step 5: Clean up dead references

Remove `LIVE_AVATAR_IDLE_GIF` / `LIVE_AVATAR_TALKING_GIF` constants from ChatMode top-level (they move into the hook).

---

## Section 4: Test Plan

### Verify each animation

| State | Expected Behavior | How to Test |
|-------|-------------------|-------------|
| **Inactive** | Shows `Pearlinactivenew.png` (static) | Open app, don't start voice |
| **Waking** | Shows `StarupPearl.gif` for ~1.5s | Click Pearl to start voice call |
| **Idle** | Cycles `pearlIdle1.gif` ↔ `Pearlidle2.gif` every 3-5s | Voice call active, Pearl not speaking |
| **Talking** | Shows `avatar-talking.gif` | Ask Pearl a question, watch during response |
| **Sleeping** | Shows `PearlShutdown.gif` for ~2s, then back to inactive | End voice call |

### Edge cases

1. **Full cycle:** inactive → wake → idle → talk → idle → sleep → inactive
2. **Rapid click:** Start call then immediately end it (wake should still play, then sleep)
3. **Talk during wake:** If Pearl starts speaking during wake animation, should transition to talking after wake completes
4. **Multiple idle cycles:** Leave Pearl idle for 30+ seconds — should keep cycling smoothly
5. **Text streaming without voice:** `isPearlResponding` should trigger talking even without active voice call
6. **Call fails to connect:** `callStatus` goes `loading → unavailable` — should return to inactive

### Regression checks

- Pearl button should remain clickable in all states
- No duplicate Pearl renders (no RiveAvatar re-enabled)
- Chat bar layout unchanged (57px avatar button, same position)
- No flash/jump when switching GIFs (use `key` prop for cache-busting on one-shot GIFs only)

---

## Section 5: Code Snippets Ready to Apply

### File 1: CREATE `apps/interface/src/features/ChatMode/hooks/usePearlAvatarState.ts`

```typescript
/**
 * usePearlAvatarState — GIF-based avatar state machine
 *
 * States: INACTIVE → WAKING → IDLE ⇄ TALKING → SLEEPING → INACTIVE
 *
 * Drives Pearl's avatar GIF based on voice session status and speech detection.
 * No Rive dependency — pure GIF swap with proper state transitions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ── GIF Assets ──
const AVATAR_INACTIVE = '/images/avatar/Pearlinactivenew.png';
const AVATAR_WAKEUP = '/images/avatar/StarupPearl.gif';
const AVATAR_SLEEP = '/images/avatar/PearlShutdown.gif';
const AVATAR_TALKING = '/images/avatar/avatar-talking.gif';
const AVATAR_IDLE_GIFS = [
  '/images/avatar/pearlIdle1.gif',
  '/images/avatar/Pearlidle2.gif',
];

// ── Durations (ms) ──
const WAKEUP_DURATION_MS = 1500;
const SLEEP_DURATION_MS = 2000;
const IDLE_CYCLE_MIN_MS = 3000;
const IDLE_CYCLE_MAX_MS = 5000;

type AvatarState = 'inactive' | 'waking' | 'idle' | 'talking' | 'sleeping';

interface PearlAvatarStateResult {
  /** Current GIF/image source to render */
  avatarSrc: string;
  /** Current state (for debug/test) */
  state: AvatarState;
  /** Cache-bust key — change forces <img> remount (for one-shot GIFs) */
  gifKey: number;
}

interface PearlAvatarStateOptions {
  /** Voice call status from useVoiceSessionContext */
  callStatus: string;
  /** Whether Pearl is currently speaking (voice TTS) */
  isAssistantSpeaking: boolean;
  /** Whether Pearl is responding (text streaming OR speaking) */
  isPearlResponding: boolean;
}

export function usePearlAvatarState({
  callStatus,
  isAssistantSpeaking,
  isPearlResponding,
}: PearlAvatarStateOptions): PearlAvatarStateResult {
  const [state, setState] = useState<AvatarState>('inactive');
  const [idleIndex, setIdleIndex] = useState(0);
  const [gifKey, setGifKey] = useState(0);

  // Refs for tracking previous values and pending timeouts
  const prevCallStatusRef = useRef<string>(callStatus);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track if Pearl started talking during wake — should transition after wake completes
  const pendingTalkRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  // ── Detect call start: INACTIVE/UNAVAILABLE → LOADING/ACTIVE ──
  useEffect(() => {
    const prev = prevCallStatusRef.current;
    prevCallStatusRef.current = callStatus;

    const wasInactive = prev === 'inactive' || prev === 'unavailable' || prev === null;
    const nowStarting = callStatus === 'loading' || callStatus === 'active';

    if (wasInactive && nowStarting && state === 'inactive') {
      // Trigger wake animation
      clearTimers();
      pendingTalkRef.current = false;
      setGifKey(k => k + 1); // Force GIF replay from frame 0
      setState('waking');

      timerRef.current = setTimeout(() => {
        // Wake done — go to idle (or talking if speech started during wake)
        if (pendingTalkRef.current) {
          pendingTalkRef.current = false;
          setState('talking');
        } else {
          setState('idle');
        }
        timerRef.current = null;
      }, WAKEUP_DURATION_MS);
    }

    // Detect call end: ACTIVE/LOADING → INACTIVE/UNAVAILABLE
    const wasActive = prev === 'active' || prev === 'loading';
    const nowEnded = callStatus === 'inactive' || callStatus === 'unavailable';

    if (wasActive && nowEnded && (state === 'idle' || state === 'talking' || state === 'waking')) {
      clearTimers();
      setGifKey(k => k + 1);
      setState('sleeping');

      timerRef.current = setTimeout(() => {
        setState('inactive');
        timerRef.current = null;
      }, SLEEP_DURATION_MS);
    }
  }, [callStatus, state, clearTimers]);

  // ── Toggle between IDLE ⇄ TALKING based on speech ──
  useEffect(() => {
    if (state === 'waking') {
      // If Pearl starts talking during wake, queue it
      if (isPearlResponding || isAssistantSpeaking) {
        pendingTalkRef.current = true;
      }
      return;
    }

    if (state === 'idle' && (isPearlResponding || isAssistantSpeaking)) {
      setState('talking');
    } else if (state === 'talking' && !isPearlResponding && !isAssistantSpeaking) {
      setState('idle');
    }
  }, [state, isPearlResponding, isAssistantSpeaking]);

  // ── Idle GIF cycling ──
  useEffect(() => {
    if (state !== 'idle') {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      return;
    }

    const scheduleNext = () => {
      const delay = IDLE_CYCLE_MIN_MS + Math.random() * (IDLE_CYCLE_MAX_MS - IDLE_CYCLE_MIN_MS);
      idleTimerRef.current = setTimeout(() => {
        setIdleIndex(prev => (prev + 1) % AVATAR_IDLE_GIFS.length);
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [state]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  // ── Resolve current GIF source ──
  let avatarSrc: string;
  switch (state) {
    case 'inactive':
      avatarSrc = AVATAR_INACTIVE;
      break;
    case 'waking':
      avatarSrc = AVATAR_WAKEUP;
      break;
    case 'sleeping':
      avatarSrc = AVATAR_SLEEP;
      break;
    case 'talking':
      avatarSrc = AVATAR_TALKING;
      break;
    case 'idle':
    default:
      avatarSrc = AVATAR_IDLE_GIFS[idleIndex];
      break;
  }

  return { avatarSrc, state, gifKey };
}
```

---

### File 2: MODIFY `apps/interface/src/features/ChatMode/components/ChatMode.tsx`

**Change A — Remove old constants and add import (top of file):**

BEFORE (lines 15-17):
```typescript
// Pearl avatar GIFs — kept for potential future use (e.g., expanded chat header)
const LIVE_AVATAR_IDLE_GIF = '/images/avatar/pearlIdle1.gif';
const LIVE_AVATAR_TALKING_GIF = '/images/avatar/avatar-talking.gif';
```

AFTER:
```typescript
import { usePearlAvatarState } from '../hooks/usePearlAvatarState';
```

**Change B — Replace inline ternary with hook (inside component body):**

BEFORE (line 54):
```typescript
  const liveAvatarSrc = isPearlResponding ? LIVE_AVATAR_TALKING_GIF : LIVE_AVATAR_IDLE_GIF;
```

AFTER:
```typescript
  const { avatarSrc: liveAvatarSrc, gifKey: avatarGifKey } = usePearlAvatarState({
    callStatus,
    isAssistantSpeaking,
    isPearlResponding,
  });
```

**Change C — Add `key` prop to the avatar `<img>` to force GIF replay:**

BEFORE (around line 492):
```tsx
        <img
          src={liveAvatarSrc}
          alt="Pearl"
          className="w-full h-full object-cover rounded-full"
        />
```

AFTER:
```tsx
        <img
          key={avatarGifKey}
          src={liveAvatarSrc}
          alt="Pearl"
          className="w-full h-full object-cover rounded-full"
        />
```

---

## Summary

**2 files touched (1 new, 1 modified). Zero Rive. Zero hacks.**

The entire fix is a clean state machine hook that:
- Watches `callStatus` for wake/sleep transitions
- Watches `isPearlResponding` / `isAssistantSpeaking` for talk/idle
- Cycles idle GIFs on a random timer
- Uses `key` prop to force one-shot GIFs (wake/sleep) to replay from frame 0
- Returns a single `avatarSrc` string for ChatMode to render

The existing ChatMode layout, positioning, and click handling are **completely untouched**. We're only replacing how `liveAvatarSrc` is computed.
