# Comprehensive Close Bug Analysis

**Date:** 2026-05-08
**Status:** 🔴 Analysis Complete - Multiple Root Causes
**Severity:** High — affects all app/window closing and call ending

---

## Executive Summary

Closing windows, apps, and calls in PearlOS is unreliable because the close event pipeline has **five distinct failure modes** across the frontend event routing, the server-side tool configuration, and the architectural split between two parallel window management systems. Fixing any single issue will improve reliability, but all must be addressed for consistent behavior.

---

## Architecture Overview

There are **two parallel window management systems** that both listen for the same custom events but filter by `source`:

### System A: `browser-window.tsx` (Legacy Desktop Shell)
- Processes ALL `WINDOW_OPEN_EVENT` and `WINDOW_CLOSE_EVENT` events
- Filters OUT events from chat sources (`chat-`, `chat:`, `splitchat:`) for **open** operations
- Does **NOT** filter by source for **close** operations
- Manages its own `openWindows` state array

### System B: `WindowManagerContext.tsx` (Split-Chat Window Manager)
- Processes ONLY events with `source` starting with `chat-`, `chat:`, or `splitchat:`
- Ignores ALL events without a `source` field (including all close events from niaEventRouter)
- Uses a dispatch-based reducer for window state

### Close Event Pipeline

```
User says "close X" → LLM → bot tool (server) → AppMessageForwarder emit_tool_event
  → [Daily data channel OR Gateway WebSocket]
  → niaEventRouter.routeNiaEvent()
  → handleViewClose() / handleWonderClear() / handleSessionEnd()
  → CustomEvent dispatch (WINDOW_CLOSE_EVENT, NIA_EVENT_WONDER_CLEAR, etc.)
  → browser-window.tsx / WonderCanvasRenderer / Call.tsx / Stage.tsx
```

---

## Root Causes

### 🔴 RC-1: Close events from niaEventRouter have NO `source` field

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`
**Functions:** `handleViewClose()` (lines 252-296), `handleCloseAll()` (lines 313-318)

Both `handleViewClose` and `handleCloseAll` dispatch `WINDOW_CLOSE_EVENT` without setting a `source` field on the `WindowCloseRequest` detail.

**Impact:**
- `WindowManagerContext.tsx` checks `isChatSource(detail?.source)` which returns `false` for `undefined`
- The split-chat WindowManager **silently ignores ALL close events** from bot voice commands
- If the user is in any layout that uses WindowManagerContext (split-chat, etc.), windows never close from voice commands

**Example code (lines 254-265):**
```typescript
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { viewType: resolved },  // NO source field!
  }),
);
```

**Contrast with open events:** `handleWindowOpen` sets `source: 'niaEventRouter'` — while this doesn't pass `isChatSource` in WindowManagerContext either, the legacy `browser-window.tsx` does process events with this source. Close events have no source at all.

---

### 🔴 RC-2: `handleWindowOpen` uses `source: 'niaEventRouter'` which doesn't pass `isChatSource` either

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`
**Function:** `handleWindowOpen()` (line 402)

```typescript
const req: WindowOpenRequest = {
  viewType: resolveViewType(payload),
  source: 'niaEventRouter',  // ← Does NOT pass isChatSource
  ...
};
```

**Impact:**
- Windows opened by bot voice commands **never reach** the split-chat WindowManager
- Only `browser-window.tsx` opens them (in the legacy desktop shell)
- In the split-chat interface, bot-opened windows are invisible/non-existent

---

### 🔴 RC-3: `wonder_canvas` app names in the "close all" fallback don't match any real windows

**File:** `apps/pipecat-daily-bot/bot/tools/view_tools.py` (lines ~188-199)

When `bot_close_browser_window` is called without apps (close all):

```python
await forwarder.emit_tool_event(events.APPS_CLOSE, {
    "apps": ["wonder_canvas", "news", "weather", "browser"]
})
```

On the frontend, `handleViewClose` maps these through `APP_NAME_TO_VIEW_TYPE`:
- `"wonder_canvas"` → `'custom'` viewType — closes a 'custom' window, not the Wonder Canvas
- `"news"` → `'news'` viewType — news isn't a browser window, it's on the Wonder Canvas
- `"weather"` → `'weather'` viewType — same issue
- `"browser"` → `'enhancedBrowser'` viewType — this one works

**Impact:** The `APPS_CLOSE` event in the fallback close-all path is mostly decorative. The actual close happens via `WONDER_CANVAS_CLEAR` which is emitted separately. If `WONDER_CANVAS_CLEAR` fails (see RC-5/RC-6/RC-7), the close-all silently fails for canvas content.

