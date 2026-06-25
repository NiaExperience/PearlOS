# Adversarial Review — PearlOS Multitenancy Phased Plan

**Reviewers:** Claude (Opus 4.8, Claude Code) + Codex CLI (GPT-5.5), independent passes, cross-verified against live source.
**Target:** `docs/PEARLOS_MULTITENANCY_PHASED_PLAN.md` (2026-05-29)
**Date:** 2026-06-03
**Method:** We did not trust the plan's "11-agent audit" appendix. Every headline claim was re-checked with ripgrep/read against the working tree. Each model's novel findings were verified by the other.

---

## Bottom line

The plan's *architecture* is mostly sound. The plan's *diagnosis of current state* — the appendix it builds Phase 0 on — is **substantially stale or wrong**, and it **misses the one class of bug that is actually live and exploitable today**: endpoints that scope to a caller-supplied `tenantId` with no membership check. As written, Phase 0 spends two weeks partly re-fixing things that are already fixed while leaving real cross-tenant access holes untouched.

Both reviewers independently rate the **22-week / single-developer** estimate as not credible. Realistic defensible-beta budget: **~35–45 weeks** solo.

---

## Ground-truth verification of the plan's premises

| Plan claim (appendix / Phase 0) | Verdict | Evidence |
|---|---|---|
| Codex runs `--dangerously-bypass-approvals-and-sandbox` | **REFUTED — already fixed** | No such flag anywhere outside the plan itself. Live wrappers use `--sandbox workspace-write`: `scripts/pearl-codex-executor.sh:55`, `scripts/pearl-worker.py:960`, and `AGENTS.md:70` mandates it. |
| `user_memory.py` "exists, well-written, **never called**" | **REFUTED** | `build_memory_block()` (`apps/pipecat-daily-bot/bot/pearl/user_memory.py:208`) **is** called: `context_loader.py:502/510`, `pipeline/builder.py:345/348` and `:639/642`. Voice pipeline already wires per-user scoped memory. |
| `FORCE_SUPERADMIN_SESSION` = "nuclear bypass; anyone who knows the constant can craft a session token" | **OVERSTATED** | Gated in `packages/prism/src/core/auth/getSessionSafely.ts:12-23`: throws in production, *and* requires `PEARL_ALLOW_SUPERADMIN_BYPASS=1`, *and* logs a warning. Knowing the UUID grants nothing without a forged signed session. |
| "Zero rate limiting in the gateway" | **REFUTED (partial)** | `apps/pipecat-daily-bot/bot/rate_limit.py` exists, imported at `bot_gateway.py:41`, applied to `/api/chat` (`bot_gateway.py:2826`) and task create (`tasks_api.py:1423`). *Valid residual:* it's in-memory/per-process/per-user, **not** Redis, **not** per-tenant, and there is **no quota/cost system** — so the plan's *prescription* is partly right even though its *diagnosis* is wrong. |
| `SUPERADMIN_USER_ID` constant is in the client bundle | **CONFIRMED** | `apps/interface/src/constants/superadmin.ts` exists; also defined in `packages/prism/src/core/auth/auth.middleware.ts:17`; used in client components (e.g. HtmlGeneration) and server routes (`packages/prism/src/core/routes/tenants/route.ts:46`). True, but low-severity by itself (see above). |
| Web chat loads global `USER.md`/`USER_FACTS.md`/`MEMORY.md` into every user's context with no scoping | **PARTIAL** | `build_web_chat_system_prompt()` excludes private files unless `include_private_memory`; the gateway calls it *without* that flag and prepends scoped per-user memory (`bot_gateway.py:2250-2256`). Voice gates global private files behind `PEARL_VOICE_INCLUDE_PRIVATE_MEMORY`. **BUT** a real global-leak path survives elsewhere — see Finding 3. |

**Four of six headline claims are false, already-fixed, or materially overstated.** That is a credibility problem for the document, because every Phase 0 task is justified by these claims.

---

## Findings (ranked, most dangerous first)

### 1. CRITICAL — Systemic broken tenant authorization (the bug the plan misses)
Multiple endpoints derive the tenant scope from **caller-supplied input** and forward/act on it with **no membership or role check**:
- `apps/interface/src/app/api/chat/route.ts:35-44` — `resolveTenantId` returns `fromSession || fromRequest`; a session without a bound `tenant_id` causes the request-body `tenantId` to be sent to the gateway as `x-tenant-id`/`x-pearl-tenant-id`.
- `apps/interface/src/app/api/tools/invoke/route.ts:42-46` — `tenantId = session.tenantId || body.tenant_id || body.tenantId || 'public'`. Any authenticated user can target an arbitrary tenant's tools (or fall through to `'public'`).
- `apps/interface/src/app/api/webhooks/route.ts` — GET reads `?tenantId=` and POST reads `body.tenantId` after only an "is-logged-in" check, then lists/creates that tenant's webhook subscriptions. Cross-tenant IDOR on a secret-bearing resource.

