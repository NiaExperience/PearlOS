# Bug: Wonder Canvas Close Gesture Doesn't Work Properly

**Reported:** 2026-05-07
**Status:** 🐛 Confirmed
**Severity:** Medium
**Reproducibility:** Intermittent (race-condition dependent)
**Original Engineer:** Bill (no longer day-to-day on PearlOS)

---

## Summary

When a user says "close the canvas" or uses a similar close gesture, the close tool is invoked correctly on the server side (verified by server logs), but the Wonder Canvas sometimes does not actually close on the frontend. The canvas stays visible or the close action appears to silently succeed without a visible effect.

---

## System Architecture (Close Flow)

There are **two canvas systems** in PearlOS, which is a key source of confusion:

1. **Wonder Canvas** — The primary visual canvas layer. Lives in the Stage as an `<iframe>` rendered by `WonderCanvasRenderer.tsx`. Receives scenes via `wonder.scene` events and clears via `wonder.clear` events. Event names: `nia:wonder.*`

2. **UniversalCanvas** — A legacy React component (`UniversalCanvas.tsx`) used by the window system for renderers like `HtmlRenderer`, `ArticleRenderer`, etc. No longer the primary canvas. Event names: `nia:canvas.*` / `nia.event.canvas*`

### Complete Close Chain

```
User: "close the canvas"
  → LLM tool call
  → Bot tool handler (server)
    → AppMessageForwarder.emit_tool_event()
  → Two paths to frontend:
    (A) Daily.co real-time data channel → niaEventRouter.routeNiaEvent()
    (B) Gateway WebSocket → useGatewaySocket → 'nia:app-message' → niaEventRouter
  → niaEventRouter dispatches CustomEvents
  → WonderCanvasRenderer listens for 'nia:wonder.clear'
  → postToIframe({ type: 'wonder.clear' })
  → Iframe processes clear, sends back 'wonder.cleared'
  → setActive(false)
```

### Two Relevant Bot Tools

| Tool | File | What It Emits |
|------|------|--------------|
| `bot_wonder_canvas_clear` | `wonder_canvas.py` | `events.WONDER_CANVAS_CLEAR` (`'wonder.clear'`) |
| `bot_close_browser_window` | `view_tools.py` | `events.APPS_CLOSE` AND/OR `events.WONDER_CANVAS_CLEAR` (conditional) |

---

## Root Causes Identified

### 1. 🔴 Namespace gap: "canvas" is NOT in WONDER_CANVAS_APPS

In `bot/view_tools.py` (line ~83):

```python
WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content'}
```

When the LLM calls `bot_close_browser_window` with `apps: ["canvas"]`, the check `any(a.lower() in WONDER_CANVAS_APPS for a in apps)` **fails** — there's no `"canvas"` in the set. So `WONDER_CANVAS_CLEAR` is never emitted for a "close the canvas" request.

**Likely the most common cause of the bug.** The LLM uses "canvas" as the app name because the user says "close the canvas," but the code expects "wonder" or "canvas-content".

### 2. 🔴 handleWonderClear dispatches WINDOW_CLOSE_EVENT with wrong viewType

In `niaEventRouter.ts` (handleWonderClear function):

```typescript
window.dispatchEvent(
  new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
    detail: { viewType: 'custom' }
  }),
);
```

The Wonder Canvas is **NOT a window** in the window manager — it's a separate layer rendered by `WonderCanvasRenderer`. Dispatching a close event for `viewType: 'custom'` targets the ManeuverableWindow system, not the Wonder Canvas. This event is **irrelevant** to the Wonder Canvas close and can cause side effects (closing the wrong thing or none at all).

### 3. 🟡 Two NIA_EVENT_CANVAS_CLEAR constants exist with different values

- `canvas/types.ts`: `NIA_EVENT_CANVAS_CLEAR = 'nia.event.canvasClear'`
- `niaEventRouter.ts`: `NIA_EVENT_CANVAS_CLEAR = 'nia:canvas.clear'`

These are **different strings** pointing to different listeners. The UniversalCanvas component listens for `'nia.event.canvasClear'`, while the `browser-window.tsx` event router uses `'nia:canvas.clear'`. Any component that imports from the wrong file will silently miss the event.

### 4. 🟡 handleWonderClear defers to dispatchCustomEvent — but iframe navigation creates race

```typescript
function handleWonderClear(payload: EventPayload): void {
  dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, { payload });

  // Then also tries to close a 'custom' window
  window.dispatchEvent(
    new CustomEvent<WindowCloseRequest>(WINDOW_CLOSE_EVENT, {
      detail: { viewType: 'custom' }
    }),
  );
}
```

The `dispatchCustomEvent` sends `NIA_EVENT_WONDER_CLEAR` which triggers the `handleClear` callback in `WonderCanvasRenderer`. But there's a 500ms fallback timeout:

```typescript
const fallbackTimer = setTimeout(() => {
  logger.warn('Wonder canvas clear fallback — iframe did not confirm within 500ms');
  setActive(false);
}, 500);
```

If the iframe is busy rendering a large scene (e.g., a complex PixiJS game or news article with many images), it may not respond with `wonder.cleared` within 500ms. The timeout fires and hides the canvas, but if the iframe processes the clear after the timeout, it can cause a re-render or state flicker.

### 5. 🟡 Gateway WebSocket bridge doesn't directly emit to WonderCanvasRenderer

In `useGatewaySocket.ts`, when a `nia.tool_result` comes through with `kind: 'nia.event'`:

