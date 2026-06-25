# PearlOS Enterprise Public Pearl Plan

**Status:** Canonical execution plan for public Pearl, enterprise multitenancy, and governed customization.
**Date:** 2026-06-04
**Read with:** `AGENTS.md`, `PEARL.md`, `docs/production-release-workflow.md`, `docs/staging-handoff/CODEX_DO_OPERATIONS.md`, `docs/PEARLOS_MULTITENANCY_PLAN_ADVERSARIAL_REVIEW.md`, and `docs/PEARLOS_MULTITENANCY_PHASED_PLAN.md`.

This document is the durable handoff for the work Blair requested after the public Pearl voice/profile incident where Pearl called Blair "Stephanie." It merges the enterprise/public-Pearl product direction with the adversarial review of the older multitenancy phased plan.

## Executive Summary

Public Pearl can become the universal PearlOS persona that companies "hire" into Slack, Discord, Google Chat, Telegram, SMS, voice, and web. She can recognize people from PearlOS public profiles, introduce people using public-only profile data, and operate inside each company sandbox like a trusted employee.

That vision is blocked until isolation is real. The immediate prod gate is not a broad platform rewrite; it is a hard security gate that prevents caller-supplied tenant IDs, global private memory, unscoped voice/web context, webhook leakage, and unbounded tool/LLM cost. The older phased plan has useful architecture, but its diagnosis is stale. Opus's adversarial review is the correction layer: Phase 0 starts with live tenant authorization holes.

The customization model is "WordPress-like" in user experience, but not arbitrary live core edits. PearlOS core stays stable and signed. Companies customize through governed packages: apps, workflows, prompts, tools, connectors, data definitions, permission policies, and evals that install into their own tenant sandbox.

## Phase 0: Prod Blocker Gate

Do not promote public Pearl or enterprise onboarding to prod until these items are complete and tested on web and voice.

1. **Central tenant resolver and role guard**
   - Add one shared resolver for interface API routes that returns an authenticated `ActorContext`: user ID, email, resolved tenant ID, role, auth source, and whether the call is user, service, or channel-originated.
   - No route may trust `body.tenantId`, `body.tenant_id`, query `tenantId`, or forwarded tenant headers unless the authenticated user has membership for that tenant.
   - Patch at minimum: `/api/chat`, `/api/tools/invoke`, `/api/webhooks`, `/api/tasks`, `/api/notifications`, `/api/shared-with-me`, `/api/sharing`, `/api/bot/config`, and `/api/bot/admin`.
   - Service-to-service calls must use signed bot claims or shared-secret internal auth mapped to a specific tenant capability. They cannot pass arbitrary tenant scope through request bodies.
   - Test: a user who belongs only to Tenant A receives `403` when requesting Tenant B, and the route does not forward anything to the gateway.

2. **Private memory isolation**
   - Remove global private memory loading from public, web, voice, relay, and tenant contexts. Root-level `USER.md`, `USER_FACTS.md`, and `MEMORY.md` must never enter another user's context.
   - Migrate Blair's profile/private memory into scoped storage under tenant/user paths, then read through the same scoped code path every other user uses.
   - Fix or retire the relay path in `scripts/production-repair-chat-relays.mjs` that loads shared private files for `web` and `voice` surfaces.
   - Test: a non-owner user cannot cause Blair's private files, profile facts, or stale session identity to appear in web or voice prompts.

3. **Voice parity, not web-only QA**
   - Voice startup must resolve identity from the authenticated session, channel link, or verified participant metadata, then load the correct public/private profile according to scope.
   - Stale launch/body/session names must not override the canonical profile. The Blair/Stephanie bug is the sentinel case.
   - Test simultaneous voice rooms for two users in two tenants and prove prompts, tools, event streams, and memory writes stay separated.

4. **Webhook and integration lockdown**
   - Webhook list/create/update/delete requires tenant admin or owner access.
   - Secrets are write-only; never echo full webhook secrets to clients or logs.
   - Add SSRF-safe outbound URL policy before external webhook delivery is treated as public feature.

