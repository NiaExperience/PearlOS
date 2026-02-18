# Structured Logging Local Logs Plan

## Objective
Validate and fix structured logging gaps for local runs: ensure `sessionId`/`userId`/`userName` propagate into interface logs and restore pipecat log visibility when using `./scripts/get-logs.sh --local`.

## Scope
- Investigate interface structured logging context on local/stg logs (missing session context).
- Investigate absence of pipecat logs from `./scripts/get-logs.sh --local -t <duration>`.
- Apply minimal code/config changes limited to the files involved in context propagation or log collection scripts.
- Update structured logging plan checklist for this batch.

Out of scope: broader feature work, new event topics, unrelated refactors.

## Files/Areas to Inspect
- `apps/interface/src/lib/logger.ts`, `client-logger.ts`, middleware and providers (context binding).
- `apps/interface/src/app/**/middleware.ts` or edge logger wiring.
- `apps/interface/src/providers/client-providers.tsx` and related session context sources.
- `scripts/get-logs.sh` and supporting log paths under `/private/tmp/kube/logs/local`.
- Pipecat components/loggers if collection gap is due to path names.

## Test/Verification Strategy
- Review local log files for presence of `sessionId`/`userId` in entries after fixes.
- Run targeted tests if code paths change (use `npm run test:js -- --runTestsByPath <file>` as needed).
- Run `npm run build -w apps/interface` after code changes.

## Risks
- Edge/middleware runtime constraints may limit AsyncLocalStorage; changes could affect performance.
- Log collection script changes could impact other environments.
- Limited visibility into pod environment may slow verification.

## Success Criteria
- Local interface logs show `sessionId`/`userId` populated where session is available.
- `./scripts/get-logs.sh --local` returns pipecat log content for the duration specified.
- Build/test checks pass for touched areas.
- Structured logging plan checklist updated to reflect batch progress.

## Next Batch: Pipecat SessionId Propagation
**Objective**
- Ensure caller-provided `sessionId` travels through gateway → Redis queue/locks → operator → runner and appears in logs/locks/env for cold and warm dispatch paths.

**Scope**
- Update gateway join handling to require and bind `sessionId` (with safe fallback) and push into queued payload.
- Ensure Redis `room_active` locks, keepalive payloads, and warm-pool dispatch metadata include the provided `sessionId`.
- Propagate `sessionId` into cold job env (`BOT_SESSION_ID`) and warm runner start payload; runner should use incoming `sessionId` instead of generating a new one for logging and lifecycle keys.
- Keep changes limited to `apps/pipecat-daily-bot/bot/{bot_gateway.py,bot_operator.py,runner_main.py}` and minimal shared helpers if needed.

**Out of Scope**
- New event topics or telemetry sinks; non-session fields; mesh/dashboard changes.

**Test/Verification Strategy**
- Add/extend runner tests to assert `/start` respects incoming `sessionId` (session registry and response echo).
- If feasible, add operator/gateway unit smoke to confirm queued payload preserves `sessionId` and that `_mark_room_active` writes it.
- Manual/log verification: run local bot join (Redis enabled) and inspect `room_active:*` keys and runner logs for `sessionId` match.

**Risks**
- Warm pool: collisions if two callers reuse same `sessionId`; ensure we only override when provided, otherwise fallback to generated ID.
- Lock/keepalive schema drift: ensure added field remains JSON-serializable and does not break existing readers.
- Env propagation for cold jobs must avoid leaking null/empty values; guard before setting.

**Success Criteria**
- Provided `sessionId` appears in gateway/operator logs, Redis `room_active` value, keepalive payload, and runner logs/session registry.
- Cold job env includes `BOT_SESSION_ID` only when provided; warm dispatch preserves `sessionId` in response.
- Tests covering runner propagation pass; no regressions in existing pipecat tests; build remains green for touched areas.
