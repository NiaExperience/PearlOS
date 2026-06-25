# PearlOS Multitenancy — Authoritative Phased Implementation Plan

**Status:** Canonical plan — execute against this.
**Author:** Synthesized from 11-agent codebase audit + all source files
**Date:** 2026-05-29
**Dependency chain:** Memory wiring → Identity → FileSpace → Team Assets → GA

---

## Executive Summary

PearlOS ships as "the way our team uses Pearl" — shared workspace, team roles, code push, private 1:1 Pearl, shared projects, and assets — packaged as a product any small business (3–50 seats) can spin up in minutes.

**Current state:** Dangerous theater. Auth/tenant roles work on paper, but the personality system loads Blair's private files (his daughter's age, team members by name, internal infrastructure details) into every user's LLM context. Codex runs `--dangerously-bypass-approvals-and-sandbox`. A `FORCE_SUPERADMIN_SESSION` bypass exists. No rate limiting, no quotas, no abuse prevention.

**This plan ships in 7 phases (0–6) over approximately 22 weeks.** Each phase has a clear completion criterion, a go/no-go decision point, and a Blair migration strategy that ensures zero disruption to the team's current usage.

---

## The Product Vision (Repeated So We Don't Lose It)

When we use Pearl today:
- We're in a shared Discord server
- Blair and team have different roles (developer, admin, viewer)
- Peace of code gets pushed via Codex CLI
- People have private 1:1 Pearl sessions
- We share projects, notes, assets
- It all feels like one workspace

The product ships **that exact experience** — not "AI chatbot for teams" but "your team's workspace with Pearl in it." A small creative studio, dev shop, or agency should sign up, invite their team, and be productive the same day.

---

## Architecture Decisions

### Three-Tier Context Model

```
┌─────────────────────────────────────────┐
│              PEARL CORE                  │
│  SOUL.md, IDENTITY.md, PEARL.md          │
│  (Shared, read-only to all tenants)      │
├─────────────────────────────────────────┤
│            TEAM CONTEXT                  │
│  Tenant personality, team members,       │
│  shared projects, team assets, notes     │
├─────────────────────────────────────────┤
│           PRIVATE CONTEXT                │
│  USER.md, USER_FACTS.md, MEMORY.md       │
│  Per-user memory, private files           │
│  (user_memory.py wired per-session)      │
└─────────────────────────────────────────┘
```

**Pearl Core** is immutable shared identity. Every user in every tenant gets the same Pearl "soul." Think of it as the character the actor plays, not the actor's personal diary.

**Team Context** is tenant-scoped: personality tone, team roster, shared projects and assets, notes visibility. Authorized team members see this context. It is the "shared workspace."

**Private Context** is per-user, per-tenant. A user's private memory in Acme Corp is invisible to users in Beta Inc, and invisible to other Acme Corp users (except superadmins with explicit cross-user view).

### Identity: PlatformIdentity

Each human is one `Person` record in the system. They can link multiple platform accounts:

```
Person (id: uuid)
  ├── PlatformIdentity: Discord (id: 1482123068854763642)
  ├── PlatformIdentity: Telegram (id: @blairerickson)
  ├── PlatformIdentity: Email (id: blair@niaxp.com)
  └── ...
```

`PlatformIdentity` already partially exists (Discord mapping, Telegram DM-link). The Phase 2 deliverable is making this the canonical resolution path: any platform lookup resolves to one `Person`, and that Person maps to their tenant membership + role.

### FileSpace: Seafile CE

Per-user private libraries + team shared libraries, accessible via REST API and webhooks. Replaces the current ad-hoc `/home/deploy/pearlos/memory/` file-based storage with proper permissioned storage that works across tenants.

**Why Seafile CE over alternatives:**
- Open source, self-hosted
- Mature REST API with auth tokens
- Webhook support for change notifications
- Per-user private + group shared library model maps perfectly to our tiered context
- Battle-tested file sync (Dropbox-level reliability)
- Docker deployment is straightforward

### Team Assets: DRAFT → STAGING → PRODUCTION Lifecycle

Every asset in a team workspace has a lifecycle:
- **DRAFT:** Visible to EDIT/ADMIN roles. Can be iterated on.
- **STAGING:** Preview-able. Visible to VIEW+ roles on staging environment.
- **PRODUCTION:** Live. Visible to all team members and (for public assets) unauthenticated viewers.

This applies to personality files, website assets, code deploys, and media.

### Staging Environment

Staging runs with production data but different code. Team assets promoted to STAGING appear in the staging environment. Promotion to PRODUCTION pushes to the live environment. This is the existing staging→prod split at infrastructure level, extended to tenant-scoped assets.

### Roles