5. **Gateway and realtime hardening**
   - `/ws/events` and any realtime event stream must require auth and room/session/tenant scope.
   - Direct prod gateway exposure must be closed or protected; prod should treat the gateway as an internal service behind the interface/control plane.
   - All gateway tool calls must receive already-authorized tenant/user claims, not raw user-supplied tenant IDs.

6. **Budgets, rate limits, and abuse controls**
   - Add Redis-backed per-user, per-tenant, and per-surface rate limits for public Pearl.
   - Add hard tenant cost budgets for LLM/tool use before enterprise beta. Tracking-only quotas are insufficient.

7. **Release gate**
   - Run source checks, route authorization tests, voice identity tests, and prod preflight before promotion.
   - Follow `docs/production-release-workflow.md`; prod is a deploy target, not a dev workspace.
   - Do not deploy env files, logs, JSONL, uploads, `.data`, `.tasks`, `.agency/runs`, backups, or local audit captures.

## Target Architecture

Public Pearl needs four separated planes.

1. **Public identity plane**
   - Canonical PearlOS user account plus public profile.
   - Pearl can search only fields the user explicitly made public, such as display name, bio, role, company, location, interests, links, avatar, and public introduction preferences.
   - Public search never returns private memory, tenant membership details, hidden contact data, raw channel IDs, or private conversation history.

2. **Private tenant plane**
   - Tenant-scoped data lives under tenant namespaces. Private user memory is additionally scoped by user.
   - Required storage shape: `tenants/{tenant_id}/users/{user_id}/...`, `tenants/{tenant_id}/orgs/{org_id}/...`, and a separate public-profile index.
   - Data-layer authorization must enforce tenant boundaries even if an API route makes a mistake.

3. **Channel identity plane**
   - Replace one-off Discord/Telegram link logic with a general `ChannelIdentity` model.
   - Required records: `ChannelInstall` for the company/channel install, `ChannelIdentity` for a linked external account, and `ChannelEventContext` for each inbound message/call.
   - Flow: verify provider signature -> resolve channel install -> resolve linked user if available -> classify public/private/team scope -> build `ActorContext` -> load allowed context -> dispatch tools.
   - SMS is weaker identity and should require stricter consent and lower-trust defaults.

4. **Capability and audit plane**
   - Every tool invocation must be authorized by tenant, actor, channel, scope, and package/capability policy.
   - Record `WorkflowRun` and `AuditEvent` for tenant-visible actions: tool use, connector access, webhook changes, package installs, memory writes, and admin operations.

## Governed WordPress-Style Customization

PearlOS should feel like WordPress for AI operations: any person or company can shape the environment to fit their work, but the core remains stable, secure, and upgradeable.

Implement this through governed packages, not arbitrary production core edits.

Package manifest capabilities:

- apps and dashboards
- Pearl tools and tool permissions
- workflows and swarms
- prompt overlays and persona rules
- data definitions and UI panels
- connectors for Slack, Discord, Google Chat, Telegram, SMS, email, file storage, CRM, ERP, and project systems
- evals, tests, and rollback metadata
- semantic version, tenant install state, and migration hooks

Admin experience:

- company setup wizard with tenant, users, roles, channels, and public profile defaults
- package marketplace with curated first-party templates
- workflow builder for repeatable company operations
- policy console for tools, channels, memory, public profile visibility, budgets, and connector access
- operations dashboard for audit logs, spend, active swarms, failed integrations, and data exports

Initial vertical packages:

- **Logistics:** dispatch board, carrier/customer contact graph, shipment exceptions, document intake, route/status workflows, Slack/Discord alerts.
- **Construction:** project/job folders, bid/RFI/change-order workflows, subcontractor contact graph, site photo/document intake, schedule and safety reporting.
- **Finance/accounting:** private document workspace, approval workflows, audit logs, strict data retention, no public profile exposure beyond explicitly shared business identity.

## Implementation Sequence

