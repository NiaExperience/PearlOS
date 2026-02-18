# Structured Logging Rollout (Interface, Pipecat, packages)

LLM TODO / integration checklist for replacing all `console.log|info|warn|error` with structured logging that injects `sessionId`, `userName`, and `userId`, and prefixes messages with source tags like `[html_tools]`, `[html_prompts]`, `[sharing_tools]`.

## Goals
- Emit structured logs across Interface and Pipecat operator/gateway/runner with a uniform schema.
- Automatically attach correlation fields (`sessionId`, `userName`, `userId`) to every log entry.
- Allow lightweight source preambles (e.g., `[html_tools]`, `[html_prompts]`, `[sharing_tools]`) to aid triage.
- Provide transports suitable for local dev (console pretty) and production (JSON, stdout). Avoid performance regressions.

## Constraints & Guardrails
- No `console.*` in app code after migration; lint rule/ban required.
- For Python paths (pipecat, bots), replace `print` with structured `logging`; add lint check to block `print` in non-test code.
- Logs must be JSON-serializable; redact/avoid PII beyond `userName`/`userId`.
- Minimal overhead on hot paths; avoid excessive stringification.
- Keep feature/module tags simple and consistent; avoid free-form spam.
- Logging call order: string message first, metadata object second. Never pass the metadata object as the first argument.

## Design Outline
- Choose a logger (recommend `pino` for perf + child loggers). Wrap in a small adapter per app for future swaps.
- Context injection:
  - Interface/Dashboard: Next.js middleware + request-scoped store (AsyncLocalStorage) to capture `sessionId`, `userName`, `userId` from auth/session and bind to a per-request child logger.
  - Pipecat runners: wrap job/run entrypoints; pass context into logger factory.
- Logger API: `log.info('message', { event: '...', data, tag: '[html_tools]' })` or helper `logWithTag('[html_tools]').info('message', { event, data })`. Message first, metadata second.
- Output: JSON to stdout in production; pretty transport in dev.
- Tagging: enforce a small enum of tags (e.g., `[html_tools]`, `[html_prompts]`, `[sharing_tools]`, `[auth]`, `[api]`, `[ui]`).

## Implementation Checklist (per app)
- [ ] Add logger package dependency (e.g., `pino`, `pino-pretty` for dev) + types.
- [x] Create `logger/` module:
  - [x] Base logger config (interface server): AsyncLocalStorage-backed JSON stdout with session/user/tag fallback; server sessionId fallback to POD/JOB/HOSTNAME.
  - [x] Helper to create child logger with context payload `{ sessionId, userName, userId, tag }` (server) plus client-safe logger wrapper for browser components.
  - [ ] Dev pretty transport guarded by `NODE_ENV`.
- [ ] Request/job context wiring:
  - [~] Interface: Next.js middleware updated to structured logging; AsyncLocalStorage binding still pending for request context propagation.
  - [ ] Pipecat: pipeline runner wraps each run with context object; propagate to logger factory.
- [ ] API usage pattern:
  - [~] Replace `console.*` with `log.info|warn|error({ event, data }, message)`; include `tag` argument or use `logWithTag(tag)` helper. (Interface server pages/actions migrated: getAssistant, assistant page, providers, share redemption, accept invite; client contexts moved to client logger.)
  - [ ] Python: replace `print` with the logger (structured JSON formatter) and add Ruff/flake rule to forbid `print` outside tests.
  - [ ] Define a small `LogEvent` enum or string union for common events.
- [~] Lint/CI guard: add eslint rule (`no-console`) + allowlist for logger import. (rule added as warn)
- [ ] Tests:
  - [ ] Unit: logger module emits JSON with context + tag.
  - [ ] Middleware: request sets context and logs include session fields.
  - [ ] Pipecat: operator/gateway/runner logs carry provided context.
- [ ] Docs: short usage guide + tag list; add to README/testing doc if needed.

## Migration Plan
- [x] Land logger modules + middleware/context plumbing first (interface server logger + client logger created; middleware still pending).
- [ ] Add lint rule banning `console.*` once replacements are available (can start as warn, then error).
- [~] Incremental replacement by feature: Interface (server pages/actions + client contexts + middleware migrated); Pipecat, packages remain.
- [ ] Final sweep to remove remaining `console.*` and downgrade lint to error.