- **VIEW:** Can see shared context, notes, assets. Cannot modify.
- **EDIT:** Can create and modify content, notes, assets within their scope.
- **ADMIN:** Can manage team members, roles, billing. Full tenant management.
- **DEVELOPER (tier):** Can push code via Codex CLI. Can promote assets through staging→production pipeline.
- **SUPERADMIN:** Platform-level. Cross-tenant visibility. Emergency access. (Blair's role, with a real authentication path instead of a magic constant.)

---

## PHASE 0: Fortification (Weeks 1–2)

### Goal
Eliminate the "dangerous theater" security vulnerabilities before any multitenancy code ships. You cannot safely onboard tenants while Blair's daughter's age is in every LLM context.

### Timeline
2 weeks

### Deliverables

1. **Remove FORCE_SUPERADMIN_SESSION path**
   - `SUPERADMIN_USER_ID = '00000000-0000-0000-0000-000000000000'` is a known constant in the client bundle
   - Replace with real role check against Prism tenant membership + `tenant_role = 'superadmin'`
   - Superadmin sessions require actual authentication, not a magic string comparison

2. **Sandbox Codex CLI per tenant**
   - Remove `--dangerously-bypass-approvals-and-sandbox`
   - Per-tenant workspace directories: `/workspace/tenants/{tenant_id}/codex/`
   - Codex CLI runs in sandbox mode (`--sandbox workspace-write`)
   - Workspace isolation: Codex for Tenant A cannot read/write Tenant B's files
   - Codex CLI respects tenant role: DEVELOPER-tier users can push code; VIEW-tier users get read-only

3. **Rate Limiting**
   - Per-tenant, per-endpoint rate limits via Redis
   - Gateway `/api/chat`: 20 req/min per user, 200 req/min per tenant
   - Voice session joins: 5/minute per tenant
   - Admin endpoints: 30 req/min per user
   - Abuse detection: 429 responses logged; repeated violations = tenant throttle

4. **Quota System (skeleton)**
   - Per-tenant quotas tracked in Redis:
     - Monthly LLM token budget (configurable per plan tier)
     - Storage quota (pre-FileSpace, just tracking)
     - Concurrent voice session limit
   - Soft quota enforcement: warnings on 80% usage, hard cap at 100%
   - Admin dashboard shows usage (Phase 1 UI polish)

5. **Tenant-scoped personality loading (THE big one)**
   - `build_web_chat_system_prompt()` and `load_workspace_context()` currently load SOUL.md, IDENTITY.md, PEARL.md, USER.md, USER_FACTS.md, MEMORY.md from a shared workspace root
   - **What breaks:** Every user in every tenant gets Blair's USER.md (his name, daughter's age, team roster) and USER_FACTS.md in their LLM context
   - **Fix:**
     - Pearl Core files (SOUL.md, IDENTITY.md, PEARL.md) become system-level, loaded from a read-only location
     - Per-user memory files (USER.md, USER_FACTS.md, MEMORY.md) are loaded from `MemoryScope` via `user_memory.py`
     - `PEARL_VOICE_INCLUDE_PRIVATE_MEMORY` flag behavior changes: when off (default), loads only Pearl Core + Team Context; when on, adds per-user Private Context
     - Web chat `/api/chat` gateway route passes `x-tenant-id`, `x-user-id` headers to `build_web_chat_system_prompt(include_private_memory=True, scope=...)`
     - Voice session `load_workspace_context()` is rewritten to accept `scope: MemoryScope` and load tenant+user scoped context

6. **Wire user_memory.py into the gateway**
   - `user_memory.py` exists, is well-written, has `build_memory_block()` — but it is **never called**
   - Gateway `/api/chat` must extract `x-tenant-id` / `x-user-id` / `x-user-email` from headers
   - Call `build_memory_block(scope_from_headers(headers))` and inject into system prompt
   - Voice pipeline must do the same from env vars (BOT_SESSION_TENANT_ID, BOT_SESSION_USER_ID)
   - This is the moment the "personality loaded from shared files" becomes "personality loaded from authenticated tenant+user scope"

### User Experience
- **Blair:** Nothing changes. His tenant gets his memory files. He's the only user in his tenant at this point.
- **New tenant user:** Gets Pearl Core personality + blank tenant context + blank private context. No Blair data leakage.
- **What is visible:** A new tenant signs up, Pearl introduces herself as Pearl with the proper identity, asks about the team, has no pre-existing context. Clean slate.

### Dependencies
- None. Phase 0 is the foundation.

### Completion Criteria
- [ ] `SUPERADMIN_USER_ID` constant removed from client bundle; replaced with real role check
- [ ] Codex CLI runs `--sandbox workspace-write` per tenant workspace; no `--dangerously-bypass` flag
- [ ] Rate limiting active on all gateway endpoints; testable with `siege`/`ab`
- [ ] Quota skeleton tracking in Redis; dashboard shows usage
- [ ] `build_web_chat_system_prompt()` accepts scope parameter; loads user memory from `user_memory.py`
- [ ] `load_workspace_context()` in voice pipeline accepts scope; no global `USER.md` fallback
- [ ] Integration test: create two tenants, two users per tenant; verify each user's LLM context contains only their own memory + Pearl Core
- [ ] Audit: `grep -r "USER.md\|USER_FACTS.md\|MEMORY.md"` finds only scoped references, no global paths

### Risks
- **Risk (HIGH):** Changing personality loading breaks Blair's Pearl in subtle ways. **Mitigation:** Phase 0 runs on staging first. Blair's tenant gets a migration that copies his current files into the new per-tenant/per-user structure. Run side-by-side personality output comparison test: same prompt to old and new path, diff the responses for regressions.
- **Risk (MEDIUM):** Rate limiting breaks legitimate heavy usage patterns. **Mitigation:** Liberal defaults (20 req/min/user is very permissive for chat). Tune after monitoring.

### Marketing Narrative
*"PearlOS is rebuilding its foundations for multi-team support. Current users won't notice any change — but behind the scenes, we're laying the groundwork for workspace isolation that makes team onboarding safe and clean."*

