# Plan: Redis-backed HTML Generation Resume

## Objective
Restore resume-on-load for HTML generation by sourcing active jobs from Redis (not just localStorage) while failing gracefully when Redis or auth is unavailable.

## Scope
- Add an API surface to return the current user’s active HTML generation callIds from Redis (and, if available, in-memory cache) with safe fallbacks.
- Update interface boot/resume logic to fetch that list, merge/dedupe with localStorage, and restart status polling without double requests.
- Handle Redis-unavailable or empty responses without user-facing errors.

## Out of Scope
- Changing generation pipelines or status persistence semantics beyond listing/rehydration.
- UI redesign of status/loading elements.

## Files to Touch
- `apps/interface/src/features/HtmlGeneration/routes/status/route.ts` (server: expose user jobs list helper/endpoint)
- `apps/interface/src/app/api/html-generation/status/route.ts` (wire any new handler exports)
- `apps/interface/src/components/browser-window.tsx` and/or `apps/interface/src/features/HtmlGeneration/components/GlobalHtmlGenerationStatus.tsx` (client resume + polling)
- Tests under `apps/interface/src/features/HtmlGeneration/__tests__/`

## Tests
- Add/extend Jest tests for the new list-active-jobs API behavior (happy path + Redis unavailable).
- Targeted client-level test if feasible (state hydration); otherwise rely on API test + manual QA notes.

## Risks & Mitigations
- Redis down -> ensure endpoint returns empty list with 200 and client logs warning only.
- Duplicate polling -> dedupe callIds and guard against double registration.
- Unauthorized access -> reuse existing auth/session guard; return 401 cleanly.

## Success Criteria
- On reload, active HTML generation resumes even when localStorage was cleared but Redis has jobs.
- No crashes when Redis is disabled/misconfigured.
- Tests cover the new API path and failure handling.