---

### 🔴 RC-4: `handleViewClose` fan-out for `apps.close` events duplicates `browser-window.tsx`'s own `resolveAppCloseTargets` mapping

**File:**
- `niaEventRouter.ts` → `APP_NAME_TO_VIEW_TYPE` (line 349)
- `browser-window.tsx` → `resolveAppCloseTargets` (line 1725)

Both maps translate app names to viewTypes, but they have **different entries**:

| App Name | `APP_NAME_TO_VIEW_TYPE` (niaEventRouter) | `resolveAppCloseTargets` (browser-window) |
|----------|------------------------------------------|------------------------------------------|
| `canvas` | `'canvas'` | `['canvas']` |
| `browser` | `'enhancedBrowser'` | `['miniBrowser', 'enhancedBrowser']` |
| `files` | `'files'` | ✗ Not present |
| `news` | `'news'` | ✗ Not present |
| `weather` | `'weather'` | ✗ Not present |
| `settings` | `'settings'` | ✗ Not present |
| `discord` | `'discord'` | ✗ Not present |
| `minibrowser` | `'miniBrowser'` | `['miniBrowser', 'enhancedBrowser']` |

**Impact:**
- The niaEventRouter maps app names to viewTypes and dispatches individual `WINDOW_CLOSE_EVENT`s
- browser-window.tsx then processes each event and calls `removeWindowsByViewTypes`
- But the niaEventRouter's mapping may produce a viewType that doesn't match the actual window that was opened
- When `browser-window.tsx.handleAppLaunch` opens `news`, it dispatches via `NIA_EVENT_WONDER_SCENE` → not created as a window → `WINDOW_CLOSE_EVENT` with viewType `'news'` won't find it

This is a symptom of the deeper issue: **two separate systems maintain mappings that should be centralized.**

---

### 🔴 RC-5: Gateway WebSocket dispatches to two different event channels (race condition)

**File:** `apps/interface/src/features/DailyCall/hooks/useGatewaySocket.ts` (lines 64-82)

```typescript
// Branch 1: dispatch to nia:app-message
if (data.kind === 'nia.event' || data.kind === 'nia.tool_result') {
  window.dispatchEvent(new CustomEvent('nia:app-message', { detail: data }));
}

// Branch 2: also dispatch to nia:tool-result (for same tool_result events)
if (data.kind === 'nia.tool_result' && data.payload) {
  const p = data.payload;
  if (p.action === 'close' || p.action === 'hide') {
    window.dispatchEvent(new CustomEvent('nia:tool-result', { detail: p }));
  }
}
```

For `nia.tool_result` events with `action: 'close'`, **both** branches fire:
1. `'nia:app-message'` → niaEventRouter → `handleViewClose` → dispatches `WINDOW_CLOSE_EVENT`
2. `'nia:tool-result'` → niaEventRouter toolResultListener → `handleViewClose` again

This causes TWO close events for the same request, with the dedup system in `nieEventRouter.ts` (`isDuplicate`) being the only defense. The dedup key uses `payload.html.length`, `payload.url`, and `payload.title` — none of which are meaningful for close events, so the second event may NOT be deduped, causing the same window to be closed twice.

---

### 🔴 RC-6: Iframe clear timeout is only 500ms (insufficient for complex scenes)

**File:** `apps/interface/src/features/Stage/WonderCanvas/WonderCanvasRenderer.tsx` (line ~143)

```typescript
const fallbackTimer = setTimeout(() => {
  logger.warn('Wonder canvas clear fallback — iframe did not confirm within 500ms');
  setActive(false);
}, 500);
```

500ms is far too short for iframes with complex PixiJS/Three.js or image-heavy content. The `wonder.cleared` message may arrive after the timeout, causing the canvas to flicker or remain visible briefly, confusing both the user and subsequent state.

---