---

## PHASE 1: Identity — The PlatformIdentity Unification (Weeks 3–5)

### Goal
One human = one Person record. Resolve any platform contact (Discord, Telegram, SMS, email, Slack) to the same identity, with the same memory, the same permissions, across all surfaces.

### Timeline
3 weeks

### Deliverables

1. **PlatformIdentity schema and migration**
   - Prism `PlatformIdentity` model: `personId` (FK to Person), `platform` (enum: discord/telegram/sms/email/slack/google_chat/whatsapp), `platformUserId` (string), `platformUsername` (string), `authToken` (encrypted), `verified` (bool)
   - Migration: existing Discord users, Telegram DM-link users, and email-auth users get PlatformIdentity records created
   - Link/unlink API: `/api/identity/link` and `/api/identity/unlink`
   - UI: Settings → Connected Accounts shows all linked platforms with link/unlink buttons

2. **Identity resolution middleware**
   - `resolveIdentity(headers, platform, platformUserId) → Person`
   - Gateway middleware that runs before every request: extract platform identity, resolve to Person, set `x-person-id`, `x-tenant-id`, `x-user-id`, `x-user-role` headers for downstream
   - Cache Person→Identities mapping in Redis (TTL: 5 minutes)

3. **Cross-platform session continuity**
   - User talks to Pearl on Discord → switches to Telegram → Pearl knows who they are, continues the conversation
   - Cross-session state file becomes scoped to Person (not platform-specific)
   - Activity log tags entries with platform but resolves to Person

4. **Blair identity migration**
   - Blair's Discord identity, Telegram identity, email identity → one Person
   - His existing memory (MEMORY.md, activity-log.md) becomes scoped to his Person record
   - Backfill: search all memory entries with Blair's Discord ID, assign to his Person

5. **API endpoints**
   - `GET /api/identity/me` — returns Person + linked platforms
   - `POST /api/identity/link` — link a new platform (e.g., "I want to also use Telegram")
   - `DELETE /api/identity/link/{platformIdentityId}` — unlink
   - `GET /api/identity/lookup?platform=discord&id=...` — admin lookup

### User Experience
- Sign up via Discord → Pearl knows you. Later link Telegram → same Pearl, same memory.
- Switching between phone (SMS) and desktop (web chat) → Pearl picks up where you left off.
- Team admin sees "Blair Erickson" in the team roster, not "Discord user #1482123068854763642."
- **What's new:** Cross-platform continuity. Currently, Discord Pearl and Telegram Pearl are separate sessions with no shared awareness (except the global MEMORY.md).

### Dependencies
- Phase 0 (fortification) must be complete. Can't build identity on a leaking foundation.

### Completion Criteria
- [ ] PlatformIdentity schema in Prism, migration applied
- [ ] Identity resolution middleware in gateway
- [ ] Cross-platform session test: message on Discord → switch to web chat → Pearl references the Discord conversation
- [ ] Blair's identity unified: his Person exists, linked to Discord + Telegram + email
- [ ] Unlinked platform returns appropriate "connect your account" message
- [ ] Admin can look up Person by any platform identity

### Risks
- **Risk (MEDIUM):** Breaking the existing Discord identity path. **Mitigation:** The existing `sessionUserId` → participant mapping stays in place. PlatformIdentity is an additional resolution layer, not a replacement. Old path remains as fallback with deprecation warning.
- **Risk (LOW):** Identity merge conflicts (e.g., two Person records claim the same email). **Mitigation:** Admin-only merge UI; automated merge rules (newest wins, log conflicts).

### Marketing Narrative
*"PearlOS now knows you across every platform. Start a conversation on Discord, continue it via SMS, pick it up on Telegram. Pearl is Pearl — one identity, one memory, everywhere."*

---

## PHASE 2: FileSpace — Private & Shared Storage (Weeks 6–10)

### Goal
Replace ad-hoc file-based storage with Seafile CE: every user gets private storage, every team gets shared libraries. Files are permissioned, API-accessible, webhook-capable.

### Timeline
5 weeks (largest infrastructure phase)

### Deliverables

1. **Seafile CE deployment**
   - Docker Compose: Seafile CE server + MariaDB + Memcached
   - Runs alongside PearlOS on the same Droplet (or dedicated Droplet for production scale)
   - Admin API key configured for programmatic user/library management
   - Health check endpoint integrated into PM2 monitoring

2. **Seafile ↔ PearlOS integration service**
   - `FileSpaceService` class wrapping Seafile REST API:
     - `create_user(email, password, name) → user`
     - `create_repo(user, name, type="private"|"group") → repo`
     - `get_download_link(repo_id, file_path) → url`
     - `upload_file(repo_id, file_path, content) → file`
     - `list_directory(repo_id, path) → entries`
     - `share_repo(repo_id, group_id, permission="r"|"rw") → success`
   - Auth token management: per-user Seafile API tokens, rotated on password change

3. **Per-tenant FileSpace provisioning**
   - On tenant creation: provision Seafile group for the tenant team
   - Default shared library: "Team Files" (rw for all members)
   - Per-user: private "My Files" library created on first login
   - Tenant admin can create additional shared libraries (e.g., "Design Assets", "Client Projects")