1. **Security hotfix branch**
   - Create the central tenant resolver/guard and patch the known caller-controlled tenant routes.
   - Add regression tests for cross-tenant denial and no downstream gateway forward.
   - Remove global private memory from public/web/voice relay paths.

2. **Staging validation**
   - Deploy only the hotfix scope to staging.
   - Run web chat, tool invocation, webhook, and voice identity smokes.
   - Verify Blair's public/private profile is read correctly and stale "Stephanie" data cannot win.

3. **Production promotion**
   - Run `scripts/prod-preflight-audit.sh`.
   - Promote reviewed source changes only, respecting the prod source/deploy split.
   - Verify runtime health and at least one real voice call, not just web chat.

4. **Public profile and search**
   - Split `UserProfile` into public-searchable fields and private memory fields with explicit consent.
   - Add public profile search/indexing that returns only public fields.
   - Give Pearl a safe introduction mode: "I know this from their public PearlOS profile."

5. **Cross-channel Pearl**
   - Generalize Discord/Telegram linking into `ChannelIdentity`.
   - Add channel install model for Slack, Discord, Google Chat, Telegram, SMS, and voice.
   - Load channel context only after provider signature and tenant/channel install verification.

6. **Package platform**
   - Define `PearlPackage`, `PackageInstall`, `CapabilityPolicy`, `WorkflowRun`, and `AuditEvent`.
   - Build first-party logistics and construction packages first because current demand is strongest there.
   - Add package install/rollback, policy checks, and tenant-specific prompt/tool manifests.

7. **Enterprise hardening**
   - Add data export/deletion, retention policy, audit log views, incident runbook, DPA/security posture docs, backups, cost caps, and monitoring.
   - Decide file storage after benchmarking S3-compatible object storage with app metadata against Seafile CE. Do not assume Seafile until sync semantics justify the ops load.

## Test Plan

Required automated scenarios:

- authenticated Tenant A user cannot call chat/tools/webhooks/tasks/notifications using Tenant B ID
- route returns `403` before gateway/tool/webhook side effects
- public profile search returns only users with public profile enabled and only public fields
- private memory loads only for the authenticated user and tenant
- voice call identity reads canonical profile and ignores stale body/session names
- simultaneous voice calls in two tenants do not share prompts, memory, events, or tool results
- Discord/Slack/Telegram inbound event without verified install or linked identity gets public/limited behavior only
- webhook secret is not returned after creation
- package-installed tool cannot execute without capability policy
- tenant cost limit blocks additional expensive LLM/tool calls
- prompt injection cannot escalate from public profile/search into private tenant tools or memory

Required manual acceptance before prod:

- Blair profile reads as Blair Erickson in voice and web
- Pearl does not call Blair "Stephanie" when stale data is present
- Pearl can answer from Blair's public profile in a public context without private memory
- Pearl can answer from Blair's private memory only in Blair's authenticated private scope
- Two test tenants can each invite Pearl into a channel and receive different scoped behavior

## Risks And Defaults

- The older 22-week solo estimate is not credible for enterprise beta. Use 35-45 weeks solo, or 20-26 weeks with a focused 2-3 person team after Phase 0 is complete.
- `PlatformIdentity` is not already canonical; treat cross-channel identity as net-new subsystem work.
- Flat pricing without hard cost budgets is unsafe. Beta requires enforceable tenant spend controls.
- Compliance cannot wait until GA. Export, deletion, retention, audit, and incident response belong in early enterprise hardening.
- Public Pearl's persona is universal, but all private knowledge is scoped. Pearl can connect companies and people only through public profile data or explicit tenant-approved connector data.

## Current Decision Record

- Prod promotion is blocked until Phase 0 isolation passes.
- Customization model is governed packages by default.
- Public Pearl should become a trusted public figure and universal company hire, but she must operate through signed identity, scoped tenant context, capability policies, and audit logs.
- The adversarial review is accepted as the correction layer over the older multitenancy phased plan. Its central finding, caller-controlled tenant scope, is Phase 0 deliverable number one.
