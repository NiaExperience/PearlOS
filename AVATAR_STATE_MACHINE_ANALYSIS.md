# Pearl Avatar Animation State Machine Analysis

**Date:** 2026-02-24  
**Status:** Root cause identification (no fixes)

---

## 1. Architecture Overview

There are **THREE separate Pearl avatar implementations**, causing confusion:

| Component | Type | Location | Currently Active? |
|---|---|---|---|
| `RiveAvatar` (GIF-based) | GIF switching | `features/RiveAvatar/components/RiveAvatar.tsx` | **NO** — commented out in `layout.tsx` AND returns `null` when `chatBarVisible` |
| `RiveAvatarWithLipsync` | Rive `.riv` state machine | `features/RiveAvatar/components/RiveAvatarWithLipsync.tsx` | **NO** — commented out in `layout.tsx` AND returns `null` when `chatBarVisible` |
| `ChatMode` inline avatar | Static GIF in chat bar | `features/ChatMode/components/ChatMode.tsx` | **YES** — always renders in HOME/WORK mode |

---

## 2. Expected State Machine Flow

```
Sleep (Pearlinactivenew.png)
    │ [voice session starts / callStatus → 'loading'|'active']
    ▼
Wake (StarupPearl.gif) — plays during entry transition (~1s)
    │ [entry transition completes]
    ▼
Idle (pearlIdle1.gif / Pearlidle2.gif) — cycles every 3-5s
    │ [isAssistantSpeaking === true]
    ▼
Talking (avatar-talking.gif)
    │ [isAssistantSpeaking === false]
    ▼
Idle (loops)
    │ [callStatus → 'inactive' / session ends]
    ▼
Sleep (PearlShutdown.gif) — plays during return animation (~3s)
    │ [return animation completes]
    ▼
Hidden (triggerAvatarHide)
```

---

## 3. ROOT CAUSE: Avatar Rendering Is Disabled

### Primary Issue: `layout.tsx` lines 53-58 — COMMENTED OUT

```tsx
// app/layout.tsx
{/* GIF-based avatar is rendered inline in ChatMode.tsx — Rive avatar disabled */}
{/* <ErrorBoundary name="Avatar" silent>
  {useLipsync ? (
    <RiveAvatarWithLipsync />
  ) : (
    <RiveAvatar />
  )}
</ErrorBoundary> */}
```

**Both `RiveAvatar` and `RiveAvatarWithLipsync` are completely unmounted.** They never render. No state machine runs.

### Secondary Issue: RiveAvatar self-disables in HOME/WORK mode

Even if uncommented, `RiveAvatar.tsx` returns `null` early when in HOME/WORK mode:

```tsx
// RiveAvatar.tsx, near line 440
const chatBarVisible = isChatMode || isHomeOrWorkMode;
if (chatBarVisible) {
  return null;  // ← Pearl avatar never renders in HOME/WORK mode
}
```

The comment in the code says "ChatMode renders Pearl inline" — but ChatMode only renders a **tiny static GIF in the chat input bar** with no state machine, no sleep/wake, and simplified talking detection.

### Same issue in `RiveAvatarWithLipsync`:

```tsx
// RiveAvatarWithLipsync.tsx
const chatBarVisible = isChatMode || isHomeOrWorkMode;
if (chatBarVisible || !isAvatarVisible || isDailyCallActive) {
  return null;
}
```

---

## 4. What ChatMode Actually Does (the only active avatar)

`ChatMode.tsx` renders Pearl as a **57×57px circle** inside the chat input bar:

```tsx
const LIVE_AVATAR_IDLE_GIF = '/images/avatar/pearlIdle1.gif';
const LIVE_AVATAR_TALKING_GIF = '/images/avatar/avatar-talking.gif';

const isPearlResponding = isTyping || (latestMessage?.isStreaming) || isAssistantSpeaking;
const liveAvatarSrc = isPearlResponding ? LIVE_AVATAR_TALKING_GIF : LIVE_AVATAR_IDLE_GIF;
```

