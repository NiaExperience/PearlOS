# New Agent Handoff: Build Gate, Pearl Workflow, And Dirty Workspace

Date: 2026-06-01 01:48 UTC.

This handoff is for a fresh agent taking over PearlOS staging/prod workflow
hardening. Read this before touching deploys.

## Current Context

- Current working directory for source work: `/workspace/nia-universal`.
- Current branch: `GOLDEN-POND`.
- Current source HEAD at handoff time: `e4819a79`.
- Local interface health currently reports:

  ```json
  {
    "codename": "PIPELINE PERFORMANCE FIX",
    "commitSha": "afa6ec3e",
    "nextBuildId": "build-afa6ec3e-1780076792572",
    "buildTime": "2026-05-29T17:16:24.696Z"
  }
  ```

  This does not match current HEAD. Treat that as a stale or unrebuilt runtime
  until proven otherwise.

- Pipecat gateway health at handoff time is OK:

  ```json
  {"status":"ok"}
  ```

## Source Of Truth Rule

The source of truth is always:

```text
/workspace/nia-universal
```

The staging deploy/runtime tree is:

```text
/home/deploy/pearlos
```

Do not edit code directly in `/home/deploy/pearlos` or `/opt/pearlos`.
Edit source in `/workspace/nia-universal`, then copy changed files forward to
the deploy tree when the runtime needs them.

Before prod work, read:

```text
docs/production-release-workflow.md
docs/staging-handoff/CODEX_DO_OPERATIONS.md
```

## What Was Just Added

The previous session implemented a real build/release gate so Pearl cannot
claim a build is fixed, live, pushed, or deployed without runtime proof.

New files:

```text
docs/qa/BUILD_RELEASE_WORKFLOW.md
scripts/qa-release-gate.sh
```

Modified files owned by that work:

```text
AGENTS.md
apps/interface/src/app/api/launchpad/lib/build-task-prompt.ts
apps/pipecat-daily-bot/bot/bot_gateway.py
apps/pipecat-daily-bot/bot/core/prompts.py
apps/pipecat-daily-bot/bot/pearl/context_loader.py
apps/pipecat-daily-bot/bot/pipeline/builder.py
docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md
scripts/deploy-staging.sh
```

The changed source files above were copied to `/home/deploy/pearlos` and
verified with `cmp`. `pipecat-gateway`, `pipecat-runner`, and
`bot-queue-worker` were restarted and saved under the `deploy` PM2 owner.

The interface TypeScript prompt change is copied forward, but it will not affect
the running Next app until a successful gated interface build is run.

## New Build Rule

The staging deploy command now requires Codex verification before build:

```bash
cd /workspace/nia-universal
PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='BUILD NAME' scripts/deploy-staging.sh
```

`PEARLOS_CODEX_VERIFIED=1` must only be set after Codex has reviewed the fix and
release plan against:

```text
docs/qa/BUILD_RELEASE_WORKFLOW.md
```

Without that variable, the gate fails intentionally:

```text
qa-release-gate: FAIL - Codex verification required before build.
```

This is expected and is the guard Blair asked for.

## Important Current Blocker

The gate currently also fails because the workspace has many unrelated dirty
files and runtime/dev artifacts. Do not bypass this. The dirty tree is exactly
what can produce ghost-build behavior.

At handoff time, notable dirty or blocked paths include:

```text
.tasks/*
apps/interface/.data/task-feedback/feedback.jsonl
apps/interface/.next_restore/
tests/e2e/test-results/*
```

There are many other modified files from parallel work. Do not revert or delete
anything blindly. Some changes may belong to other agents or users.

Before any new build, the next agent must sort the dirty tree into:

- relevant changes to commit,
- runtime artifacts to untrack or ignore if already intended,
- unrelated user or agent work to leave alone,
- generated output that should not be deployed.

Never use `git reset --hard` or broad checkout cleanup unless Blair explicitly
requests destructive cleanup.

## Validation Already Done

These checks passed after the build gate work:

