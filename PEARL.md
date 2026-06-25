# PearlOS Agent Guide

This is the canonical operating guide for Pearl and AI coding agents working in this repository.

This file is not Pearl's personality or private memory. Pearl-specific identity and memory live in files such as `AGENTS.md`, `IDENTITY.md`, `SOUL.md`, `MEMORY.md`, `HANDOFF.md`, and `USER_FACTS.md`.

`CLAUDE.md` is kept only as a small compatibility shim because Claude Code auto-discovers that filename. The canonical guidance belongs here.

---

## Critical Source Rules

First identify where you are running before editing.

### Source Workspace and Deploy Targets

If `/workspace/nia-universal` exists, it is the source of truth.

On DigitalOcean staging (`pearl-staging-private-omega`), `/home/deploy/pearlos`
is a deploy/runtime target. On older RunPod or production contexts,
`/opt/pearlos` may be a deploy target. Do not edit source files in deploy
targets directly.

Rules:

- Edit code and scripts under `/workspace/nia-universal`.
- Build from `/workspace/nia-universal`.
- Copy changed files forward to the verified deploy target only after editing source.
- Verify the changed file exists in both locations before claiming deploy-target work is done.
- If you detect deploy-only drift, sync the deploy-only edit back to source before rebuilding, then inspect the diff.

Typical staging interface deploy:

```bash
cd /workspace/nia-universal
npm run build --prefix apps/interface
cp <changed-source-file> /home/deploy/pearlos/<same-path>
su - deploy -c "pm2 restart interface --update-env && pm2 save"
```

### DigitalOcean Staging

If you are on `pearl-staging-private-omega`, the staging app root is usually:

```text
/home/deploy/pearlos
```

Rules:

- Work only on staging unless Blair explicitly asks otherwise.
- Do not touch production from the staging droplet.
- Do not change database setup unless Blair explicitly asks.
- Use the runtime user and PM2 process ownership already present on the droplet, usually `deploy`.
- Prefer `/workspace/nia-universal/AGENTS.md`, `docs/staging-handoff/CODEX_DO_OPERATIONS.md`, and `docs/production-release-workflow.md` for current staging and release specifics. Deploy-target copies may be stale and should be verified against source.

Current known staging URL:

```text
https://134-209-76-227.sslip.io
```

### Domain Source of Truth

Do not infer PearlOS production domains from stale config grep results or old
chat transcripts. Verify DNS/HTTP live before reporting domain status.

Current domain map verified on 2026-05-04:

```text
https://pearlos.org      -> public PearlOS website, redirects to www
https://www.pearlos.org  -> public PearlOS website
https://app.pearlos.org  -> PearlOS production app login
https://134-209-76-227.sslip.io -> DigitalOcean staging app
```

Known stale or non-authoritative domains:

```text
pearlos.app       -> old/stale reference; not resolving as of 2026-05-04
www.pearlos.app   -> old/stale reference; not resolving as of 2026-05-04
omega-stage.pearlos.org -> proposed staging name; not resolving as of 2026-05-04
```

`niaxp.com` / `www.niaxp.com` are marketing/company domains and are not the
PearlOS app production endpoint.

When source/deploy instructions conflict, location-specific `AGENTS.md` and `HANDOFF.md` win.

---

## Non-Negotiables

- Never run destructive git commands such as `git reset --hard` or `git checkout -- <file>` unless explicitly requested.
- Never force-push or rewrite public history unless explicitly requested.
- Never log or print secrets, OAuth tokens, API keys, raw credentials, or private user facts.
- Do not edit production OAuth, production bot configs, or database setup during staging work unless explicitly asked.
- For a user's own PearlOS instance, route edits through their account-local sandbox, Terminal, feature package, customization, and Agency task paths. Do not describe Pearl as unable to change PearlOS.
- For shared source, builds, deploys, and staging/prod debugging, route engineering work through the protected Agency path with Codex CLI as the default second pair of eyes.
- Keep changes scoped to the request.
- Preserve unrelated user or agent changes in the worktree.
- Prefer existing repo patterns over new abstractions.
- For non-trivial changes, state the goal, files touched, verification, and known risk.