### 🔴 RC-7: `handleWonderClear` tries to close a 'custom' window instead of the Wonder Canvas

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` (line 558)

```typescript
function handleWonderClear(payload: EventPayload): void {
  dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, { payload });  // ← This is correct

  // Close the custom wonder canvas window
  try {
    window.dispatchEvent(
      new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
        detail: { viewType: 'custom' },  // ← Wrong! Wonder Canvas is NOT a 'custom' window
      }),
    );
  }
}
```

The Wonder Canvas is rendered by `WonderCanvasRenderer.tsx` on the Stage, not as a ManeuverableWindow. Dispatching `WINDOW_CLOSE_EVENT` with `viewType: 'custom'` closes any open 'custom' windows (which may or may not exist), but does nothing to the Wonder Canvas iframe. The correct close path is the `dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, ...)` above it.

Additionally, this dispatch has no `source` field (see RC-1), so it would be ignored by WindowManagerContext anyway.

---

### 🔴 RC-8: `WONDER_CANVAS_APPS` set missing 'canvas'

**File:** `apps/pipecat-daily-bot/bot/tools/view_tools.py` (line ~87)

```python
WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content'}
# Missing: 'canvas'
```

When the LLM calls `bot_close_browser_window` with `apps: ["canvas"]`, the check at line ~93 fails:
```python
if any(a.lower() in WONDER_CANVAS_APPS for a in apps):
```
`'canvas'` is not in the set, so `WONDER_CANVAS_CLEAR` is never emitted. This is likely the most common trigger since the user says "close the canvas" and the LLM passes `apps: ["canvas"]`.

---

### 🔴 RC-9: Duplicate `NIA_EVENT_CANVAS_CLEAR` constants (namespace confusion)

**Files:**
- `apps/interface/src/components/canvas/types.ts`: `NIA_EVENT_CANVAS_CLEAR = 'nia.event.canvasClear'`
- `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`: `NIA_EVENT_CANVAS_CLEAR = 'nia:canvas.clear'`

These are **different strings** pointing to different listeners. The `UniversalCanvas` component listens for `'nia.event.canvasClear'` while the event router exports `'nia:canvas.clear'`. Any component importing from the wrong module will silently miss events.

---

### 🟡 RC-10: `experience.dismiss` event is not routed through niaEventRouter

**Files:**
- Server: `experience_tools.py` emits `events.EXPERIENCE_DISMISS` (`'experience.dismiss'`)
- Frontend: `Stage.tsx` listens for `'nia:experience.dismiss'`
- Router: `niaEventRouter.ts` doesn't map `'experience.dismiss'` anywhere

The event is emitted by the bot, arrives on the frontend, and `routeNiaEvent` receives it. But since `'experience.dismiss'` doesn't appear in `BACKEND_EVENT_ALIASES` and doesn't match any switch case, it falls through to the default and is logged as an unknown event. The `Stage.tsx` listener for `'nia:experience.dismiss'` is never triggered. This may not be a user-facing issue if the experience feature flag is off, but it's still broken.

---

### 🟡 RC-11: `bot_end_call` emits `BOT_SESSION_END` but uses the full payload format — may conflict with `isAssistantSelfCloseNiaEvent`

**File:** `apps/pipecat-daily-bot/bot/tools/misc_tools.py` (line 170)
**File:** `apps/interface/src/lib/assistant-feature-sync.ts` (line 86)

The `bot_end_call` tool emits:
```python
await forwarder.emit_tool_event(events.BOT_SESSION_END, {
    "reason": close_reason,
    "initiator": "assistant",
    "source": "bot_end_call",
    "graceful": True,
})
```

The `assistant-feature-sync.ts` checks `eventName === 'bot.session.end'` and returns `true`. But the `Call.tsx` handler for `NIA_EVENT_SESSION_END` checks `payload.initiator === 'assistant'`. Both checks exist and must pass for the call to end. If the payload structure is different between Daily and Gateway delivery paths, the check fails.

---

### 🟡 RC-12: No tool guidance for LLM to choose the correct close tool

The LLM may choose between `bot_wonder_canvas_clear` (correct for canvas), `bot_close_browser_window` (correct for browser windows), `bot_dismiss_experience`, or `bot_end_call`. Without explicit guidance, the LLM may:
- Use `bot_close_browser_window` for canvas close (RC-8 makes this fail)
- Use `bot_wonder_canvas_clear` for window close (doesn't close the window)
- Use `bot_close_browser_window` with unexpected app names
- Use the wrong tool entirely

---

## Specific Failure Scenarios

### User says "close the canvas"
1. LLM calls `bot_close_browser_window` with `apps: ["canvas"]`
2. RC-8: `'canvas'` not in `WONDER_CANVAS_APPS` → `WONDER_CANVAS_CLEAR` not emitted
3. `APPS_CLOSE` emitted with `apps: ["canvas"]`
4. `handleViewClose` maps `'canvas'` → `'canvas'` viewType
5. Dispatches `WINDOW_CLOSE_EVENT` without source → only processed by `browser-window.tsx`
6. `removeWindowsByViewTypes(['canvas'])` — no 'canvas' window exists → silently no-ops

### User says "close everything"
1. LLM calls `bot_close_browser_window` without apps
2. Server emits `WONDER_CANVAS_CLEAR` + `APPS_CLOSE` with `["wonder_canvas", "news", "weather", "browser"]`
3. RC-5: Gateway may double-dispatch, race condition
4. RC-4: `wonder_canvas` → `'custom'`, `news` → `'news'`, `weather` → `'weather'` don't match real windows
5. RC-6: Iframe clear timeout fires at 500ms, may conflict if iframe is busy
6. RC-11: No window system close happens for canvas apps

### User says "end the call" / "hang up"
1. LLM calls `bot_end_call`
2. Server emits `BOT_SESSION_END` with `initiator: "assistant"`
3. `routeNiaEvent` → `handleSessionEnd` → dispatches `NIA_EVENT_SESSION_END`
4. `Call.tsx` listener checks `payload.initiator === 'assistant'` → calls `onLeave()`
5. This flow should work IF the event reaches the frontend correctly
6. RC-11: If Daily bridge or Gateway drops/modifies payload, initiator check fails

### User says "close weather"
1. LLM calls `bot_close_browser_window` with `apps: ["weather"]`
2. `'weather'` IS in `WONDER_CANVAS_APPS` → emits `WONDER_CANVAS_CLEAR` as well
3. `APPS_CLOSE` with `apps: ["weather"]` → `handleViewClose` → maps to `'weather'` viewType
4. No 'weather' window exists → silently no-ops
5. But `WONDER_CANVAS_CLEAR` clears ALL canvas content, not just weather

### User says "close all windows" (in split-chat / WindowManager mode)
1. Same as "close everything" above
2. RC-1: All `WINDOW_CLOSE_EVENT` dispatches have no `source`
3. `WindowManagerContext` ignores them all (filtered by `isChatSource`)
4. If `browser-window.tsx` is not rendered (split-chat mode), windows remain open

---

## Recommended Fixes

### P0 — Fix: Set `source` on ALL WINDOW_CLOSE_EVENT dispatches in niaEventRouter

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`