4. **Webhook notifications**
   - Seafile webhook → PearlOS gateway → cross-platform notification
   - File uploaded to shared library → Discord/Telegram notification: "Blair uploaded Q4_report.pdf to Team Files"
   - File modified in user's private library → Pearl mentions it in next conversation: "I see you updated your notes on the marketing plan"

5. **File tool integration**
   - New Pearl tools: `file_search`, `file_read`, `file_write`, `file_list`
   - Scoped to user's accessible libraries: private + team shared
   - Pearl can reference files in conversation: "You have the Q4 report in Team Files. The projection on page 3 shows..."

6. **Migration from current file storage**
   - `/home/deploy/pearlos/memory/` contents → Blair's private Seafile library
   - `/home/deploy/pearlos/creations/` → Blair's private Seafile library
   - `/home/deploy/pearlos/user-data/` → Blair's private Seafile library
   - All existing tool paths that read/write filesystem updated to use FileSpaceService

### User Experience
- **Blair:** His existing files are migrated to his private Seafile. He still accesses them via Pearl the same way. New: files are available across all his linked platforms.
- **New tenant:** Signs up, gets a private "My Files" and a shared "Team Files." Drops a PDF into Team Files via web UI → Pearl sees it, can discuss it immediately.
- **Pearl interaction:** "Hey Pearl, can you pull up the contract template we have in Team Files?" → Pearl reads it, summarizes, offers to edit.
- **What's new:** Structured, permissioned file storage. Pearl can actually interact with files (not just notes). Team file sharing with access control.

### Dependencies
- Phase 1 (identity) must be complete. File ownership depends on Person identity.

### Completion Criteria
- [ ] Seafile CE running, health check passing
- [ ] `FileSpaceService` integration tested: create user, create repo, upload file, download file, list directory
- [ ] Tenant provisioning creates team group + shared library + per-user private library
- [ ] File tools (`file_search`, `file_read`, `file_write`, `file_list`) accessible from voice and web chat
- [ ] Webhook → notification pipeline works end-to-end
- [ ] Blair's existing files migrated; old file paths deprecated but functional for 30 days
- [ ] Cross-tenant isolation verified: Tenant A's files inaccessible from Tenant B's session

### Risks
- **Risk (MEDIUM):** Seafile CE deployment complexity. **Mitigation:** Docker Compose with documented config. Use DigitalOcean Marketplace Seafile image if Docker proves unreliable. Run Seafile on a separate Droplet if resource contention occurs.
- **Risk (MEDIUM):** File migration fails for some Blair files. **Mitigation:** Migration is copy (not move). Old files remain accessible for 30 days. Rollback = switch FileSpaceService back to local filesystem.
- **Risk (LOW):** Seafile REST API rate limits. **Mitigation:** In-memory cache for frequently accessed file metadata. Batch operations where possible.

### Marketing Narrative
*"Your team's files, your team's Pearl. Every user gets private storage. Every team gets shared libraries. Drop a file into Team Files, and Pearl can read it, summarize it, discuss it with you. No more 'I can't access that file' — Pearl lives in your workspace."*

---

## PHASE 3: Team Context & Personality Scoping (Weeks 11–13)

### Goal
Teams have their own personality config, project workspace, and shared awareness. Pearl's tone and knowledge adapt per team without leaking across tenants.

### Timeline
3 weeks

### Deliverables

1. **Tenant personality records**
   - Each tenant has a Personality document in Prism/Mesh (already partially exists via `personality_actions.py`)
   - Personality includes: tone, formality level, industry context, team jargon, preferred response style
   - Pearl Core (SOUL.md) is always present; tenant personality layers on top
   - Admin UI: customize Pearl's tone for your team (professional, casual, technical, etc.)

2. **Team roster awareness**
   - Pearl knows the team members, their roles, their skills
   - "Who's the designer on the team?" → "That's Sarah. She's been on the team since March. Want me to pull up her latest work?"
   - Team member join/leave events update Pearl's context (via webhooks)
   - Roster injected into Team Context block (lightweight: names + roles, not full profiles)

3. **Project workspace**
   - Team can create Projects: named containers for notes, files, tasks
   - Project membership: team members assigned to projects
   - Pearl's context adapts per project: "We're in the Q4 Marketing project. Here's what's relevant..."
   - Project switching via voice command or UI

4. **Tenant-scoped system prompt construction (formalized)**
   - Formalize the prompt assembly pipeline:
     ```
     SystemPrompt = PearlCore + TenantPersonality + TeamRoster + ActiveProject + UserMemory + CrossSessionState
     ```
   - Each block has a token budget; the assembler trims blocks (oldest first) to stay under context limit
   - Configurable per tenant: which blocks to include, token budgets per block

5. **Admin dashboard — team management**
   - View team roster with roles
   - Invite new members (email invite → signup flow → auto-added to tenant)
   - Change member roles
   - Remove members
   - View team activity feed

### User Experience
- **Blair:** Pearl knows his team (Steph, Paddy, Void, Bill, Kia) from his tenant roster, not from hardcoded USER.md. His private memory still has personal facts; the team roster is separate.
- **New team:** Signs up, invites team members, Pearl says "Welcome to PearlOS! I see Sarah and Mike have joined. I'm Pearl. I'll be your team's AI partner. What should I know about your team?"
- **Project context:** "Pearl, switch to the Client Proposal project." → Pearl loads that project's notes, files, and recent activity. "Okay, we're in Client Proposal. The last thing we worked on was the pricing section. Want to pick that up?"
- **What's new:** Pearl adapts to the team. She knows the team's people, projects, and preferences without leaking that knowledge to other teams.