---

## Repository Snapshot

Root:

```text
/workspace/nia-universal
```

Current npm workspaces in `package.json`:

```text
packages/features
packages/prism
packages/events
packages/redis
apps/interface
apps/dashboard
apps/mesh
apps/pipecat-daily-bot
```

Other app folders may exist, such as `apps/bot-gateway`, `apps/chorus-tts`, `apps/ncp`, `apps/pearlos-mcp-server`, `apps/sidescroller`, `apps/sprite-maker`, and `apps/web-base`. Do not assume they are npm workspaces unless `package.json` says so.

There is no guaranteed `charts/` directory in this checkout. Kubernetes or Helm docs may exist under `docs/` or archived paths, but verify before referencing them.

---

## Architecture Summary

Nia Universal / PearlOS is a multi-tenant workspace platform with:

- `apps/interface`: main Next.js user-facing app, usually port `3000`.
- `apps/dashboard`: admin/dashboard app, usually port `4000`.
- `apps/mesh`: GraphQL Mesh server, usually port `2000`.
- `apps/pipecat-daily-bot`: Python/Node voice bot runtime.
- `packages/prism`: shared data abstraction.
- `packages/features`: feature flags, feature prompts, and content definitions.
- `packages/events`: event descriptors and generated event helpers.
- `packages/redis`: shared Redis utilities.

Core rule:

```text
packages/* must not import from apps/*
```

Feature code should prefer public exports, feature-local modules, Prism APIs, and existing service/hook boundaries.

---

## Session Bootstrap

For code work, read only what is relevant. Start with:

1. `AGENTS.md` for current role and deployment rules.
2. `.github/instructions/QUICK_REFERENCE.md` for concise repo guardrails.
3. `.github/instructions/copilot.instructions.md` for generated protocol summary.
4. `docs/ai-assistant-protocol.md` only when deeper protocol detail is needed.
5. `ARCHITECTURE.md` and `DEVELOPER_GUIDE.md` when architecture or feature patterns matter.

For staging migration work, also read:

```text
HANDOFF.md
MEMORY.md
memory/<latest-date>.md
docs/staging-handoff/
```

---

## Common Commands

Install and dev:

```bash
npm install
npm run start:all
npm run start:simple
npm run start:minimal
```

Build and checks:

```bash
npm run build
npm run build --prefix apps/interface
npm run type-check
npm run lint
```

Tests:

```bash
npm test
npm run test:js -- --runTestsByPath <file.test.tsx>
npm run test:e2e
npm run cypress:open
```

Important Jest rule:

```text
Do not use npm test --workspaces.
```

The root `npm test` script already orchestrates the repo test flow. Adding `--workspaces` can duplicate paths and churn services.

Database helper scripts exist, but staging migration work must leave database setup alone unless Blair explicitly asks.

---

## Feature Flags

Feature flags live in `packages/features/src/feature-flags.ts`.

Current `FeatureKey` values include:

```text
appletApi
avatar
avatarLipsync
summonSpriteTool
googleAuth
guestLogin
browserAutomation
dailyCall
assistantSelfClose
requireUserProfile
gmail
googleDrive
htmlContent
maneuverableWindow
miniBrowser
passwordLogin
notes
onboarding
openclawBridge
enhancedBrowser
pearlMultiMenu
resourceSharing
screenSharePrompt
terminal
soundtrack
userProfile
wikipedia
youtube
smartSilence
lullDetection
spriteVoice
news
weather
wonderCanvas
vision
sprites
calculator
```

Most features default to enabled unless disabled by matching env vars. Always verify current behavior in `packages/features/src/feature-flags.ts` before making assumptions.

---

## Feature Work Pattern

Most interface feature work belongs under:

```text
apps/interface/src/features/<FeatureName>/
```

Use the existing structure in that feature before creating new folders. Common directories include:

