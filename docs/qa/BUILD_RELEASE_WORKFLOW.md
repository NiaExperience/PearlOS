# PearlOS QA Build And Release Workflow

Last updated: 2026-05-27.

This is the required workflow whenever Pearl is asked to build, push, deploy,
release, or say a bug is fixed.

## Non-Negotiable Rule

Pearl may not say "fixed", "live", "deployed", or "pushed" until there is
runtime proof from the target environment. Code that looks right is not enough.
Displayed JSON alone is not enough. The running app, PM2 process, live health
endpoint, and user-facing route all have to agree.

## Trigger Words

Start this workflow when the user says any of:

- build
- push
- deploy
- release
- staging
- prod
- production
- fixed
- live
- new build name
- update the build

## Required Roles

- Pearl owns the conversation and user-facing status.
- Codex CLI is the required engineering verifier for code, config, deploy,
  staging, and production work.
- Claude or other agents may help, but they do not replace Codex verification.

Pearl must connect the work to Codex before a build starts. For staging deploys,
the shell gate enforces this with `PEARLOS_CODEX_VERIFIED=1`.

## Workflow

1. Record the bug or request.

   Use `docs/qa/BUG_TRACKER.md` or the active tracker. Include environment,
   reporter, symptoms, expected behavior, and the Discord source when available.

2. Dispatch or run the engineering work through the Agency.

   Code, config, file edits, runtime fixes, deploys, and logs go through
   `pearl-task-dispatch`. The expected verifier is Codex CLI.

3. Build only from source.

   Source of truth is `/workspace/nia-universal`. Never edit source files in
   `/home/deploy/pearlos` or `/opt/pearlos`.

4. Run the gate before staging build.

   ```bash
   cd /workspace/nia-universal
   PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='BUILD NAME' scripts/deploy-staging.sh
   ```

   The deploy script calls `scripts/qa-release-gate.sh` before the build starts.
   If Codex verification is missing, the build stops.

5. Verify the running target.

   For staging, the deploy script must pass:

   ```bash
   scripts/verify-build.sh 'BUILD NAME' https://134-209-76-227.sslip.io
   ```

   For production release candidates, run:

   ```bash
   scripts/prod-preflight-audit.sh
   ```

   Then follow `docs/production-release-workflow.md`.

6. Report status precisely.

   Say "queued", "fixed in source", "verified on staging", or "live on prod"
   only when that exact state is proven. If a step failed, say where it failed.

## Done Evidence

A fix is done only when the report includes:

- build name
- source commit
- target environment
- copied or deployed files
- services restarted
- live health endpoint result
- route or UI smoke test result
- remaining open risks, if any

Do not expose task IDs, run IDs, dispatch IDs, or internal hashes to users.
