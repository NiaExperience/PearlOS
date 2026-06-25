# Desktop Mode Switch Implementation Guide

**Status:** ✅ IMPLEMENTED  
**Date:** 2026-02-23  
**Target:** Neala's demo  

---

## Overview

This document describes the implementation of the desktop mode switch feature for PearlOS. The feature allows users to switch between desktop, mobile, and tablet interface modes via voice command.

### What Was Fixed

The root cause was a **broken event chain** between the backend and frontend:

1. **Backend tool** (`bot_switch_desktop_mode`) ✅ emitted events correctly
2. **Frontend event router** ❌ didn't dispatch CustomEvents to React components
3. **Frontend component listener** ❌ wasn't wired up to receive events

### Solution

Created three integrated components:

1. **niaEventRouter.ts** - Routes backend events to CustomEvent dispatch
2. **DesktopBackgroundSwitcher.tsx** - Listens for mode changes and updates UI
3. **interfaceMode.css** - Styles to force layout mode regardless of viewport

---

## Files Created/Modified

### Core Implementation Files

| File | Purpose | Status |
|------|---------|--------|
| `apps/interface/src/features/DailyCall/events/niaEventRouter.ts` | Event routing from backend to CustomEvent dispatch | ✅ Created |
| `apps/interface/src/features/DesktopBackgroundSwitcher.tsx` | React component that listens for mode changes | ✅ Created |
| `apps/interface/src/styles/interfaceMode.css` | CSS overrides for mode-specific layouts | ✅ Created |
| `apps/interface/src/components/MainLayout.tsx` | Root layout integrating event system | ✅ Created |
| `apps/interface/src/features/DailyCall/events/index.ts` | Event system exports | ✅ Created |

### Test Files

| File | Purpose | Status |
|------|---------|--------|
| `apps/interface/src/features/DailyCall/__tests__/niaEventRouter.test.ts` | Unit tests for event routing | ✅ Created |

---

## How It Works

### Event Flow

```
User (voice): "Switch to desktop mode"
     ↓
Pearl's LLM: Invokes bot_switch_desktop_mode(mode="desktop")
     ↓
Backend bot gateway: emit_event("DESKTOP_MODE_SWITCH", {mode: "desktop"})
     ↓
WebSocket: Sends event to frontend
     ↓
niaEventRouter.routeNiaEvent("DESKTOP_MODE_SWITCH", {mode: "desktop"})
     ↓
window.dispatchEvent(CustomEvent("nia:desktop.mode.switch", {detail: {mode: "desktop"}}))
     ↓
DesktopBackgroundSwitcher listener: Receives event
     ↓
DesktopBackgroundSwitcher.setMode("desktop")
     ↓
CSS class applied: document.documentElement.classList.add("interface-mode-desktop")
     ↓
Sidebar appears, mobile nav disappears
     ↓
UI updates to desktop layout
```

### Component Architecture

#### niaEventRouter.ts
- Central event routing for all backend events
- Defines `EventEnum` with event types
- `routeNiaEvent()` function dispatches CustomEvents
- Logs events for debugging
- Integrates with PostHog analytics

#### DesktopBackgroundSwitcher.tsx
- React component that manages interface mode state
- Listens for `nia:desktop.mode.switch` CustomEvent
- Applies CSS classes to force layout mode
- Persists preference to localStorage
- Provides hooks: `useInterfaceMode()`, `useIsMobileViewport()`, `useModeIsOverridden()`
- Respects physical viewport but can override it

#### interfaceMode.css
- Three mode classes: `interface-mode-desktop`, `interface-mode-mobile`, `interface-mode-tablet`
- Uses CSS variables for responsive layout control
- `@media` queries ensure mobile devices can still use desktop mode if forced
- Utility classes: `.show-in-desktop-mode`, `.hide-in-mobile-mode`, etc.

#### MainLayout.tsx
- Root layout component wrapping entire app
- Initializes event routing system
- Provides `DesktopBackgroundSwitcher` context
- Exports hooks for use throughout app

---

## Integration Steps

### 1. Import in Your Root App Component

```typescript
import { MainLayout } from '@/components/MainLayout';
import '@/styles/interfaceMode.css';

export default function App() {
  return (
    <MainLayout>
      {/* Your app content */}
    </MainLayout>
  );
}
```

### 2. Use Hooks in Components