### Dependencies
- Phase 0 (personality scoping foundation)
- Phase 1 (identity)
- Phase 2 (FileSpace for project file storage)

### Completion Criteria
- [ ] Tenant personality record created on tenant signup; editable via admin UI
- [ ] Team roster injected into context; Pearl can answer "who is on the team" accurately
- [ ] Project creation, project switching, project-scoped context works
- [ ] System prompt assembler formalized with configurable budgets
- [ ] Admin dashboard: invite, role change, remove member
- [ ] Integration test: two tenants with different personalities; Pearl's tone differs appropriately
- [ ] Integration test: Tenant A Pearl cannot name Tenant B's team members

### Risks
- **Risk (LOW):** Personality customization is too complex. **Mitigation:** Sensible defaults + preset options (Professional, Casual, Technical). Advanced customization is a Phase 5+ item.
- **Risk (MEDIUM):** Token budget management is tricky. **Mitigation:** Start generous (25K tokens total). Log budget utilization per tenant. Trim oldest memories first when over budget.

### Marketing Narrative
*"Your team, your Pearl. Customize Pearl's personality for your workspace. She knows your team members, your projects, your in-house language. Every team gets their own Pearl — same soul, different workspace."*

---

## PHASE 4: Team Assets — DRAFT → STAGING → PRODUCTION (Weeks 14–17)

### Goal
Team assets (personality configs, website content, code deploys, media) go through a structured lifecycle: draft, stage, produce. Studio-quality asset icons for team websites.

### Timeline
4 weeks

### Deliverables

1. **TeamAsset Prism model and API**
   - `TeamAsset`: id, tenantId, projectId, name, type (personality/web/code/media/document), content (JSON blob or FileSpace reference), status (DRAFT/STAGING/PRODUCTION), version, createdBy, updatedBy, createdAt, updatedAt
   - CRUD API with role-based access: VIEW (read), EDIT (create/update in DRAFT), DEVELOPER (promote), ADMIN (full control)
   - Version history: full audit trail of changes

2. **Asset lifecycle workflow**
   - DRAFT: Edit freely. Visible to EDIT+ roles within the team.
   - STAGING: Promotion triggers preview in staging environment. Developer-role approval required.
   - PRODUCTION: Promotion triggers deployment to production. ADMIN or DEVELOPER-role approval required.
   - Rollback: Each promotion creates a version snapshot. Rollback reverts to previous version.

3. **Staging environment integration**
   - Team assets promoted to STAGING appear in the staging environment for that tenant
   - Staging preview URL per tenant: `https://staging.pearlos.app/preview/{tenant_slug}`
   - Webhook on promotion: notifies team in Discord/Telegram: "Blair promoted 'Homepage Hero' to STAGING. Preview: [link]"

4. **Studio asset icons**
   - SVG icon library for team websites
   - Categories: brand marks, UI elements, illustrations, backgrounds
   - Generated via AI (Stable Diffusion + vectorization) or uploaded by team
   - Asset picker UI: browse studio library, select for use
   - Linked to TeamAsset lifecycle: icons go through DRAFT→STAGING→PRODUCTION

5. **Code deploy pipeline integration**
   - Code assets (build artifacts, static assets) follow the same lifecycle
   - DRAFT: code in development workspace
   - STAGING: code deployed to staging environment
   - PRODUCTION: code deployed to production
   - This formalizes the existing staging→prod split, making it tenant-aware

### User Experience
- **Blair (existing workflow, now productized):** Makes changes, promotes to staging, tests, promotes to production. Same flow he uses now, but with structured lifecycle tracking and team notifications.
- **New team:** Designer uploads new homepage hero → DRAFT. Team reviews → promote to STAGING → preview on staging site → approve → promote to PRODUCTION → live on team site.
- **Pearl:** "The hero image refresh is in STAGING. Sarah promoted it 2 hours ago. Preview here. Want to promote to PRODUCTION?"
- **What's new:** Structured asset management. No more "which version is live?" confusion. Everything has a status, a history, and clear promotion paths.

### Dependencies
- Phase 2 (FileSpace for asset storage)
- Phase 3 (team context for project scoping)

### Completion Criteria
- [ ] TeamAsset CRUD API with role-based access
- [ ] DRAFT→STAGING→PRODUCTION workflow with approval gates
- [ ] Tenant staging preview URL works
- [ ] Studio asset icons library populated with initial set (50+ icons)
- [ ] Code deploy pipeline integrated with asset lifecycle
- [ ] Integration test: create asset → promote to staging → verify on staging → promote to production → verify on production
- [ ] Rollback test: promote to production → rollback → verify previous version is live