```bash
bash -n scripts/qa-release-gate.sh
bash -n scripts/deploy-staging.sh
python3 -m py_compile \
  apps/pipecat-daily-bot/bot/pearl/context_loader.py \
  apps/pipecat-daily-bot/bot/core/prompts.py \
  apps/pipecat-daily-bot/bot/pipeline/builder.py \
  apps/pipecat-daily-bot/bot/bot_gateway.py \
  apps/pipecat-daily-bot/bot/api/tasks_api.py
node -e "const ts=require('typescript'); const fs=require('fs'); const p='apps/interface/src/app/api/launchpad/lib/build-task-prompt.ts'; const src=fs.readFileSync(p,'utf8'); const sf=ts.createSourceFile(p, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); if (sf.parseDiagnostics.length) process.exit(1)"
```

The gate was also tested in both modes:

- Missing `PEARLOS_CODEX_VERIFIED=1` fails as intended.
- With Codex verified, the preflight proceeds and then blocks on dirty
  runtime/dev paths, also as intended.

## Next Agent Checklist

1. Read the active instructions:

   ```bash
   cd /workspace/nia-universal
   sed -n '1,180p' AGENTS.md
   sed -n '1,220p' docs/qa/BUILD_RELEASE_WORKFLOW.md
   sed -n '1,180p' docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md
   ```

2. Inspect dirty workspace safely:

   ```bash
   git status --short
   git diff --stat
   ```

3. Separate the new gate changes from unrelated work:

   ```bash
   git diff -- \
     AGENTS.md \
     docs/qa/BUILD_RELEASE_WORKFLOW.md \
     docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md \
     scripts/qa-release-gate.sh \
     scripts/deploy-staging.sh \
     apps/pipecat-daily-bot/bot/pearl/context_loader.py \
     apps/pipecat-daily-bot/bot/core/prompts.py \
     apps/pipecat-daily-bot/bot/pipeline/builder.py \
     apps/pipecat-daily-bot/bot/bot_gateway.py \
     apps/interface/src/app/api/launchpad/lib/build-task-prompt.ts
   ```

4. Verify source/deploy copies still match for the gate-owned files:

   ```bash
   for f in \
     AGENTS.md \
     docs/qa/BUILD_RELEASE_WORKFLOW.md \
     docs/staging-handoff/PEARL_STAGING_BUILD_PUSH_GUIDE.md \
     scripts/qa-release-gate.sh \
     scripts/deploy-staging.sh \
     apps/pipecat-daily-bot/bot/pearl/context_loader.py \
     apps/pipecat-daily-bot/bot/core/prompts.py \
     apps/pipecat-daily-bot/bot/pipeline/builder.py \
     apps/pipecat-daily-bot/bot/bot_gateway.py \
     apps/interface/src/app/api/launchpad/lib/build-task-prompt.ts
   do
     cmp -s "/workspace/nia-universal/$f" "/home/deploy/pearlos/$f" || echo "MISMATCH $f"
   done
   ```

5. Decide what to do with the dirty tree before building. The preflight will not
   pass until blocked runtime/dev paths are handled.

6. Once the tree is safe and Codex has verified the release plan, build staging:

   ```bash
   PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='NEXT BUILD NAME' scripts/deploy-staging.sh
   ```

7. Verify public staging after the build:

   ```bash
   curl -k -fsS https://134-209-76-227.sslip.io/api/health/build
   scripts/verify-build.sh 'NEXT BUILD NAME' https://134-209-76-227.sslip.io
   ```

## User-Facing Rule For Pearl

Pearl must report exact state only:

- `queued`
- `fixed in source`
- `verified on staging`
- `live on prod`

She must not say `fixed`, `live`, `pushed`, or `deployed` from code inspection,
displayed JSON, or task completion messages alone. Live claims require runtime
health plus route/UI verification from the target environment.

## Do Not Miss This

There are extensive unrelated changes in the working tree. Work with them.
Do not revert them. Do not clean them destructively. The first job for the next
agent is to identify which changes are part of the intended release and which
are unrelated or generated artifacts blocking the gate.