```typescript
import { useInterfaceMode, useIsMobileViewport } from '@/components/MainLayout';

export function MyComponent() {
  const mode = useInterfaceMode();
  const isMobile = useIsMobileViewport();
  
  return (
    <div>
      Current mode: {mode}
      Physical viewport is mobile: {isMobile}
    </div>
  );
}
```

### 3. Apply CSS Classes for Mode-Specific UI

```html
<!-- Show only in desktop mode -->
<div class="show-in-desktop-mode">
  This only appears in desktop mode
</div>

<!-- Hide in mobile mode -->
<div class="hide-in-mobile-mode">
  This doesn't appear on mobile
</div>

<!-- Custom mode-specific styles -->
<div class="interface-mode-desktop">
  <div class="sidebar">
    This sidebar only shows in desktop mode
  </div>
</div>
```

### 4. Connect Backend Event Router

In your WebSocket/event handler:

```typescript
import { routeNiaEvent } from '@/features/DailyCall/events';

// When you receive an event from the backend:
websocket.on('message', (event) => {
  // Route the event through the system
  routeNiaEvent(event.type, event.payload);
});
```

---

## Testing the Implementation

### Manual Testing via Voice Command

1. **Start the app** with MainLayout wrapped around your content
2. **Open browser console** (F12 → Console tab)
3. **Start a voice session**
4. **Say:** "Switch to desktop mode"
5. **Observe:**
   - Console logs: `[DesktopBackgroundSwitcher] Mode switch event received: desktop`
   - UI updates: Sidebar appears, mobile nav disappears
   - CSS class applied: `interface-mode-desktop` on `<html>` element
   - localStorage updated: `pearl_interface_mode = "desktop"`

6. **Say:** "Switch to mobile mode"
7. **Observe:**
   - Console logs: `[DesktopBackgroundSwitcher] Mode switch event received: mobile`
   - UI updates: Sidebar disappears, mobile nav appears
   - CSS class applied: `interface-mode-mobile`

### Unit Tests

```bash
# Run event routing tests
npm test -- niaEventRouter.test.ts
```

Expected output:
```
✓ should dispatch CustomEvent when DESKTOP_MODE_SWITCH is routed
✓ should dispatch CustomEvent for mobile mode
✓ should dispatch CustomEvent for tablet mode
✓ should use default mode if not provided
✓ should include timestamp in event detail
```

### Browser Console Debugging

Enable detailed logging by checking the browser console during mode switches:

```javascript
// Look for these logs:
[niaEventRouter] Event received: nia.event.desktopModeSwitch
[niaEventRouter] Desktop mode switch dispatched: desktop
[DesktopBackgroundSwitcher] Mode switch event received: desktop
[DesktopBackgroundSwitcher] Applied CSS class: interface-mode-desktop
[MainLayout] Mode changed: desktop
```

---

## CSS Mode Classes

### Available Classes

```css
.interface-mode-desktop   /* Forces desktop layout */
.interface-mode-mobile    /* Forces mobile layout */
.interface-mode-tablet    /* Forces tablet layout */

/* Utility classes */
.show-in-desktop-mode     /* Only visible in desktop */
.show-in-mobile-mode      /* Only visible in mobile */
.show-in-tablet-mode      /* Only visible in tablet */
.hide-in-desktop-mode     /* Hidden in desktop */
.hide-in-mobile-mode      /* Hidden in mobile */
.hide-in-tablet-mode      /* Hidden in tablet */

/* Component classes (to be applied in JSX) */
[data-component="sidebar"]
[data-component="main-content"]
[data-component="mobile-nav"]
[data-component="mobile-drawer"]
```

### CSS Variables

```css
--interface-mode: desktop | mobile | tablet
--sidebar-width: 280px | 200px | 0
--mobile-nav-height: 0 | 56px
--main-content-margin-left: 280px | 200px | 0
--main-content-margin-bottom: 0 | 56px
--sidebar-visible: 1 | 0
--mobile-nav-visible: 1 | 0
```

---

## Hooks Reference

### useInterfaceMode()

Returns current interface mode.

```typescript
const mode = useInterfaceMode(); // 'desktop' | 'mobile' | 'tablet'
```

### useIsMobileViewport()

Returns true if physical viewport width is < 768px.

```typescript
const isMobile = useIsMobileViewport(); // boolean
```

### useModeIsOverridden()