This is a live, pre-multitenancy authorization hole and it is **more important than everything in the plan's Phase 0 security section**. The plan fixates on the superadmin constant (low severity) and the Codex flag (already fixed) and never addresses caller-controlled tenant scoping.
**Fix:** one central tenant-resolver middleware: `authenticated user + requested tenant → must pass membership/role check` before any downstream header, Prism query, or gateway forward. No endpoint may trust a body/query `tenantId`. Make this **Phase 0 deliverable #1.**

### 2. CRITICAL — The plan is built on stale audit data
See the table above. Consequence: Phase 0's two weeks are mis-allocated. **Re-derive the threat model from live source before writing code**; replace the appendix with a per-endpoint tenant-boundary inventory (auth, prompt context, files, tools, tasks, webhooks, notifications, logs, deploys).

### 3. HIGH — The "compatibility shim" reopens the exact PII leak it's meant to close
Phase 0 says remove global `USER.md` reads but keep a shim so Blair's global reads keep working. Meanwhile a live path already loads global private memory broadly: `scripts/production-repair-chat-relays.mjs:822-860` — `shouldLoadPrivateMemory()` returns true for **all `web` and `voice` surfaces** (and DMs / trusted Discord-Telegram channels), and `buildPrivateMemoryContext()` loads global `USER_FACTS.md` + `MEMORY.md` + `IDENTITY.md`/`SOUL.md` from the shared root; it also *writes* global `USER_FACTS.md` (`:~1956`). A shim that preserves global private reads in a multi-tenant runtime **is** the leak.
**Fix:** no compatibility shim for global private memory. One migration: copy Blair into scoped storage, then delete global private reads, with a regression test proving global `USER.md`/`USER_FACTS.md`/`MEMORY.md` never enter a non-owner context (including this relay's web/voice branch).

### 4. HIGH — Quotas don't protect the business model
GA prices flat ($49–$149/mo) against unbounded LLM/tool token cost. The "quota skeleton" is tracking-only (Redis counters, soft warnings). There is no hard per-tenant cost cap, no trial-abuse control. One heavy or malicious tenant can erase the margin on the whole tier.
**Fix:** Redis-backed per-user/per-tenant/per-surface limits **and** hard LLM/tool cost budgets before *beta*, not GA.

### 5. HIGH — Seafile CE is a large operational bet hidden behind a 5-week estimate
Self-hosted Seafile drags in MariaDB, memcached, API-token lifecycle/rotation, backups, webhook delivery reliability, AV scanning, retention, per-tenant quota mapping, and a migration. That is an ops platform, not "file storage."
**Fix:** benchmark S3-compatible object storage + app-owned metadata first; choose Seafile only if its sync semantics are genuinely product-critical.

### 6. HIGH — Existing webhook/admin surfaces are under-guarded *now*, but treated as Phase 5
The webhook API already exists and is exploitable today (Finding 1). The plan files notifications/webhooks under Phase 5 future work, so the live exposure goes unowned for months.
**Fix:** audit and lock down existing "future" surfaces in Phase 0; add SSRF-safe outbound webhook policy.

### 7. MEDIUM — `PlatformIdentity` does not "partially exist"
There is Discord/Telegram DM-link plumbing, but no canonical `PlatformIdentity` model. Phase 1 is a net-new identity subsystem + backfill migration, not a "make the existing thing canonical" task → its 3-week estimate is optimistic.

### 8. MEDIUM — No compliance story for a product whose headline failure is PII leakage
No data export/deletion, retention policy, audit log, DPA posture, or incident runbook anywhere before GA. For a multi-tenant product selling on "your private data stays yours," this belongs in Phase 0/1, not "later."

### 9. MEDIUM — GA couples a rewrite, a live-data migration, billing, and a public launch
"Blair's production instance becomes Tenant #1" + zero-downtime migration + Stripe + Product Hunt launch in one 3-week phase is too many irreversible variables at once.
**Fix:** make Blair's migration an isolated earlier milestone with a proven, tested rollback, decoupled from launch.

---

## What the plan gets right (so this isn't all teeth)
- **Three-tier context model** (Pearl Core / Team / Private) is the correct decomposition and matches how the code already separates shared vs. scoped memory.
- **DRAFT → STAGING → PRODUCTION** asset lifecycle is reasonable and maps to existing workflow.
- **Per-phase go/no-go gates** and the "what breaks if skipped" section are good discipline.
- Correctly insists that **isolation must precede onboarding** — the instinct is right even though the threat model is mis-aimed.

---

## The 3 things to change before anyone writes code
1. **Re-audit against live source and replace the appendix.** It demonstrably misdiagnoses ≥4 of 6 items; a plan can't be "authoritative" on a stale base.
2. **Make a central tenant-resolver + role guard the first deliverable.** Kill all caller-supplied `tenantId` trust (Finding 1). This is the real, live, exploitable hole.
3. **Delete the global-private-memory compatibility shim.** One scoped migration path, with a regression test proving global private files never reach a non-owner context — including the relay's `web`/`voice` branch.

## Effort verdict
22 weeks solo is not credible. The plan under-scopes the tenant-authorization rework, the Seafile operational surface, the (net-new) identity subsystem, billing-abuse controls, observability, and the production migration. Budget **~35–45 weeks** for a defensible beta; longer for true GA. A 2–3 person team could reach beta in ~20–26 weeks with parallelization, *after* the re-audit.