```typescript
if (data.kind === 'nia.event' || data.kind === 'nia.tool_result') {
  window.dispatchEvent(
    new CustomEvent('nia:app-message', { detail: data }),
  );
}
```

This dispatches `'nia:app-message'` which `niaEventRouter` listens for. But there's also a **separate** branch that handles `nia.tool_result` with `action === 'close'`:

```typescript
if (data.kind === 'nia.tool_result' && data.payload) {
  const p = data.payload;
  if (p.action === 'close' || p.action === 'hide') {
    window.dispatchEvent(new CustomEvent('nia:tool-result', { detail: p }));
  }
}
```

These two paths can **race** — the `'nia:app-message'` path dispatches the `wonder.clear` event AND the `WINDOW_CLOSE_EVENT`, while the `'nia:tool-result'` path also dispatches something. If both processing paths arrive at the same component, behavior is undefined.

### 6. 🟢 Bot tool choice is inconsistent

The LLM may choose EITHER `bot_wonder_canvas_clear` OR `bot_close_browser_window` when the user says "close the canvas":

- `bot_wonder_canvas_clear` directly emits `wonder.clear` — this is the **correct** path
- `bot_close_browser_window` with `apps: ["canvas"]` — this path fails (see issue #1)

There's no guidance in the tool prompt for which tool to use when closing the canvas specifically.

---

## Reproduction Steps

1. Open a Wonder Canvas scene (e.g., ask Pearl to show a chart or news article)
2. Say "close the canvas"
3. Observe: the server logs show the close tool being invoked successfully
4. Observe: the canvas sometimes remains visible on the frontend

Likely most reproducible when:
- The canvas is showing complex content (images, games)
- The close request comes through the gateway WebSocket (text-only chat mode, not Daily)
- The LLM chooses `bot_close_browser_window` over `bot_wonder_canvas_clear`

---

## Recommended Fixes

### P0 — Fix WONDER_CANVAS_APPS set

**File:** `apps/pipecat-daily-bot/bot/tools/view_tools.py`

Add `'canvas'` to the `WONDER_CANVAS_APPS` set:

```python
WONDER_CANVAS_APPS = {'news', 'weather', 'wonder', 'canvas-content', 'canvas'}
```

Also consider adding alias normalization (e.g., `'wonder canvas'` → `'wonder'`).

### P0 — Clean up handleWonderClear in niaEventRouter

**File:** `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`

Remove the `WINDOW_CLOSE_EVENT` dispatch from `handleWonderClear` — the Wonder Canvas is not a window and should not be handled by the window manager. The `dispatchCustomEvent(NIA_EVENT_WONDER_CLEAR, ...)` is sufficient.

### P1 — Improve bot tool prompting

In `view_tools.py`, update the `bot_close_browser_window` description to handle the "canvas" app name explicitly:

> "Close Canvas app: pass 'canvas' or 'wonder' in the apps array to close the Wonder Canvas."

Or better, ensure `bot_wonder_canvas_clear` is always preferred for canvas close requests.

### P1 — Extend iframe clear timeout and add retry

**File:** `apps/interface/src/features/Stage/WonderCanvas/WonderCanvasRenderer.tsx`

Increase the 500ms fallback timeout to 3-5 seconds for complex scenes, or add a retry mechanism if the iframe doesn't acknowledge.

### P2 — Clean up event namespace duplication

Consider unifying `NIA_EVENT_CANVAS_CLEAR` to a single source of truth, or at minimum add a code comment warning about the split.

---

## Files Involved

| File | Role |
|------|------|
| `apps/pipecat-daily-bot/bot/tools/wonder_canvas.py` | Server tool: `bot_wonder_canvas_clear` (correct path) |
| `apps/pipecat-daily-bot/bot/tools/view_tools.py` | Server tool: `bot_close_browser_window` (broken path) |
| `apps/pipecat-daily-bot/bot/tools/events.py` | Event constants definition |
| `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` | Event routing: `routeNiaEvent`, `handleWonderClear` |
| `apps/interface/src/features/Stage/WonderCanvas/WonderCanvasRenderer.tsx` | Frontend component: renders iframe, handles clear events |
| `apps/interface/src/features/DailyCall/hooks/useGatewaySocket.ts` | Gateway WebSocket bridge (potential race condition) |
| `apps/interface/src/components/canvas/UniversalCanvas.tsx` | Legacy canvas component (not Wonder Canvas, but confusing namespace) |
| `apps/interface/src/components/canvas/types.ts` | Canvas event constants (different namespace from niaEventRouter!) |
| `apps/interface/src/lib/wonder-canvas-close-button.ts` | Close button HTML injected into iframe scenes |

---

## Logging / Debugging

Server-side log markers to look for:
- `[view_tools] bot_close_browser_window` — shows which tool was called and with what `apps` array
- `[view_tools] Also emitted wonder.clear for canvas app(s)` — shows when the clear was correctly paired
- `[wonder_canvas] Wonder Canvas clear` — shows when `bot_wonder_canvas_clear` was called

Client-side log markers:
- `[wonder_canvas] Clearing Wonder Canvas (source: ...)` — shows when clear was triggered
- `[wonder_canvas] Wonder canvas clear fallback — iframe did not confirm within 500ms` — shows timeout hit
- `[niaEventRouter] Dispatched nia:wonder.clear` — shows event was dispatched
- `[niaEventRouter] Dispatched pearl:window:close` — shows the (incorrect) window manager close