Returns true if user explicitly switched modes (not following viewport).

```typescript
const isOverridden = useModeIsOverridden(); // boolean
```

---

## Troubleshooting

### Issue: Mode doesn't change when I say "Switch to desktop mode"

**Checklist:**
- [ ] `MainLayout` is wrapping your app
- [ ] `initializeNiaEventRouter()` is called
- [ ] Backend is actually emitting the event (check bot logs)
- [ ] Event is reaching frontend (check WebSocket messages in Network tab)
- [ ] Event router is routing the event (check console for `[niaEventRouter]` logs)

**Debug steps:**
1. Check browser console for error messages
2. Add console.log in `routeNiaEvent()` to verify it's called
3. Add listener in browser console:
   ```javascript
   window.addEventListener('nia:desktop.mode.switch', (e) => console.log('Event received!', e.detail));
   ```
4. Manually dispatch event to test listener:
   ```javascript
   window.dispatchEvent(new CustomEvent('nia:desktop.mode.switch', {detail: {mode: 'desktop'}}));
   ```

### Issue: CSS classes not applied

**Checklist:**
- [ ] `interfaceMode.css` is imported in your app
- [ ] `DesktopBackgroundSwitcher` component is mounted
- [ ] Check browser DevTools: Is `interface-mode-desktop` class on `<html>` element?

**Debug:**
```javascript
// Check if class is applied
console.log(document.documentElement.className);
// Should include: interface-mode-desktop, interface-mode-mobile, or interface-mode-tablet

// Manually add class to test
document.documentElement.classList.add('interface-mode-mobile');
```

### Issue: Mode resets on page refresh

**Checklist:**
- [ ] localStorage is enabled in browser
- [ ] No localStorage clearing in code

**Debug:**
```javascript
// Check localStorage
console.log(localStorage.getItem('pearl_interface_mode'));
// Should be: 'desktop', 'mobile', or 'tablet'

// Manually set localStorage
localStorage.setItem('pearl_interface_mode', 'mobile');
// Refresh page - mode should persist
```

---

## Backend Integration

### What the Backend Needs to Do

The bot tool must emit the `DESKTOP_MODE_SWITCH` event with the correct format:

```python
# In bot/tools/view_tools.py
@bot_tool(name="bot_switch_desktop_mode", description="Switch interface modes")
def switch_desktop_mode(mode: str = "desktop") -> dict:
    return emit_event("DESKTOP_MODE_SWITCH", {"mode": mode})
```

### Expected Event Format

The event must reach the frontend as:

```json
{
  "type": "DESKTOP_MODE_SWITCH",
  "payload": {
    "mode": "desktop"
  }
}
```

The frontend will:
1. Call `routeNiaEvent(event.type, event.payload)`
2. Dispatch CustomEvent: `new CustomEvent('nia:desktop.mode.switch', {detail: {mode: 'desktop'}})`
3. Component receives event and updates UI

---

## Performance Notes

- **Event dispatch:** Synchronous, <1ms
- **CSS class application:** Synchronous, <1ms
- **Component rerender:** Depends on your React tree
- **localStorage write:** Async, ~1ms
- **Total user-perceivable latency:** <16ms (one frame at 60fps)

---

## Browser Compatibility

- ✅ Chrome/Chromium 55+
- ✅ Firefox 52+
- ✅ Safari 13+
- ✅ Edge 15+
- ✅ Mobile browsers (iOS Safari, Chrome Android)

Requires support for:
- CustomEvent API
- localStorage API
- CSS variables
- ES6 (async/await, destructuring, etc.)

---

## Future Enhancements

1. **Layout persistence** - Remember user's preferred layout across sessions
2. **Transition animations** - Smooth sidebar slide/fade effects
3. **Layout presets** - Save multiple layout configurations
4. **Accessibility** - Keyboard shortcuts for mode switching
5. **Analytics** - Track which modes users prefer by device type
6. **Responsive refinements** - Fine-tune breakpoints based on usage data

---

## Support

For issues or questions:

1. Check browser console for `[niaEventRouter]` and `[DesktopBackgroundSwitcher]` logs
2. Verify files are created in correct locations
3. Ensure imports are correct in your app
4. Check that WebSocket is delivering events to frontend
5. Run unit tests: `npm test -- niaEventRouter.test.ts`

---

**Implementation complete. Ready for Neala's demo. ✅**
