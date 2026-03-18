# DailyCall Dev Room Refresh Plan

## Objective

Ensure the development DailyCall room is recreated on demand so that each developer session starts from a clean, private room created with the latest defaults.

## Scope

- Update `apps/interface/src/features/DailyCall/lib/config.ts` to destroy any existing dev room and recreate it with the desired privacy/settings when running in development.
- Expose helpers that let us request a meeting token and destroy dev rooms from both server routes and client-side clean up flows.
- Add unit coverage that verifies room creation and recreation flows, including error handling for failed Daily API calls.
- Add a lightweight API surface for DailyCall-specific meeting token retrieval and dev-room teardown without impacting production paths.

## Success Criteria

- Calling `getDailyRoomUrl()` in development deletes the hostname-scoped room (if present) and recreates it before returning the new URL.
- Subsequent calls reuse the cached URL only after a successful refresh.
- Test suite covers: room creation, recreation on existing room, missing API key handling.

## Proposed Tests

- `apps/interface/src/features/DailyCall/lib/__tests__/config.test.ts` (new):
  - Recreates room when Daily reports it exists (GET → DELETE → POST).
  - Creates room when Daily reports it missing (GET 404 → POST).
  - Returns empty string and skips network calls when `DAILY_API_KEY` is unset.
- `apps/interface/src/features/DailyCall/lib/__tests__/tokenClient.test.ts` (new):
  - Caches meeting tokens per room and surfaces fetch failures.
- `apps/interface/src/features/DailyCall/routes/__tests__/devRoomImpl.test.ts` (new):
  - Destroys dev rooms only in development and handles Daily API failures gracefully.

## Risks & Mitigations

- **Daily API failures**: Log warnings and return empty string to avoid crashing the UI; keep cache unset so the next call can retry.
- **Environment pollution in tests**: Reset `process.env`, `global.fetch`, and module cache between tests.
- **Accidental production impact**: Guard logic behind `process.env.NODE_ENV === 'development'` and keep production path untouched.
- **Token route abuse**: Require authenticated session and limit dev-room destruction to hostname-scoped rooms.

## Checkpoints

1. Implement destroy/recreate logic and improved caching in `config.ts`.
2. Add token + dev-room routes with accompanying client helpers and Jest coverage.
3. Update join flow to fetch meeting tokens and delete dev rooms on leave, then run lint/tests (targeted) and Codacy analysis for edited files.
