# Pearl Avatar Animation Regression Timeline

> Generated 2026-02-24 ~17:00 UTC by git history analysis

## Executive Summary

The avatar system has been through **three architectural swaps** in 48 hours:
1. **RiveAvatar** (full animation engine with sleep/wake/idle/talking GIFs) → working at `dee06c74`
2. **Inline GIF in ChatMode** (simple img swap) → introduced at `902924dc`, refined through several commits
3. **GIF revert attempt** (`ac57bfc2`, `323d2aa2`) → disabled RiveAvatar in layout.tsx, put simple GIF back in ChatMode

**The core problem:** RiveAvatar was the component with sleep/wake/idle/talking state machine logic. When it was disabled (commented out in `layout.tsx`), all those animations were lost. The GIF fallback in ChatMode only swaps between idle and talking — **no sleep or wake animations**.

---

## Timeline

### ✅ Last Known Good State

**Commit:** `dee06c74` — 2026-02-23 06:53 UTC  
**Message:** "Pearl UI bar: inline avatar, single Pearl, 57px, outer outline only, voice animation wired"

This commit had **both** systems active:
- RiveAvatar rendered globally in `layout.tsx` (full sleep/wake/idle/talking state machine)
- ChatMode also had an inline GIF avatar button

Blair later references this as the quality target ("not as fast/clean as dee06c74").

### 🔄 Architectural Switch: RiveAvatar becomes sole renderer

**Commit:** `902924dc` — 2026-02-23 07:00 UTC  
**Message:** "Restore RiveAvatar as sole Pearl renderer, remove inline GIF from ChatMode"

- Removed inline GIF button from ChatMode (replaced with 57px spacer div)
- Re-enabled RiveAvatar in layout.tsx
- RiveAvatar positioned in compact mode (bottom-left, 57px) when chat bar visible
- **This should have preserved all 4 animations** since RiveAvatar has the full state machine

### 📐 Positioning & Size Fixes (Feb 23, 07:16–08:30)

| Commit | Time | Change |
|--------|------|--------|
| `bc37af2e` | 07:16 | Pearl stays compact in chat bar, shows inactive image |
| `898cad95` | 07:48 | Fix compact Y position alignment |
| `c7ae2820` | 08:06 | Fix positioning: bottom/left instead of viewport calc |
| `4cc7f61b` | 08:08 | Lock Pearl into chat bar as flex child |
| `5730af39` | 08:15 | Pearl bar 30% larger (74px), talking only when speaking |
| `b36d93eb` | 08:29 | Increase size by 25% + add lip sync debug logging |

These commits progressively modified RiveAvatar's compact positioning. The `chatBarCompact` scaling approach (scale(0.228) → scale(0.285)) was fragile and may have caused visual glitches.

### ❌ Breaking Revert Attempt #1

**Commit:** `ac57bfc2` — 2026-02-24 08:17 UTC  
**Message:** "Revert Pearl avatar to animated GIFs, disable Rive renderer"

**What it did:**
- **Commented out RiveAvatar/RiveAvatarWithLipsync in `layout.tsx`** ← THIS IS THE BREAKING CHANGE
- Restored inline GIF in ChatMode with isPearlResponding logic
- Only toggles between `avatar-talking.gif` and `pearlIdle1.gif`
- **NO sleep animation, NO wake animation**

### ❌ Breaking Revert Attempt #2

**Commit:** `323d2aa2` — 2026-02-24 08:18 UTC  
**Message:** "Restore GIF-based Pearl avatar system - remove deprecated Rive"

- Further simplified ChatMode avatar to basic GIF swap (57px)
- Removed voice-state complexity from avatar button
- Still no sleep/wake — just idle ↔ talking

### 📍 Checkpoint (acknowledges broken state)

**Commit:** `43dd1571` — 2026-02-24 09:19 UTC  
**Message:** "📍 CHECKPOINT: Stable-ish state (not as fast/clean as dee06c74)"

Commit message explicitly documents:
> - Avatar stuck in idle animation (lips not moving)
> - Avatar appears awake at start instead of sleep mode

This commit also **removed the chatBarCompact positioning** from RiveAvatar, but since RiveAvatar was already disabled in layout.tsx, it had no effect.

### Current State (HEAD)

**Commit:** `0b370430` — 2026-02-24 13:28 UTC

- **RiveAvatar:** Exists in codebase with full state machine (sleep/wake/idle/talking), but **commented out in layout.tsx** (line 52-57)
- **ChatMode:** Has inline GIF avatar that only swaps idle ↔ talking based on `isPearlResponding`
- **Result:** No sleep pose, no wake animation. Only idle and talking GIF swap.

---

## Why the Reverts Failed

1. **RiveAvatar IS the animation state machine.** It contains ~1000+ lines handling sleep → wake → idle → talking transitions, GIF cycling, entry/exit animations, etc. The ChatMode GIF swap is just a simple ternary.

2. **The reverts disabled RiveAvatar entirely** by commenting it out in `layout.tsx`, then tried to replicate its behavior with a simple `<img src={isPearlResponding ? talking : idle}>` — which can never reproduce 4-state animations.

3. **Sleep/wake animations only exist in RiveAvatar.** Look at `RiveAvatar.tsx` lines 27-28:
   ```
   const AVATAR_WAKEUP_GIF = '/images/avatar/StarupPearl.gif';
   const AVATAR_SLEEP_GIF = '/images/avatar/PearlShutdown.gif';
   ```
   These GIFs are never referenced in ChatMode.

---

## Files Requiring Investigation

| File | Status | Notes |
|------|--------|-------|
| `apps/interface/src/app/layout.tsx` | **RiveAvatar commented out (lines 52-57)** | Must re-enable |
| `apps/interface/src/features/RiveAvatar/components/RiveAvatar.tsx` | Has full state machine but not rendered | chatBarCompact positioning was removed at `43dd1571` — needs restoration |
| `apps/interface/src/features/ChatMode/components/ChatMode.tsx` | Has inline GIF fallback | Needs to either delegate to RiveAvatar or incorporate sleep/wake GIFs |
| `apps/interface/src/features/RiveAvatar/components/RiveAvatarWithLipsync.tsx` | Lipsync wrapper | Also commented out in layout.tsx |
| `apps/interface/src/features/RiveAvatarLipsync/components/RiveAvatarLipsync.tsx` | Lipsync feature | Dependent on RiveAvatar being active |

---

## Key Commit Hashes Reference

| Hash | Date | Significance |
|------|------|-------------|
| `dee06c74` | Feb 23 06:53 | **Last known good** — all animations working |
| `902924dc` | Feb 23 07:00 | RiveAvatar made sole renderer (should still work) |
| `b36d93eb` | Feb 23 08:29 | Last commit touching RiveAvatar before revert |
| `ac57bfc2` | Feb 24 08:17 | **First breaking commit** — disabled RiveAvatar |
| `323d2aa2` | Feb 24 08:18 | Continued GIF-only approach |
| `43dd1571` | Feb 24 09:19 | Checkpoint acknowledging broken state |

---

## Recommended Fix Path (for other agents)

**DO NOT just uncomment RiveAvatar in layout.tsx** — the chatBarCompact positioning was removed at `43dd1571` so it will render at full size (250px) in the wrong position.

Steps needed:
1. Re-enable RiveAvatar in `layout.tsx`
2. Restore chatBarCompact positioning logic in `RiveAvatar.tsx` (from `902924dc`)
3. Remove or hide the inline GIF avatar from ChatMode (to avoid duplication)
4. Test all 4 states: sleep → wake → idle ↔ talking
5. Verify lip sync integration still works with `RiveAvatarWithLipsync`