### Risks
- **Risk (HIGH):** Staging/production split for per-tenant assets is infrastructure-complex. **Mitigation:** Start with single-tenant (Blair's team) staging/production split. Multi-tenant staging support comes in Phase 5 with infrastructure scaling.
- **Risk (MEDIUM):** Asset lifecycle approval gates could slow down solo teams. **Mitigation:** Admin can configure bypass rules (e.g., "no approval required for DRAFT→STAGING"). Solo teams auto-bypass all gates.

### Marketing Narrative
*"Ship with confidence. Every team asset — from your website hero image to your Pearl's personality config — goes through draft, stage, and production. Preview before you publish. Roll back in one click. No more 'oops, that wasn't supposed to go live.'"*

---

## PHASE 5: Webhooks, Notifications & Multi-Platform Awareness (Weeks 18–19)

### Goal
Events in PearlOS propagate across all connected platforms. File changes, asset promotions, team activity, and memory updates trigger notifications wherever the team works.

### Timeline
2 weeks

### Deliverables

1. **Webhook infrastructure**
   - Internal webhook system: event source → webhook dispatcher → platform adapters
   - Event types: `file.uploaded`, `file.modified`, `asset.promoted`, `team.member_joined`, `team.member_left`, `project.created`, `memory.updated`, `build.deployed`
   - Per-tenant webhook configuration: which events → which platforms
   - External webhook support (Phase 6+): allow tenants to configure outbound webhooks to their own systems

2. **Platform notification adapters**
   - Discord: embed messages with relevant context
   - Telegram: formatted messages with inline links
   - SMS: short summaries for critical events (configurable)
   - Email: digest format (daily/weekly summary option)
   - In-app: notification bell with real-time updates

3. **Cross-platform Pearl awareness**
   - When a file is uploaded via web UI, Pearl on Discord mentions it
   - When Pearl remembers something from a voice conversation, it's available in web chat
   - When an asset is promoted to staging, Pearl on all platforms can reference it
   - The cross-session state file (already exists) becomes the canonical source for "what's happening across platforms"

4. **Notification preferences**
   - Per-user notification settings: which events, which platforms, quiet hours
   - Per-tenant default notification policy
   - "Do not disturb" mode toggle

### User Experience
- File uploaded to Team Files → notification in Discord: "Blair uploaded Q4_Report.pdf (2.3 MB)"
- Asset promoted to STAGING → Telegram message: "Pearl: Sarah promoted Homepage Hero v3 to STAGING. Preview: [link]"
- New team member joins → welcome message in team Discord channel, email to new member
- **What's new:** The team stays in sync without checking multiple places. Pearl keeps everyone informed.

### Dependencies
- Phase 2 (FileSpace, source of file events)
- Phase 4 (Team Assets, source of promotion events)
- Phase 1 (identity, for routing notifications to correct Person across platforms)

### Completion Criteria
- [ ] Webhook dispatcher operational for all event types
- [ ] Discord, Telegram, and email adapters working
- [ ] Notification preferences UI working
- [ ] Integration test: upload file → notification appears on Discord → click → opens file
- [ ] Integration test: promote asset → notifications to all team members on configured platforms
- [ ] Integration test: cross-platform awareness: file uploaded via web → Pearl on Discord knows it exists

### Risks
- **Risk (LOW):** Notification spam. **Mitigation:** Reasonable defaults (notify on promotion, not on every save). User-configurable notification preferences.

### Marketing Narrative
*"Your team, always in sync. Pearl keeps everyone informed across Discord, Telegram, SMS, and email. File uploaded? Asset promoted? New team member? Pearl tells the team, wherever they work."*

---

## PHASE 6: GA — Multi-Tenant Production Readiness (Weeks 20–22)

### Goal
All phases verified together. Production hardening. Billing integration. Public signup flow. This is the GA launch.

### Timeline
3 weeks

### Deliverables

1. **Self-serve signup flow**
   - `pearlos.app/signup` — create tenant account, invite team
   - Trial tier: 14 days, full features, limited to 5 users
   - Pro tier: $49/month, up to 20 users, 50GB storage, unlimited projects
   - Business tier: $149/month, up to 50 users, 200GB storage, priority support
   - Enterprise: custom pricing, unlimited users, dedicated infrastructure
   - Stripe integration for billing

2. **Tenant isolation verification (full audit)**
   - Automated test suite: create N tenants, each with M users, run parallel sessions, verify zero cross-tenant data leakage
   - Penetration test checklist: attempt to access another tenant's files, memory, assets, Codex workspace
   - Rate limit testing: verify per-tenant quotas are enforced
   - Codex workspace isolation test: Tenant A's Codex cannot read Tenant B's workspace

3. **Production infrastructure hardening**
   - Seafile CE on dedicated Droplet (or at minimum, resource limits enforced)
   - Redis with persistence and backups
   - Database backups automated
   - PM2 process monitoring and auto-restart
   - Health check dashboard: all services green/red
   - Log aggregation (basic: PM2 logs + structured logging to files)

4. **Documentation**
   - Admin guide: managing team, roles, projects, assets
   - Developer guide: Codex CLI per-tenant, asset lifecycle
   - User guide: getting started with Pearl across platforms
   - API docs: FileSpace, Team Assets, Webhooks

5. **Blair production migration (the big one)**
   - Blair's current production instance becomes Tenant #1
   - His files, memory, team, and assets are migrated with zero downtime
   - Migration plan: migrate in staging → verify → promote migration scripts → run on production
   - Rollback plan: old code path preserved; migration is reversible for 14 days

6. **Launch marketing**
   - Landing page: "PearlOS — Your team's AI workspace"
   - Demo video: signup → invite team → Pearl in action across platforms
   - Launch on Product Hunt, Hacker News
   - Pricing page with tier comparison

### User Experience
- Go to pearlos.app, click "Start Free Trial" → create account → invite team → Pearl is online and ready
- 14-day trial: full features, 5 users max
- Upgrade to Pro: add payment method, unlock more users and storage
- Full feature set: private memory, team files, asset lifecycle, cross-platform notifications, Codex CLI for developers

### Dependencies
- All previous phases complete and verified

### Completion Criteria
- [ ] Self-serve signup flow tested end-to-end
- [ ] Stripe integration: trial → upgrade → billing → cancellation
- [ ] Full tenant isolation audit passing (automated + manual)
- [ ] Production infrastructure: all services monitored, backups running
- [ ] Documentation complete for admin, developer, and user roles
- [ ] Blair production migration executed with zero downtime
- [ ] Launch announcement published

### Risks
- **Risk (MEDIUM):** Production load from multiple tenants. **Mitigation:** Gradual rollout: invite 5 beta teams before public launch. Monitor resource usage. Scale vertically (larger Droplet) before GA if needed.
- **Risk (LOW):** Stripe integration bugs. **Mitigation:** Test with Stripe test mode throughout Phase 6. Manual end-to-end test before GA.

---

## Blair Migration Strategy — Zero Disruption

Blair is the first and most important user. Every phase must work with zero disruption to his current workflow. Here is the strategy per phase:

### Phase 0 (Fortification)
- Blair's tenant is provisioned as the first tenant with his existing data
- His USER.md, USER_FACTS.md, and MEMORY.md are migrated to the new scoped storage
- The "old path" (global file reads) continues to work for Blair's tenant via a compatibility shim
- Test: Blair talks to Pearl on staging → Pearl responds identically to current production Pearl

### Phase 1 (Identity)
- Blair's Discord, Telegram, and email identities are unified into one Person record
- His existing platform-specific sessions continue to work uninterrupted
- Cross-platform continuity is tested in staging before production

### Phase 2 (FileSpace)
- Blair's existing files are **copied** (not moved) to Seafile
- Old file paths remain functional via compatibility shims for 30 days
- 30-day deprecation warning period before old paths are removed
- Blair can verify his files in Seafile via web UI before the cutoff

### Phase 3 (Team Context)
- Blair's team roster is extracted from USER.md and stored as structured tenant data
- The roster in USER.md is flagged as deprecated; Pearl reads from structured data
- Team personality defaults to Blair's existing preferences; he can tweak via admin UI

### Phase 4 (Team Assets)
- This formalizes workflows Blair already does manually
- No migration needed; the asset lifecycle is additive
- Blair's existing workflow (edit → deploy to staging → deploy to prod) maps to DRAFT→STAGING→PRODUCTION

### Phase 5 (Webhooks)
- Additive feature. No migration. Team notifications are opt-in.

### Phase 6 (GA)
- Blair's production instance becomes Tenant #1
- Migration is executed in staging first, verified, then promoted to production
- Rollback plan: old code runs in parallel; migration is reversible for 14 days
- Zero downtime expected: migration happens during normal operation

**Invariant: At no point does Blair lose access to his data, memory, files, or Pearl functionality. Every phase is tested on staging with his actual data before touching production.**

---

## What Breaks If a Phase Is Skipped

### Skip Phase 0 (Fortification)
**Catastrophic.** Every tenant gets Blair's personal data. Codex CLI runs without sandboxing across all tenant workspaces. No rate limiting means one abusive tenant can take down the entire service. You cannot legally or ethically onboard any external user.

### Skip Phase 1 (Identity)
**Major UX degradation.** Users who connect multiple platforms have fragmented Pearl experiences. Pearl on Discord doesn't know what Pearl on Telegram discussed. Files created on web aren't visible on mobile. The product feels broken across platforms.

### Skip Phase 2 (FileSpace)
**Limited product value.** Without structured, permissioned file storage, Pearl cannot interact with team files in a meaningful way. File sharing is manual (email, Dropbox links) rather than integrated. The "team workspace" concept collapses to just chat.

### Skip Phase 3 (Team Context)
**Weak differentiation.** Without per-team personality and context, every team gets the same Pearl. Pearl doesn't know team members, projects, or team-specific knowledge. The product is "AI chat with file sharing" rather than "your team's AI workspace."

### Skip Phase 4 (Team Assets)
**Missing professional workflow.** Without asset lifecycle, teams manage versions manually. No staging preview, no rollback, no audit trail. For creative and dev teams, this is a dealbreaker.

### Skip Phase 5 (Webhooks)
**Siloed experience.** Teams have to check PearlOS manually for updates. No cross-platform awareness. Reduces the "ambient awareness" value proposition significantly.

### Skip Phase 6 (GA)
**No launch.** Phases 0–5 without GA hardening = a beta product that isn't ready for paying customers. No billing, no self-serve signup, no production isolation guarantees.

---

## Cost Estimates

### Infrastructure (monthly, per DigitalOcean pricing as of May 2026)

| Resource | Phase 0–1 | Phase 2+ | Phase 6 (GA) |
|----------|-----------|----------|--------------|
| App Droplet (4 vCPU, 8 GB) | $48/mo | $48/mo | $96/mo (2x for HA) |
| Seafile Droplet (2 vCPU, 4 GB, 80 GB) | — | $24/mo | $48/mo |
| Managed PostgreSQL | — | — | $30/mo |
| Redis (Managed or self-hosted on App) | $0 (self) | $0 (self) | $15/mo |
| Backups (snapshots) | $5/mo | $5/mo | $10/mo |
| **Total** | **$53/mo** | **$77/mo** | **$199/mo** |

### Development Effort (estimated person-weeks for a single developer)

| Phase | Weeks | Key Effort |
|-------|-------|------------|
| 0: Fortification | 2 | Security cleanup, wiring user_memory, rate limits |
| 1: Identity | 3 | PlatformIdentity schema, resolution middleware, cross-platform |
| 2: FileSpace | 5 | Seafile deployment, integration service, file tools, migration |
| 3: Team Context | 3 | Personality scoping, roster, projects, prompt assembly |
| 4: Team Assets | 4 | Asset model, lifecycle, staging integration, studio icons |
| 5: Webhooks | 2 | Event system, platform adapters, notification prefs |
| 6: GA | 3 | Signup flow, billing, hardening, docs, launch |
| **Total** | **22** | |

These are estimates for a single developer who knows the codebase well. A team of 2–3 could compress to 12–16 weeks with parallel work on Phases 2–3. A single developer who is also doing ops/support should budget 30 weeks.

---

## How This Replicates "How We Use Pearl" as a Product

The current usage pattern:
1. Team has a shared Discord server → **becomes** tenant workspace with built-in chat
2. Blair pushes code via Codex CLI → **becomes** Developer-tier Codex with sandboxed workspace
3. Team members have roles → **becomes** VIEW/EDIT/ADMIN/DEVELOPER roles
4. Private 1:1 Pearl conversations → **becomes** private memory + 1:1 voice/web chat
5. Shared projects and assets → **becomes** Team Projects + Team Assets with lifecycle
6. Cross-platform presence (Discord, Telegram, SMS) → **becomes** PlatformIdentity unification

The product is not "add multitenancy to PearlOS." The product is "extract the PearlOS team experience and make it self-serve for any small business."

The key insight: **Pearl is not the product. The team's workspace with Pearl in it is the product.** Every feature decision should be evaluated against: "Does this help a team work together better with Pearl as their partner?"

---

## Go/No-Go Decision Points

| Phase | Go/No-Go Criterion |
|-------|-------------------|
| 0→1 | Security audit clean: zero Blair data leakage to non-Blair sessions on staging |
| 1→2 | Cross-platform identity test: start Discord session → continue on web chat → Pearl remembers context |
| 2→3 | File isolation test: create file in Tenant A → verify Tenant B's Pearl cannot read it |
| 3→4 | Personality isolation test: Tenant A's Pearl has different team knowledge than Tenant B's Pearl |
| 4→5 | Full asset lifecycle test: create → draft → promote to staging → promote to production → rollback |
| 5→6 | End-to-end notification test: file upload → notification on all configured platforms |
| GA | Self-serve signup + trial + upgrade + isolation audit + Blair production migration |

---

## Appendix: Current State Audit Summary (11-Agent Findings)

### Auth & Tenant Roles
**SOLID.** The Prism-based auth system with NextAuth + tenant membership + role checks is well-structured. `require_auth` and `require_strict_auth` in the gateway are correctly implemented. Tenant-scoped content operations exist and are tested.

### user_memory.py
**EXISTS, WELL-WRITTEN, NEVER WIRED.** The module at `bot/pearl/user_memory.py` has `build_memory_block()`, `append_memory()`, `list_memories()`, `search_memories()` — all properly tenant-scoped by `MemoryScope(tenant_id, user_id)`. But `build_memory_block` is **never called** in the gateway or pipeline. The system prompt loader (`build_web_chat_system_prompt()`) ignores it entirely.

### Personality Loading
**GLOBAL, NOT SCOPED.** Both `load_workspace_context()` (voice) and `build_web_chat_system_prompt()` (web chat) load SOUL.md, IDENTITY.md, PEARL.md, USER.md, USER_FACTS.md, and MEMORY.md from a shared workspace root. There is no tenant or user discrimination. The `include_private_memory` flag exists but defaults to `false` in web chat; even when `true`, it loads the same global files for any authenticated user.

### Codex CLI
**UNSANDBOXED, SHARED WORKSPACE.** Codex runs with `--dangerously-bypass-approvals-and-sandbox` in a shared `/workspace/nia-universal`. Any tenant's Codex can read/write any other tenant's files (when there are multiple tenants).

### FORCE_SUPERADMIN_SESSION
**EXISTS.** `SUPERADMIN_USER_ID = '00000000-0000-0000-0000-000000000000'` is a hardcoded constant in `apps/interface/src/constants/superadmin.ts`. Multiple UI components check `session.user.id === SUPERADMIN_USER_ID` to bypass tenant scoping entirely. This is a nuclear auth bypass — anyone who knows the constant can craft a session token claiming to be the superadmin.

### No Rate Limiting or Quotas
**NONE.** The gateway has no rate limiting middleware. No per-tenant or per-user quotas exist. LLM token consumption is unbounded. A single abusive user could consume thousands of dollars in API costs or degrade service for all tenants.

### Summary
The system has the **structural bones** of multitenancy (tenant-scoped content, role checks, personality per-tenant) but the **operational reality** of a single-tenant system with global shared state. The gap between "what the schema allows" and "what the runtime actually does" is the distance between a secure multi-tenant platform and dangerous theater.
