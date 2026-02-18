# Bug: Video Meet stuck on "Connecting…" forever

## Symptom
Clicking the Video Meet desktop icon opens the window but it just shows "Connecting…" and never loads.

## Root Cause
Two-layer failure in Daily room URL resolution:

### Layer 1: Client-side `getDailyRoomUrl()` call fails silently
`browser-window.tsx` (line ~260) calls `getDailyRoomUrl()` from `features/DailyCall/lib/config.ts`. This function:
- Checks `DAILY_API_KEY` — but this env var is server-only (not `NEXT_PUBLIC_`), so it's `undefined` in the browser
- `getDevRoomUrl()` returns `''` immediately when there's no API key
- Result: `dailyRoomUrl` stays empty, passed as empty string to `DailyCallViewComponent`

### Layer 2: DailyCallView devRoom fetch returns 401
`DailyCallView.tsx` (line ~176) tries `fetch('/api/dailyCall/devRoom')` as a fallback when `roomUrl` is empty. This endpoint requires `session?.user?.id` (NextAuth session). If the browser doesn't have a valid session cookie (common in dev/RunPod proxy), it returns `{ error: 'unauthorized' }` and `roomUrl` stays empty.

### Result
With `roomUrl` empty, the auto-join effect (line ~515) never fires because of the `if (!roomUrl) return;` guard. The component sits in the prejoin state showing "Connecting…" forever.

## Fix Options

### Option A: Fetch room URL via API (preferred)
Replace the direct `getDailyRoomUrl()` call in `browser-window.tsx` with a fetch to `/api/dailyCall/devRoom` (or a new unauthenticated endpoint). This keeps server-only code server-side.

### Option B: Add `NEXT_PUBLIC_DAILY_ROOM_URL` env var
Set `NEXT_PUBLIC_DAILY_ROOM_URL` in `.env.local` so the client can resolve it directly. Quick fix, but ties room URL to build/env config.

### Option C: Make the devRoom API endpoint work without auth (dev mode only)
In `devRoomImpl.ts`, skip the auth check when `NODE_ENV === 'development'`. This lets the fallback fetch in DailyCallView succeed.

## Files Involved
- `apps/interface/src/components/browser-window.tsx` — line ~260, client-side getDailyRoomUrl() call
- `apps/interface/src/features/DailyCall/lib/config.ts` — getDailyRoomUrl/getDevRoomUrl (server-only functions used client-side)
- `apps/interface/src/features/DailyCall/components/DailyCallView.tsx` — lines 176, 515 (devRoom fetch + auto-join guard)
- `apps/interface/src/features/DailyCall/routes/devRoomImpl.ts` — auth gate blocking dev room creation