```text
actions/
api/
components/
events/
hooks/
lib/
routes/
services/
styles/
types/
__tests__/
```

For API routes, prefer thin route files that call feature-local route implementations when that pattern already exists.

For UI/tool work, check both:

```text
apps/interface/src/actions/getAssistant.ts
apps/interface/src/components/browser-window.tsx
```

Tool declarations without matching UI handlers are a common failure mode.

---

## Events

Event descriptors live in:

```text
packages/events/descriptors/events.json
```

Generated outputs live under `packages/events/src/generated`, `packages/events/dist/generated`, and Python generated files.

Before emitting or changing a structured event:

- Verify the topic exists in the descriptor.
- Add or update schema and redaction metadata where needed.
- Run the repo's event/codegen workflow if descriptor changes require it.
- Add focused tests for redaction, validation, or ordering when behavior changes.

For browser-only `CustomEvent` wiring, follow existing feature-local patterns and clean up listeners in React effects.

---

## Security And Privacy

- Never commit secrets.
- Never paste secrets into logs, reports, Discord, Telegram, or memory files.
- Do not store tokens in `localStorage`.
- Do not log raw user-identifiable text unless the existing logger path already redacts it.
- Be careful with `USER_FACTS.md`; it is private memory, not general documentation.
- Use structured logs where the codebase already has logging helpers.

---

## Pearl / Agency Notes

Pearl-facing behavior is governed primarily by:

```text
AGENTS.md
IDENTITY.md
SOUL.md
MEMORY.md
HANDOFF.md
USER_FACTS.md
```

On staging, Discord and Telegram may be running through the production repair relay:

```text
scripts/production-repair-chat-relays.mjs
```

The Agency worker is usually:

```text
scripts/pearl-worker.py
```

Pearl self-evolution means scoped execution first: a user's custom PearlOS changes
belong in that requester's sandbox, ledger, feature packages, interface
customizations, and reviewable artifacts. Shared source edits are still possible,
but only through the source-of-truth and release workflow.

Do not assume OpenClaw native sidecars are active. Check PM2 and the current handoff before describing live routing.

DeepSeek should be direct through DeepSeek when configured that way. Do not route DeepSeek through OpenRouter unless Blair explicitly asks.

OpenRouter is intentionally used for some workflows, such as selected image generation routes or configured voice/tool-call paths. Do not generalize that to all model traffic.

---

## Git Workflow

- Do not commit unless asked.
- Do not change git config unless asked.
- Do not skip hooks unless asked.
- Check worktree state before and after substantial edits.
- If unrelated files are dirty, leave them alone.
- If your touched file has existing edits, read carefully and preserve them.

PR documentation guidance exists in `PULL_REQUEST_TEMPLATE.md` and `docs/ai-assistant-protocol.md`; use it when preparing a PR, not for every local fix.

---

## Verification

Choose verification proportional to the change:

- Docs-only: spell/format sanity and factual checks against the repo.
- Script changes: syntax check, targeted dry run if safe, then restart only the relevant process when needed.
- Interface code: targeted tests where available, `npm run build --prefix apps/interface`, and PM2 restart on the target server if deploying.
- Shared packages: targeted package tests plus type/build checks as risk requires.

Always report what you ran and what you did not run.

---

## Known Risks This File Avoids

- Treating `/opt/pearlos` as source and losing edits on rebuild.
- Applying RunPod source/deploy rules to DigitalOcean staging incorrectly.
- Touching production while testing staging.
- Accidentally changing database setup during the RunPod to DO migration.
- Assuming stale app/package lists are complete.
- Claiming Pearl memory facts are present when they are not loaded.
- Using `CLAUDE.md` as Pearl identity instead of agent coding guidance.

---

## Filename Rationale

`PEARL.md` is the main guide because this repo and runtime are PearlOS-centered.

`CLAUDE.md` remains as a small compatibility shim because Claude Code auto-discovers that filename. Do not move canonical instructions back into `CLAUDE.md`; update this file instead.

**Last audited:** 2026-05-03
