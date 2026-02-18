# Pipecat Bot Structured Logging Plan

## Objective
Add structured logging context (sessionId, userId, userName when available) to pipecat bot server components (gateway, runner, operator) so logs can be correlated per session/user.

## Scope
- Touch only server-side bot code under `apps/pipecat-daily-bot/bot/` (gateway, runner, operator).
- No client/UI changes. No non-server paths.
- No new dependencies. No tests added (logging-only change).

## Files (anticipated)
- `apps/pipecat-daily-bot/bot/bot_gateway.py`
- `apps/pipecat-daily-bot/bot/runner_main.py`
- `apps/pipecat-daily-bot/bot/bot_operator.py`

## Approach
- Bind `loguru` logger with session/user context per request/job/session to ensure downstream log lines carry fields.
- Prefer localized `logger.bind(...)` instances (e.g., `req_logger`, `session_logger`, `job_logger`) to avoid global side effects.
- Reuse existing payload fields: `sessionId`, `sessionUserId`, `sessionUserName`, `room_url`.

## Tests
- Skipped (logging-only change, no functional behavior change expected). Note in summary.

## Risks / Mitigations
- Missing context fields in some code paths → defensively pull from payload with defaults.
- Potential oversight of log statements outside new bound logger scope → focus on join/start/dispatch paths; keep base logger for other areas.
- No functional regression expected; monitor for log flooding if contexts overbind.

## Checkpoints
1) Gateway logging context added.
2) Runner session logging context added.
3) Operator job logging context added.