**What's missing from ChatMode:**
- ❌ No sleep pose (`Pearlinactivenew.png`) 
- ❌ No wake animation (`StarupPearl.gif`)
- ❌ No shutdown animation (`PearlShutdown.gif`)
- ❌ No idle GIF cycling (always shows `pearlIdle1.gif`)
- ❌ No entry/exit position animation
- ⚠️ Talking detection relies on `isAssistantSpeaking` from voice context (may work if voice session active)

---

## 5. Lip Sync / Talking Animation Analysis

### GIF-based (`RiveAvatar.tsx`) — NOT MOUNTED
- Uses `useBotSpeakingDetection` hook with Daily.co `callObject`
- Detects speaking via audio level threshold (0.012) with 500ms debounce
- Switches between `avatar-talking.gif` and idle GIFs
- **Would work IF the component were mounted and a voice session were active**

### Rive-based (`RiveAvatarLipsync`) — NOT MOUNTED
- Uses sophisticated `useAnimationControl` → `useLipsyncSpeechDetection` hooks
- Drives Rive state machine inputs (`stage`, `relax_stage_value`, `look_left_value`)
- Processes transcript messages for lip sync intensity
- Uses `/master_pearl3.riv` file
- **Would work IF mounted, but requires the `.riv` file and Rive runtime**

### ChatMode inline — ACTIVE but simplified
- Uses `isAssistantSpeaking` from `useVoiceSessionContext()`
- Binary switch: talking GIF or idle GIF
- No intensity, no state machine, no transitions

---

## 6. Asset Reference Audit

| Asset | Path | File Exists? | Referenced By |
|---|---|---|---|
| Sleep/Inactive | `/images/avatar/Pearlinactivenew.png` | ✅ | `RiveAvatar.tsx` (not mounted), `ChatMode.tsx` (empty state only) |
| Wake/Startup | `/images/avatar/StarupPearl.gif` | ✅ | `RiveAvatar.tsx` only (not mounted) |
| Shutdown/Sleep | `/images/avatar/PearlShutdown.gif` | ✅ | `RiveAvatar.tsx` only (not mounted) |
| Idle 1 | `/images/avatar/pearlIdle1.gif` | ✅ | `RiveAvatar.tsx`, `ChatMode.tsx`, `TileRiveAvatar.tsx` |
| Idle 2 | `/images/avatar/Pearlidle2.gif` | ✅ | `RiveAvatar.tsx` only (not mounted) |
| Talking | `/images/avatar/avatar-talking.gif` | ✅ | `RiveAvatar.tsx`, `ChatMode.tsx`, `TileRiveAvatar.tsx` |
| Rive file | `/master_pearl3.riv` | ❓ (in public/) | `RiveAvatarLipsync.tsx` (not mounted) |

All GIF assets exist and paths are correct.

---

## 7. Summary of Root Causes

### 🔴 Critical: Avatar components commented out in layout.tsx
The `ErrorBoundary` wrapping both `RiveAvatarWithLipsync` and `RiveAvatar` is fully commented out. Neither component mounts. This is the **single biggest reason** all animations are broken.

### 🟡 Secondary: HOME/WORK mode early-return
Even if re-enabled in layout.tsx, both avatar components return `null` when `chatBarVisible` (HOME/WORK mode), deferring to ChatMode's simplified inline avatar.

### 🟡 Secondary: ChatMode has no state machine
The ChatMode inline avatar is a simple binary GIF switch with no sleep/wake/shutdown animations. It was designed as a minimal "avatar presence" in the chat bar, not a full state machine.

### 🟢 Minor: Dual implementation confusion
Having both GIF-based and Rive-based implementations creates confusion about which should be active. The `avatarLipsync` feature flag controls the choice but neither path renders.

---

## 8. Recommended Investigation for Fix

1. **Uncomment the avatar in `layout.tsx`** — this is the primary fix
2. **Resolve the HOME/WORK mode conflict** — decide whether RiveAvatar or ChatMode owns Pearl rendering in these modes
3. **Consider removing the `chatBarVisible` early return** from RiveAvatar if it should be the canonical renderer
4. **Verify `isAssistantSpeaking`** is actually being set correctly in the voice session context for the ChatMode path