Add `source` to ALL dispatch calls in `handleViewClose`, `handleCloseAll`, and `handleWonderClear`:

```typescript
// In handleViewClose per-app fan-out (line ~259):
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { viewType: resolved, source: 'niaEventRouter' },
  }),
);

// In handleViewClose fallback (line ~292):
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { ...closeReq, source: 'niaEventRouter' },
  }),
);

// In handleCloseAll (line ~312):
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { viewType: vt, source: 'niaEventRouter' },
  }),
);

// In handleWonderClear (line ~536):
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { viewType: 'custom', source: 'niaEventRouter' },
  }),
);
```

However, this alone doesn't fix the WindowManagerContext issue because `'niaEventRouter'` doesn't pass `isChatSource`. Two options:
- **Option A:** Change `isChatSource` to also accept `'niaEventRouter'` (but risk double-processing in legacy shell)
- **Option B:** Make niaEventRouter use `'chat:niaEventRouter'` as the source (passes both systems' checks)
- **Option C:** Have niaEventRouter dispatch to TWO event names — one for each system

**Recommendation: Option B** — Use `source: 'chat:niaEventRouter'` for both opens and closes. This passes `isChatSource` for WindowManagerContext AND `isSplitChatSource` for browser-window.tsx (which ignores split-chat sources). But this would mean browser-window.tsx **stops** processing niaEventRouter events!

Actually, the real fix is architectural:
1. In `browser-window.tsx`, change `processWindowOpenRequest` to NOT filter out split-chat sources for close operations (it already doesn't filter for close)
2. In `niaEventRouter`, use a consistent source like `source: 'niaEventRouter'`
3. In `WindowManagerContext`, change `isChatSource` to also accept events from `'niaEventRouter'`

---

### P0 — Fix: Add `'canvas'` to WONDER_CANVAS_APPS

**File:** `apps/pipecat-daily-bot/bot/tools/view_tools.py`

```python
WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content', 'canvas'}
```

Also consider normalizing aliases before checking:
```python
NORMALIZE_APP_ALIASES = {
    'wonder': 'wonder',
    'wonder canvas': 'wonder',
    'wonder-canvas': 'wonder',
    'wonder_canvas': 'wonder',
    'canvas': 'canvas',
}
```

---

### P0 — Fix: Remove the WINDOW_CLOSE_EVENT dispatch from handleWonderClear

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`

Simply remove lines 536-541 (the try/catch block around `WINDOW_CLOSE_EVENT` dispatch in `handleWonderClear`). The Wonder Canvas is cleared by the `dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, ...)` call above it, which is handled by `WonderCanvasRenderer.tsx`.

---

### P1 — Fix: Increase iframe clear timeout to 3-5 seconds

**File:** `apps/interface/src/features/Stage/WonderCanvas/WonderCanvasRenderer.tsx`

Change from 500ms to 5000ms for the clear fallback:

```typescript
const fallbackTimer = setTimeout(() => {
  logger.warn('Wonder canvas clear fallback — iframe did not confirm within 5s');
  setActive(false);
}, 5000);
```

---

### P1 — Fix: Centralize app-name-to-viewType mapping

**Files:**
- `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` (`APP_NAME_TO_VIEW_TYPE`)
- `apps/interface/src/components/browser-window.tsx` (`handleAppLaunch`, `resolveAppCloseTargets`)

Extract a single shared mapping module that both niaEventRouter and browser-window use. This ensures app names always map to the same viewTypes for both open and close operations.

---

### P1 — Fix: Clean up gateway WebSocket dual-dispatch

**File:** `apps/interface/src/features/DailyCall/hooks/useGatewaySocket.ts`

The `nia.tool_result` branch should NOT also dispatch to `'nia:app-message'`. If `action === 'close'`, only dispatch to `'nia:tool-result'`:

```typescript
if (data.kind === 'nia.event') {
  window.dispatchEvent(new CustomEvent('nia:app-message', { detail: data }));
} else if (data.kind === 'nia.tool_result' && data.payload) {
  const p = data.payload;
  let dispatched = false;
  if (p.action === 'close' || p.action === 'hide') {
    window.dispatchEvent(new CustomEvent('nia:tool-result', { detail: p }));
    dispatched = true;
  }
  if (p.action === 'open' || p.action === 'present') {
    window.dispatchEvent(new CustomEvent('nia:tool-result', { detail: p }));
    dispatched = true;
  }
  // Only dispatch to app-message if NOT a tool_result with recognized action
  if (!dispatched) {
    window.dispatchEvent(new CustomEvent('nia:app-message', { detail: data }));
  }
}
```

---

### P2 — Fix: Unify NIA_EVENT_CANVAS_CLEAR constant

Pick one value and delete the other. Recommend:
- Keep `'nia:canvas.clear'` (from niaEventRouter.ts) as the canonical event name
- Update `types.ts` constant to match, or re-export from niaEventRouter

---

### P2 — Fix: Add tool description guidance

In `view_tools.py`, update the `bot_close_browser_window` description to explicitly mention "canvas" as a valid app name. Also update `bot_wonder_canvas_clear` to say "use this for clearing the Wonder Canvas when the user says 'close the canvas'."

---

### P2 — Fix: Route `experience.dismiss` through niaEventRouter

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`

Add to `BACKEND_EVENT_ALIASES`:
```typescript
'experience.dismiss': EventEnum.EXPERIENCE_DISMISS,
```

And add a handler:
```typescript
case EventEnum.EXPERIENCE_DISMISS:
  dispatchCustomEvent('nia:experience.dismiss', { payload });
  break;
```

---

## Files Requiring Changes (Summary)

| File | Changes | Priority |
|------|---------|----------|
| `bot/tools/view_tools.py` | Add 'canvas' to WONDER_CANVAS_APPS; improve tool descriptions | P0 |
| `events/niaEventRouter.ts` | Add `source` to all WINDOW_CLOSE_EVENT dispatches; fix handleWonderClear; add experience.dismiss routing | P0 |
| `hooks/useGatewaySocket.ts` | Fix dual-dispatch for tool_result events | P1 |
| `Stage/WonderCanvas/WonderCanvasRenderer.tsx` | Increase iframe clear timeout to 5s | P1 |
| `components/canvas/types.ts` | Remove duplicate NIA_EVENT_CANVAS_CLEAR or re-export canonical | P2 |

---

## Testing Strategy

After fixes, verify these scenarios in BOTH desktop and split-chat modes:
1. "Close the canvas" → Wonder Canvas clears, no ghost window
2. "Close weather" → Only Weather content clears, other canvas content stays
3. "Close terminal" → Terminal window closes
4. "Close everything" → All windows close, Wonder Canvas clears
5. "Close all windows" → Same as above
6. "End call" / "hang up" → Daily call ends, UI returns to home
7. "Close notes" → Notes window closes
8. Verify close events from BOTH Daily channel and Gateway WebSocket produce identical behavior
