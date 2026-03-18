# Admin Stealth Mode for DailyCall (Feature Doc)

Owner: Engineering

Date: 2025-09-29

Status: Implemented (staging-stealth-mode branch)

Target Branch: staging

## Objective

Allow tenant administrators to join a DailyCall room in a “stealth mode” to observe sessions without being visible to other participants or the Pipecat bot. Support both manual PreJoin and auto-join workflows with a clear, deterministic UX.

## Summary of Behavior

- Admins see a “Stealth Mode” option on PreJoin.
- When auto-join is enabled, admins get an in-app modal prompt with Yes / No / Cancel. Cancel closes the view and returns to the assistant session (no join occurs and no leave is sent).
- Stealth join disables local audio/video, hides the local tile, and decorates the Daily userData with `stealth: true` so the bot can ignore this user.
- The legacy bot still joins the room to monitor session health, but when in stealth the interface omits identity fields from the legacy join payload so the bot cannot attribute or infer any stealth presence.
- The bot runtime treats stealth participants as invisible in all events, rosters, snapshots, and greetings.

## UX & Flows

### Manual PreJoin (BOT_AUTO_JOIN = false)

- If `isAdmin` is true:
  - Show a checkbox labeled “Join in Stealth Mode” (default unchecked).
  - On Join:
    - If checked → join in stealth (A/V off, hidden tile; stealth flag in userData).
    - If unchecked → normal join.
- If `isAdmin` is false: no checkbox.

### Auto-Join (BOT_AUTO_JOIN = true)

- If `isAdmin` is true and user is not yet joined:
  - Show modal: “Join in Stealth Mode?” with Yes / No / Cancel.
    - Yes → enable stealth and proceed with join.
    - No → disable stealth and proceed with join.
    - Cancel → do not join; close the view and return to the assistant session. Importantly, no `/api/bot/leave` call is made in this path.
- If `isAdmin` is false: no modal; proceed with standard auto-join.

### Stealth Behavior During Call

- Do not publish local audio/video (start muted; enforce muted after join).
- Hide the local participant tile in the UI.
- Annotate Daily local participant via `userData.stealth = true`.
- Bot still joins (legacy mode) to monitor the room, but:
  - Identity fields (userId, email, name) are omitted from `/api/bot/join` when in stealth.
  - Bot participants/events/snapshots explicitly filter out any `stealth` users.

## Implementation Details

### Interface (Next.js app: apps/interface)

- `PreJoin.tsx`
  - Props: `stealth?: boolean`, `onStealthChange?: (next: boolean) => void`.
  - Renders admin-only stealth checkbox bound to the above props.

- `DailyCallView.tsx`
  - State: `stealthEnabled`, persistent across un/mount for the same room.
  - Auto-join modal: rendered for admins when `BOT_AUTO_JOIN` is enabled and not yet joined; choices gate auto-join flow.
  - Cancel behavior: closes the view by invoking `onLeave()` without calling `endCall()` or the leave endpoint.
  - `handlePreJoin` always triggers legacy bot join in legacy mode—but in stealth omits identity fields from `/api/bot/join` payload.
  - A/V control: joins with `startAudioOff`/`startVideoOff` and enforces local audio/video off when stealth; hides local tile via prop to `Call`.

- `Call.tsx`
  - Accepts `stealth` prop; joins with A/V off, hides local tile, and sets `userData.stealth`.

- `config.ts`
  - `BOT_AUTO_JOIN` derivation as before.

- `botLegacyClient.ts`
  - `/api/bot/join` proxy client supports optional identity fields; interface omits these when stealth.

- Close flow
  - `browser-window.tsx` wires `onLeave` to close the view and reset window UI state. Cancel path uses this directly (no bot leave request).

### Bot (Python Pipecat app: apps/pipecat-daily-bot)

- `participants.py`
  - Reads `userData.stealth` and stores boolean in participant metadata.

- `bot.py`
  - Filters out stealth users from first-join, join/leave announcements, snapshots, heartbeats, and any participant lists. Active participants exclude stealth users.

- `app_message_forwarder.py`
  - No exposure of stealth users. Existing envelopes remain, minus any stealth references.

- Tests
  - Added pytest coverage for stealth parsing (boolean and string forms) and filtering behavior.

## Instrumentation

Representative `logConn` phases:

- `prejoin.stealth.on|off`
- `prejoin.autojoin.prompt.open|yes|no|cancel`
- `prejoin.username.autoset` / `prejoin.join.click`
- `bot.legacy.join.attempt(.autojoin)` / `.success.(fresh|reused)` / `.error`
- `bot.legacy.join.payload` (diagnostic only; no PII in stealth)
- Leave/destroy phases for call lifecycle; cancel path logs prompt.cancel and does not call leave.

## Acceptance Criteria

- Admin-only stealth checkbox on PreJoin; hidden for non-admins.
- Auto-join admin modal appears and gates joining; Yes/No/Cancel work as specified.
- Stealth join: no local A/V published; local tile hidden; `userData.stealth=true` set.
- Legacy bot still joins session; in stealth, identity fields are omitted so the bot cannot attribute the stealth user.
- Bot runtime excludes stealth users from events, rosters, and snapshots.
- Cancel closes the view with no `/api/bot/leave` call.

## Tests

- Interface unit/component tests cover:
  - Admin-only checkbox visibility and toggle.
  - Auto-join modal gating behavior and cancel close behavior.
  - Legacy join payload omission of identity fields when stealth.
- Bot tests cover:
  - Stealth parsing from userData and consistent filtering from all outward-facing paths.

## Risks & Notes

- Platform invisibility limits may exist in Daily; we enforce UI and A/V invisibility and ensure bot ignorance. Evaluate deeper platform options separately.
- Prevented races between auto-join and modal by gating auto-join until a choice is made.

## Follow-ups

- Explore Daily-side listen-only/hidden roles for true invisibility.
- Persist per-user stealth preference.
- Optional override: `NEXT_PUBLIC_BOT_JOIN_ON_STEALTH` to change the always-join behavior.