## BATCH WORKFLOW
- Process one subheading fully; the entire set of files listed under that subheading counts as your working set of files for a batch.
- You will start by creating a working TODO list containing:
  - complete the logging migration for all files in the set
  - run the relevant tests (using the vscode RunTests api), and ensure they pass
  - run the interface build (npm run build -w apps/interface), and ensure no build errors
  - update the plan checklist
  - Instruction to not stop working until all files in the set are done, tests pass, and build passes
- Then you will report progress, and move to the next subheading / batch.

## Interface console removal checklist (apps/interface/src scan 2025-12-19)

Interface app complete.

## Progress 2025-12-20
- Added server-side structured logger (`apps/interface/src/lib/logger.ts`) and client-safe logger wrapper (`apps/interface/src/lib/client-logger.ts`).
- Migrated interface server usage: `getAssistant`, assistant page, providers, share redemption, accept invite.
- Migrated client contexts to client logger: `ui-context`, `voice-session-context` (Daily Call visibility/suspension flow), `InitializeDesktopMode`.
- `useVoiceSession` now defaults user identity to authenticated session via `useSession`; bot/join payloads and logging carry session-derived `userId/userName/userEmail` without callers passing props.
- Middleware now uses structured logging (edge-safe); still need ALS binding for request context.
- Added `no-console` lint rule (warn) to start enforcing structured logging; interface build passes after migrating Daily libs to client/server loggers.
- HtmlGeneration batch complete: normalized structured logging to message-first signature across actions, components, hooks, libs, and routes; Codacy/Trivy scans on touched files returned clean; `npm run build -w apps/interface` succeeded (existing Next.js/Tailwind warnings acknowledged).
- Added explicit guidance on log call ordering (message string first, metadata second) to prevent meta-first regressions.
- Notes batch complete: converted `notes-view.tsx`, `pdf-processor.ts`, refreshed docs/examples to structured logging, and verified no remaining console usage; interface build passes.
- Completed YouTube/Gmail/Wikipedia/Invite/Soundtrack/ResourceSharing batch with structured logging and plan update.
- Completed docs/tests/examples batch (HtmlGeneration docs/examples and BrowserAutomation tests): replaced `console.*` with structured logging patterns and updated docs/examples accordingly.
- Tests: `apps/interface/src/features/HtmlGeneration/__tests__/context-management.test.ts`, `providers-prompt-interpolation.test.ts`, `BrowserAutomation/__tests__/realbrowser-integration.test.ts` passing.
- Build: `npm run build -w apps/interface` succeeded (Next.js experimental option warning + tailwind duration class ambiguity remain informational).
- Remaining: middleware context injection (ALS), escalate `no-console` to error, Pipecat migration + Python logging + Ruff rule, dev pretty transport, packages migration (features, events, prism).
- Prism batch 1 (packages/prism): added shared `core/logger` (ALS-aware, safe for browser builds) and migrated `core/audit/logger`, `core/routes/functionalPrompt/route.ts`, Gmail services (`gmail-auth-recovery.service.ts`, `gmail-api.service.ts`, `google-token-refresh.ts`) to structured logging with `prism:*` tags; prism tests (`packages/prism/__tests__`) pass and `npm run build -w apps/interface` passes (existing Next.js/Tailwind warnings remain informational).
- Prism batch 2 (Google auth/incremental): migrated authOptions, middleware, getSessionSafely, incremental auth service/hooks/components, Google routes (incremental-scope, callback, refresh-token), and permissions page to structured logging with `prism:auth:incremental` tag; prism build passes and auth tests (`auth-middleware`, `google-auth-pages`) pass.
- Prism batch 3 (email + reset-token scheduler): migrated email module and prune scheduler to `prism:email` logger (SES transport, fallback, token issuance) and replaced console usage; prism build passes.
- Prism batch 4 (content routes): migrated content detail/list routes to `prism:routes:content` logger and removed remaining console.*; `api-routes-import.test.ts` passes; interface build still blocked on Edge runtime dynamic-code evaluation in `packages/prism/src/core/logger.ts` (middleware import).
- Prism batch 5 (core actions + env loader): migrated env-loader plus core actions (`anonymous-user`, `account`, `tools`, `globalSettings`) to structured logging with `prism:*` tags; `api-routes-import.test.ts` passes; interface build remains blocked by Edge runtime dynamic-code evaluation in `packages/prism/src/core/logger.ts` (middleware import).
- Prism batch 6 (assistant + user profile + auth utils): migrated `assistant-actions.ts`, `userProfile-actions.ts`, `oauth/session-token-helper.ts`, `auth/authOptions.ts`, and `core/utils/encryption.ts` to structured logging with `prism:*` tags; `api-routes-import.test.ts` passes; `npm run build -w apps/interface` succeeds (existing Next.js/Tailwind warnings remain informational).
- Prism batch 7 (dynamic content components + platform utils): migrated `DynamicContentDetailView.tsx`, `DynamicContentListView.tsx`, `ui/content-card.tsx`, `ui/utils.ts`, `core/utils.ts`, `core/content/utils.ts`, `core/utils/platform-definitions.ts`, `components/auth/auth-provider-client.tsx`, and `ui/next-auth-config.ts` to structured logging with `prism:*` tags; `api-routes-import.test.ts` passes; `npm run build -w apps/interface` succeeds (existing Next.js/Tailwind warnings remain informational).
- Features package batch: added shared logger, migrated `featurePrompts` and `scripts/codegen.ts`, and converted `examples/bot-tools-usage.ts` to structured logging; applet examples/templates intentionally left unchanged per guidance; Codacy scans clean on touched files; `npm run test:js -- --runTestsByPath packages/prism/__tests__/api-routes-import.test.ts` and `npm run build -w apps/interface` succeed (existing Next.js/Tailwind warnings remain informational).
- Pipecat Daily Bot batch 1: replaced `print` statements with module-level loguru loggers in `scripts/generate_tool_manifest.py` and `inspect_transport.py`, binding per-module context; Codacy checks clean on both scripts; no additional tests run for this batch.
- Pipecat Daily Bot batch 2 (HTML tools): migrated `apps/pipecat-daily-bot/bot/tools/html/{crud.py,navigation.py,utils.py,prompts.py}` to structured logging using `bind_tool_logger`/`bind_context_logger`, binding resolved `userId`/`tenantId`/`roomUrl` where available; `loguru` imports removed; no new tests added; pending: run Codacy scan on touched files.
- Pipecat Daily Bot batch 3 (session core): updated in-repo loguru shim to emit bound context via log record extras, bound session loggers with tags/botPid in `session/{identity,participants,participant_data,managers}.py`, converted logs to message-first `%` formatting, and re-ran interface build (passes; existing Next.js/Tailwind warnings remain). Codacy CLI now reports only pre-existing complexity warnings in these modules.
- Local logs batch 1: bound AsyncLocalStorage context for HtmlGeneration GET/POST routes from session data so server logs emit `sessionId`/`userId`/`userName`; expanded `scripts/get-logs.sh --local` to capture pods across namespaces (pipecat) and namespace-prefix output files; ran `npm run test:js -- --runTestsByPath apps/interface/src/features/HtmlGeneration/__tests__/context-management.test.ts` and `npm run build -w apps/interface` (build succeeds with existing Next.js/Tailwind warnings).
- Tiltfile now reads pipecat local `.env` (`apps/pipecat-daily-bot/.env[.local]`) for bot configs/secrets to mirror `npm run dev` parity.
- Pipecat Daily Bot batch 4 (sessionId propagation): runner_main now seeds `BOT_SESSION_ID`/user env vars from the gateway-provided sessionId and warns when generating a fallback so keepalives and downstream logs stay aligned.
- Space-war template: Robo saucer now renders as a round dish (using the smaller ellipse radius) to match the requested profile; interface build verified.
- Space-war template: added guards around asteroid data (validate coordinates/vertices) to prevent undefined `x` crashes reported in the applet runtime; interface build re-run.

## Out of scope
- Mesh, Dashboard, chorus-tts, tests, examples, applet templates

## Open Questions
- What is the authoritative source of `sessionId` for unauthenticated flows? Fallback? Generate? → Answer: if no client session is present, use server context identifiers such as pod name (K8s), job ID, or hostname as `sessionId` surrogate; set `userId`/`userName` to `null` and tag as `server`.
- Should `userName`/`userId` be omitted/redacted for anonymous users? → Answer: emit `null` when unavailable; never synthesize PII.
- Do we need log shipping (e.g., to CloudWatch/ELK) or only stdout for collectors? → Answer: stdout is already ingested into CloudWatch; keep JSON stdout as primary transport.
- Acceptable tag set and enforcement mechanism? → Answer: keep a small, documented local list (e.g., `Notes`, `HtmlGeneration`, `DailyCall`, `Auth`, `API`, `UI`, `html_tools`, `html_prompts`, `sharing_tools`) but no strict enum enforcement; helpers can optionally default a tag per feature.
