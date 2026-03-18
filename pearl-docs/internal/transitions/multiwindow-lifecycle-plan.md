# Multiwindow Lifecycle Plan

## Objective

Establish a single window lifecycle pathway so UI interactions, bot-triggered events, and DailyCall automation all open/close ManeuverableWindow views through the same controller. The goal is to keep multiwindow state consistent and guarantee `bot_start_daily_call` launches the call experience exactly like pressing the desktop icon.

## Scope

- `apps/interface/src/components/browser-window.tsx`
- `apps/interface/src/features/ManeuverableWindow/lib/windowLifecycleController.ts`
- `apps/interface/src/components/desktop-background-work.tsx`
- `apps/interface/src/features/DailyCall/components/ClientManager.tsx`
- `apps/interface/src/features/DailyCall/components/DailyCallView.tsx`
- `apps/interface/src/features/DailyCall/components/Call.tsx`
- `apps/interface/src/features/DailyCall/events/appMessageBridge.ts`
- `apps/interface/src/features/DailyCall/events/niaEventRouter.ts`

### Out of Scope

- Server-side Daily bot tooling changes
- New feature flags or permissions
- Visual design adjustments to ManeuverableWindow UI

## Implementation Steps (with checkpoints)

1. **Controller wiring (Checkpoint A)**
   - Extend `browser-window.tsx` to listen for `nia.window.open-request` and `nia.window.close-request` events.
   - Normalize legacy `openDesktopApp` / `closeDesktopApp` flows to funnel through shared helpers (keep compatibility until every caller migrates).
   - Emit structured debug logs that include `source` and `viewType` for future telemetry.

2. **Entry point migration (Checkpoint B)**
   - Replace direct `CustomEvent('openDesktopApp')` dispatchers with `requestWindowOpen` in desktop backgrounds, DailyCall autostart, and any other UI entry points.
   - Swap bot listener re-dispatching (`app.open`, `apps.close`, `browser.close`, `call.start`) to call the controller helpers instead of raising additional DOM events.
   - Ensure every bot view tool (`bot_open_note`, `bot_open_browser`, `bot_open_calculator`, `bot_open_creation_engine`, `bot_start_daily_call`, etc.) funnels through the controller with consistent payloads so the same multiwindow path handles user and bot intents.
   - Ensure Daily call open requests carry room metadata when available so bot-triggered opens behave like manual launches.
   - ✅ BrowserWindow now raises lifecycle requests for content detail clicks, Creation Engine launches, and html generation results so UI + bot flows share the controller path.

3. **Daily lifecycle alignment (Checkpoint C)**
   - Update `DailyCallView` / `Call` cleanup paths to emit `requestWindowClose` with the active window id and reason; remove ad-hoc `removeWindow` couplings.
   - Guarantee `dailyCall.forceClose` hooks call `requestWindowClose` so window state dissolves from the same pathway.
   - Add targeted unit coverage around new routing logic (e.g., `niaEventRouter` listener or controller utilities) or adjust existing tests to validate that `CALL_START` routes into the window controller.

## Testing Strategy

- Run targeted DailyCall suite: `npm run test:js -- --runTestsByPath apps/interface/src/features/DailyCall/__tests__/dailycall-events.test.tsx`
- If browser-window logic covered elsewhere, consider focused test or smoke: `npm run test:js -- --runTestsByPath apps/interface/src/features/DailyCall/__tests__/dailycall-profile-gate.test.tsx`
- Manual verification checklist (time permitting): open/close via icon, via bot command, via DailyCall force close button.

## Risks & Mitigations

- **Event duplication**: Adjust listeners to dedupe requests by window id or active view; add guards during migration.
- **Room context missing for bot**: Validate payload before issuing open, log warning when absent, keep existing behavior as fallback.
- **Regression in notes delegate closure**: Preserve existing options (`allowConfirmation`, `allowNotesDelegate`, `suppressStandaloneReset`) when translating requests.

## Success Criteria

- UI icons, bot commands, and auto-start all invoke DailyCall through `requestWindowOpen`.
- `CALL_START` events reliably surface a `dailyCall` window with a valid room URL when provided.
- Closing DailyCall (user leave, force close, bot command) emits a single `nia.window.close-request` and multiwindow state reflects zero DailyCall instances.
- Existing windows (notes, browser, htmlContent, etc.) continue to open/close without regressions.
