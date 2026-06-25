# Enterprise Phase 0 Production Drift Reconciliation - 2026-06-04

This note continues the restore-first gate documented in:

```text
docs/staging-handoff/ENTERPRISE_PHASE0_PREFLIGHT_STATUS_2026-06-04.md
```

## Result

No production-only application hotfix was found that should be backported into
staging source before Phase 0 planning.

A non-destructive production drift snapshot was created under:

```text
refs/pearlos-backups/pre-enterprise-prod-drift-20260604
```

The snapshot was built with a temporary Git index. It preserves the current
production tracked drift plus the untracked OpenClaw sanitizer file without
moving production HEAD, changing the working tree, cleaning files, or restarting
services.

The inspected production drift falls into these buckets:

- already present in staging source
- production is behind staging source
- generated/runtime build state
- production scratch files
- production-only runtime patch behavior that is unsafe for enterprise
  multitenancy and should not be ported as source

Production is still not clean. It is backed up and restorable, but cleaning or
moving production branch state should remain a separate explicit operation.

## Files Already Matching Staging Source

These production changed files matched current staging source byte-for-byte at
the time of reconciliation:

```text
apps/interface/next.config.mjs
apps/interface/src/app/api/chat/route.ts
apps/interface/src/app/api/creation/[id]/[...path]/route.ts
apps/interface/src/app/api/launchpad/create-project/route.ts
apps/interface/src/app/api/launchpad/lib/creation-artifacts.ts
apps/interface/src/app/api/notes/files/route.ts
apps/interface/src/app/api/tools/invoke/route.ts
apps/interface/src/components/PersistentNavButtons.tsx
apps/interface/src/features/ChatMode/lib/__tests__/chat-tool-idempotency.test.ts
apps/interface/src/features/ChatMode/lib/chat-tool-idempotency.ts
apps/interface/src/features/DailyCall/hooks/useGatewaySocket.ts
apps/interface/src/features/DailyCall/lib/__tests__/gateway-event-scope.test.ts
apps/interface/src/features/DailyCall/lib/gateway-event-scope.ts
apps/interface/src/lib/client-providers.tsx
apps/pipecat-daily-bot/bot/auth.py
apps/pipecat-daily-bot/bot/tests/test_gateway_ws_event_isolation.py
apps/pipecat-daily-bot/bot/tests/test_tasks_multitenancy.py
apps/pipecat-daily-bot/bot/tools/onboarding_tools.py
```

## Production Behind Staging Source

These files differed, but inspection showed staging source is newer and should
be kept as the canonical version:

```text
apps/interface/src/app/api/discord/channels/route.ts
apps/interface/src/app/api/discord/messages/route.ts
apps/interface/src/app/api/launchpad/agency-start/route.ts
apps/interface/src/app/api/launchpad/lib/build-task-prompt.ts
apps/interface/src/app/api/launchpad/lib/store.ts
apps/interface/src/app/api/launchpad/projects/[id]/route.ts
apps/interface/src/app/api/launchpad/projects/route.ts
apps/interface/src/features/ChatMode/hooks/useChatSession.ts
apps/interface/src/features/ChatMode/lib/chat-tool-handlers.ts
apps/interface/src/features/ChatMode/lib/sanitize-assistant-text.ts
apps/pipecat-daily-bot/bot/api/tasks_api.py
apps/pipecat-daily-bot/bot/bot_gateway.py
apps/pipecat-daily-bot/bot/core/prompts.py
apps/pipecat-daily-bot/bot/pearl/bot_tools.py
apps/pipecat-daily-bot/bot/pipeline/builder.py
openclaw-runtime-patches/discord-outbound-sanitizer.mjs
openclaw-runtime-patches/telegram-preallowlist-loader.mjs
openclaw-runtime-patches/telegram-preallowlist-register.mjs
```

Important examples:

- Launchpad source has stricter requester/tenant ownership checks, shorter
  build timeboxes, PEARLOS output support, and output directory preparation.
- Chat source has public profile tool support and text-body tool result
  handling that production lacks.
- Pipecat source has request rate-limit hooks, task execution metadata,
  authenticated profile context, per-user chat logs, QA release gate prompting,
  and voice profile/memory parity that production lacks.
- OpenClaw patch source has broader Discord sanitizer compatibility, memory-core
  plugin compatibility, Discord agency routing, and live search wiring that
  production lacks.

## Production-Only Drift Not Backported

Production `bot_gateway.py` contains fallback behavior that selects an arbitrary
running Daily room or forwarder when no explicit room context is present.

That behavior is useful as an emergency delivery workaround, but it is unsafe
for enterprise multitenancy because it can route tool events across active
sessions. It should not be backported into staging source. Phase 0 should instead
replace this class of fallback with authenticated tenant/session-scoped event
routing.

Production also contains scratch/untracked files:

```text
abc.txt
list5282200
openclaw-runtime-patches/discord-outbound-sanitizer.mjs
```

The sanitizer file exists in staging source, but production treats it as
untracked drift. Do not infer that the production index is safe from the presence
of that file alone.

## Generated Or Runtime State

The following production drift should be treated as generated/runtime state
unless a later audit proves otherwise:

```text
apps/interface/src/build-info.json
apps/interface/src/build-stamp.ts
packages/features/generated/bot-tools-manifest.json
```

`apps/interface/src/build-info.json` still has an unresolved index entry on
production. The working file reflects the live production build metadata, but
the index must not be resolved blindly.

## Gate Decision

The restore gate is good enough for staged Phase 0 planning and source-only
implementation: staging source is committed, production backups are verified,
and production drift has a dedicated restore ref while production remains dirty.

The gate is not good enough for production cleanup or deployment. Before any
production release, perform a separate prod cleanup decision:

1. preserve the existing production backup
2. decide whether to discard, commit, or restage each production drift bucket
3. resolve the production build-info index entry intentionally
4. run the production preflight audit
5. only then promote reviewed source to production
