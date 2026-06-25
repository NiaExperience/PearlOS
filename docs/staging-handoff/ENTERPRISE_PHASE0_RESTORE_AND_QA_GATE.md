# Enterprise Phase 0 Restore And QA Gate

Last updated: 2026-06-04.

Read with:

```text
docs/PEARLOS_ENTERPRISE_PUBLIC_PEARL_PLAN.md
docs/PEARLOS_MULTITENANCY_PLAN_ADVERSARIAL_REVIEW.md
docs/production-release-workflow.md
docs/staging-handoff/CODEX_DO_OPERATIONS.md
docs/qa/BUILD_RELEASE_WORKFLOW.md
```

## Current Gate Status

Code changes for enterprise Phase 0 must not begin until the restore gate is
green or Blair explicitly authorizes staging-only work despite the production
access gap.

Current evidence:

- Staging source has a clean checkpoint commit recorded in the preflight backup
  metadata.
- Staging source and deploy trees have non-destructive backup artifacts.
- Staging and production live health endpoints were captured in the backup
  metadata.
- Production SSH verification and production backup are not proven from the
  staging session. The production host alias did not resolve, and direct SSH to
  the documented production IP rejected the available key.
- Direct OpenRouter advisory calls using stale env-file credentials failed, but
  runtime service credentials produced usable Gemini and Kimi reviews. Claude
  CLI also produced a source-grounded read-only review.

Do not claim production is committed, backed up, or release-ready until a
current production SSH or provider snapshot check proves it.

## Restore Artifacts

The preflight backup directory contains:

- source and deploy git status snapshots
- source and deploy binary diffs for tracked drift
- source and deploy code tarballs excluding runtime/generated paths
- selected runtime data snapshots
- Redis and local DB snapshots when available
- safe PM2 process metadata
- env-file backup tar with restricted file permissions
- checkpoint patch and git bundle for the source checkpoint commit
- external review outputs from Claude CLI, Kimi, and Gemini where available

This is a staging-local restore set. It is not a substitute for a DigitalOcean
production snapshot.

## Phase Order

1. Central tenant resolver and role guard
   - Add one shared interface helper that resolves an authenticated actor and
     tenant membership before any gateway call or data-layer action.
   - No route may trust caller-supplied tenant scope without membership and role
     proof.
   - First routes: chat, tools invoke, webhooks, tasks, notifications,
     shared-with-me, sharing, bot config, and bot admin.

2. Private memory isolation
   - Remove global private-memory loading from web, voice, and relay paths.
   - Preserve scoped user memory code paths.
   - Do not add a compatibility shim that keeps global private reads alive.

3. Voice identity parity
   - Canonical authenticated profile wins over stale body, launch, or session
     names.
   - The Blair and Stephanie sentinel must pass in web and voice.
   - Simultaneous tenant voice rooms must prove prompt, memory, tool, and event
     separation.

4. Webhook and realtime lockdown
   - Webhook management requires tenant admin or owner authority.
   - Webhook secrets are write-only in API responses.
   - Outbound delivery uses an SSRF-safe URL policy.
   - Realtime event streams require authenticated, tenant-scoped session claims.

5. Abuse and cost controls
   - Rate limits must be keyed on verified actor context, not spoofable headers.
   - Limits must include user, tenant, and surface dimensions.
   - Hard tenant cost budgets must block expensive LLM/tool calls before side
     effects.

## Required QA Evidence

Automated tests must prove:

- Tenant A user receives 403 when attempting Tenant B on chat, tools, webhooks,
  tasks, notifications, shared-with-me, sharing, bot config, and bot admin.
- Denied requests do not call the gateway, write data, deliver webhooks, create
  tasks, or invoke tools.
- Webhook create/list/update responses do not return full webhook secrets.
- Internal, loopback, link-local, and redirect-to-internal webhook URLs are
  rejected.
- Non-owner web and voice contexts cannot load or write root private memory.
- Voice identity ignores stale names when canonical authenticated profile data
  exists.
- Two simultaneous tenant voice rooms do not share prompts, memory writes,
  gateway events, or tool results.
- Unauthenticated or wrong-tenant realtime event subscriptions receive no scoped
  events.
- Rate limits and cost budgets survive process boundaries and cannot be bypassed
  by spoofing actor headers.

Manual acceptance before production:

- Blair profile reads correctly in both voice and web.
- The stale Stephanie identity bug cannot reproduce.
- Public context can use only public profile data.
- Private memory appears only in the authenticated private scope.
- Two test tenants can invite Pearl and receive different scoped behavior.

## Multi-Agent Review Roles

Use separate passes for:

- Codex implementation verification against live source.
- Claude CLI source-grounded architecture/security review.
- Kimi adversarial bypass and stop/go review through OpenRouter.
- Gemini QA methodology and security evidence review through OpenRouter.

Treat model advisory output as useful critique, not proof. Runtime evidence and
tests are the release gate.

## Production Rule

Production remains a deploy target, not a development workspace. Before any
production release candidate:

```bash
cd /workspace/nia-universal
scripts/prod-preflight-audit.sh
```

Then follow `docs/production-release-workflow.md`. Never promote runtime files,
logs, generated data, local backups, or audit captures.
