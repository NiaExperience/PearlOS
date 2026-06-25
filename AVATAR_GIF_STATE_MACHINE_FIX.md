# Avatar GIF State Machine — Implementation Plan

## Status: READY TO IMPLEMENT

## Problem
ChatMode.tsx shows a single static `pearl-animated.gif` in the chat input bar. No sleep/wake/idle/talking state transitions. The deprecated RiveAvatar (1000+ line Rive component) was removed in `ac57bfc2` and must NOT be restored.

## GIF Assets (Located)

All GIFs exist at `/workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/`:

| State | GIF File | Notes |
|-------|----------|-------|
| **Sleep → Wake** (startup) | `StarupPearl.gif` | One-shot animation, plays once on wake |
| **Wake → Sleep** (shutdown) | `PearlShutdown.gif` | One-shot animation, plays once on sleep |
| **Idle** | `avatar-idle.gif` / `pearlIdle1.gif` / `Pearlidle2.gif` | Looping idle animation |
| **Talking** | `avatar-talking.gif` / `PearlTalking1.gif` | Looping talk animation |
| **Static (asleep)** | `Pearlinactivenew.png` | Static image when fully asleep |

**NOTE:** These GIFs need to be copied to `nia-universal/apps/interface/public/images/avatar/` (they currently only exist in PearlOS_GitPublic).

## State Machine Design

```
                    ┌─────────┐
                    │  SLEEP  │ (static PNG, initial state)
                    └────┬────┘
                         │ user opens chat / voice starts
                         ▼
                    ┌─────────┐
                    │ WAKING  │ (StarupPearl.gif, plays once)
                    └────┬────┘
                         │ animation ends (~2-3s)
                         ▼
               ┌─────────────────┐
               │      IDLE       │◄──── assistant stops speaking
               │ (avatar-idle.gif)│
               └────────┬────────┘
                        │ assistant starts speaking
                        ▼
              ┌──────────────────┐
              │    TALKING       │
              │(avatar-talking.gif)│
              └──────────────────┘
                        │ user closes chat / voice ends
                        ▼
                   ┌──────────┐
                   │ SLEEPING │ (PearlShutdown.gif, plays once)
                   └────┬─────┘
                        │ animation ends
                        ▼
                   ┌──────────┐
                   │  SLEEP   │
                   └──────────┘
```

### Transitions:
- **SLEEP → WAKING**: `isChatMode` becomes true OR voice call starts
- **WAKING → IDLE**: After `StarupPearl.gif` plays once (~2500ms)
- **IDLE → TALKING**: `isTyping` becomes true (assistant responding)
- **TALKING → IDLE**: `isTyping` becomes false
- **IDLE → SLEEPING**: `isChatMode` becomes false AND no voice call
- **SLEEPING → SLEEP**: After `PearlShutdown.gif` plays once (~2000ms)

## Architecture

### New Component: `PearlAvatar.tsx`

Create a dedicated avatar component that encapsulates all state machine logic. Drop-in replacement for the current `<img>` tag in ChatMode.tsx.

**Location:** `apps/interface/src/components/PearlAvatar.tsx`

### Copy-Paste Ready Code

#### 1. `apps/interface/src/components/PearlAvatar.tsx`

```tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

// ── GIF asset paths ──
const AVATAR_GIFS = {
  sleep: "/images/avatar/Pearlinactivenew.png",
  waking: "/images/avatar/StarupPearl.gif",
  idle: "/images/avatar/avatar-idle.gif",
  talking: "/images/avatar/avatar-talking.gif",
  sleeping: "/images/avatar/PearlShutdown.gif",
} as const;

type AvatarState = "sleep" | "waking" | "idle" | "talking" | "sleeping";

// Durations for one-shot animations (ms). Measure actual GIF lengths and adjust.
const WAKING_DURATION = 2500;
const SLEEPING_DURATION = 2000;

interface PearlAvatarProps {
  /** Whether the avatar should be "awake" (chat mode active or voice call active) */
  isAwake: boolean;
  /** Whether the assistant is currently speaking/typing */
  isTalking: boolean;
  /** Size in px */
  size?: number;
  /** Click handler */
  onClick?: () => void;
  /** Additional className */
  className?: string;
}

const PearlAvatar: React.FC<PearlAvatarProps> = ({
  isAwake,
  isTalking,
  size = 30,
  onClick,
  className = "",
}) => {
  const [state, setState] = useState<AvatarState>("sleep");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ── Wake/Sleep transitions ──
  useEffect(() => {
    if (isAwake && (state === "sleep" || state === "sleeping")) {
      // Cancel any pending sleep timer
      if (timerRef.current) clearTimeout(timerRef.current);

      setState("waking");
      timerRef.current = setTimeout(() => {
        setState(isTalking ? "talking" : "idle");
      }, WAKING_DURATION);
    } else if (!isAwake && state !== "sleep" && state !== "sleeping" && state !== "waking") {
      if (timerRef.current) clearTimeout(timerRef.current);

      setState("sleeping");
      timerRef.current = setTimeout(() => {
        setState("sleep");
      }, SLEEPING_DURATION);
    }
  }, [isAwake]); // intentionally only depend on isAwake

  // ── Idle/Talking transitions (only when fully awake) ──
  useEffect(() => {
    if (state === "idle" && isTalking) {
      setState("talking");
    } else if (state === "talking" && !isTalking) {
      setState("idle");
    }
  }, [isTalking, state]);

  // Force-reload GIF on one-shot animations by appending cache-buster
  const src = (state === "waking" || state === "sleeping")
    ? `${AVATAR_GIFS[state]}?t=${Date.now()}`
    : AVATAR_GIFS[state];

  return (
    <img
      src={src}
      alt="Pearl"
      onClick={onClick}
      className={`shrink-0 rounded-full cursor-pointer ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        objectFit: "cover",
        opacity: state === "sleep" ? 0.6 : 1,
        transition: "opacity 0.3s ease",
      }}
      onError={(e) => {
        (e.target as HTMLImageElement).src = "/images/pearl-avatar.png";
      }}
    />
  );
};

export default PearlAvatar;
```

#### 2. Update `ChatMode.tsx` — Replace the `<img>` tag

In `ChatMode.tsx`, replace the existing avatar `<img>` with:

```tsx
// Add import at top:
import PearlAvatar from '@interface/components/PearlAvatar';

// In the minimized state bar, replace the <img src="/images/pearl-animated.gif" ...> block with:
<PearlAvatar
  isAwake={isChatMode}
  isTalking={isTyping}
  size={30}
  onClick={() => {
    triggerAvatarPopup();
    if (toggleCall) {
      toggleCall();
    } else {
      window.dispatchEvent(new Event('assistant:force-start'));
    }
  }}
/>
```

#### 3. Copy GIF Assets

```bash
# From project root
mkdir -p apps/interface/public/images/avatar
cp /workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/StarupPearl.gif \
   /workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/PearlShutdown.gif \
   /workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/avatar-idle.gif \
   /workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/avatar-talking.gif \
   /workspace/PearlOS_GitPublic/PearlOS/apps/interface/public/images/avatar/Pearlinactivenew.png \
   apps/interface/public/images/avatar/
```

## Future Enhancements

- **Larger avatar display**: The current 30px avatar in the chat bar is tiny. Consider adding a larger avatar (120-200px) in the expanded chat header or as a standalone orb component.
- **Voice call integration**: Wire `isAwake` to voice call state too (not just chat mode).
- **GIF duration detection**: Auto-detect GIF loop count/duration instead of hardcoded timers.
- **Preloading**: Preload all GIFs on app init to avoid flash of missing image on first transition.

## Files to Create/Modify

| Action | File |
|--------|------|
| **CREATE** | `apps/interface/src/components/PearlAvatar.tsx` |
| **MODIFY** | `apps/interface/src/features/ChatMode/components/ChatMode.tsx` |
| **COPY** | 5 GIF/PNG assets to `apps/interface/public/images/avatar/` |
