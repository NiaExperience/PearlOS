# Pearl Staging Build Push Guide

Last updated: 2026-05-25.

Use this when Pearl is pushing a new staging build on `pearl-staging-private-omega`.

## Non-Negotiables

- Source of truth: `/workspace/nia-universal`.
- Staging runtime tree: `/home/deploy/pearlos`.
- Do not edit code in `/home/deploy/pearlos`. Edit source, build source, then copy changed files forward.
- Run PM2 commands as `deploy` for staging interface/service processes.
- Do not claim a push worked until the live health endpoint and public chunk verifier pass.

## Preflight

```bash
hostname
cd /workspace/nia-universal
git branch --show-current
git status --short
su - deploy -c 'pm2 describe interface | sed -n "/status/p;/exec cwd/p;/script path/p"'
su - deploy -c 'pm2 list'
```

Expected staging basics:

- Host is `pearl-staging-private-omega`.
- Interface PM2 process is named `interface`.
- Interface PM2 cwd is `/workspace/nia-universal/apps/interface`.
- Pearl's House / Star Office is removed from this staging branch. Do not
  restore `/pearls-house` proxy rewrites or `star-office-state-sync` for
  GOLDEN CREEK-era builds.

If `interface` is missing or its cwd is wrong, recreate it from source:

```bash
su - deploy -c 'cd /workspace/nia-universal/apps/interface && pm2 delete interface || true'
su - deploy -c 'cd /workspace/nia-universal/apps/interface && pm2 start "npm start" --name interface --update-env && pm2 save'
```

## Build And Push

Always pass the intended codename. A build without an explicit codename is a
local unnamed build and must not be promoted to staging:

```bash
cd /workspace/nia-universal
PEARLOS_CODEX_VERIFIED=1 PEARLOS_BUILD_CODENAME='GOLDEN POND' scripts/deploy-staging.sh
```

`PEARLOS_CODEX_VERIFIED=1` is not a decoration. Set it only after Codex has
reviewed the fix and release plan against `docs/qa/BUILD_RELEASE_WORKFLOW.md`.
The staging deploy script runs `scripts/qa-release-gate.sh` before building and
will stop if Codex verification is missing.

If root ran the build, return generated files to `deploy`:

```bash
chown -R deploy:deploy apps/interface/.next apps/interface/src/build-info.json apps/interface/src/build-stamp.ts
```

Copy only changed source files to the deploy tree, preserving the same path:

```bash
cp apps/interface/src/path/to/file.tsx /home/deploy/pearlos/apps/interface/src/path/to/file.tsx
cp scripts/deploy-staging.sh /home/deploy/pearlos/scripts/deploy-staging.sh
```

Restart:

```bash
su - deploy -c 'pm2 restart interface --update-env && pm2 save'
```

Verify the changed file exists in both places and matches:

```bash
cmp -s /workspace/nia-universal/apps/interface/src/path/to/file.tsx /home/deploy/pearlos/apps/interface/src/path/to/file.tsx
```

## Build Verification

Read the expected codename from the compiled source stamp:

```bash
sed -n 's/^  codename: "\(.*\)",$/\1/p' apps/interface/src/build-stamp.ts
```

Then verify local and public build identity:

```bash
curl -k -fsS https://134-209-76-227.sslip.io/api/health/build
scripts/verify-build.sh "$(sed -n 's/^  codename: "\(.*\)",$/\1/p' apps/interface/src/build-stamp.ts)" https://134-209-76-227.sslip.io
```

The verifier must pass all three checks:

- `/api/health/build` reports the expected codename.
- The running build ID matches `.next/BUILD_ID`.
- The public JavaScript chunk contains the expected codename, proving browsers are not seeing stale chunks.
- No deprecated codename marker, currently `LAKE GLIMMER`, exists in the built chunks.

If the build name does not change, suspect wrong PM2 cwd, wrong PM2 owner, stale `.next`, a missed restart, or source/deploy drift.

## Agency Smoke Tests

Run these after any build that touches the desktop, Active Jobs, rewrites, or Agency:

```bash
curl -fsS http://127.0.0.1:3000/the-agency | head -c 120
curl -fsS 'http://127.0.0.1:4444/api/tasks?status=in_progress&limit=5'
curl -fsS 'http://127.0.0.1:3000/api/tasks?status=in_progress&limit=5'
```

Expected:

- `/the-agency` returns the Agency app.
- The bot gateway task endpoint returns JSON.
- The interface task proxy returns JSON with normalized `agentActivity` when active tasks have progress commentary.

If `/the-agency` loads but shows no live task data, verify the current Agency task-board path:

```bash
su - deploy -c 'pm2 describe pearl-worker'
su - deploy -c 'pm2 logs pearl-worker --lines 80 --nostream'
curl -fsS 'http://127.0.0.1:4444/api/tasks?status=in_progress&limit=5'
curl -fsS 'http://127.0.0.1:3000/api/tasks?status=in_progress&limit=5'
```

## Known Failure Modes

- Editing the deploy tree directly: the next source build overwrites it.
- Building from `/home/deploy/pearlos`: live PM2 may still serve source `.next`.
- Running PM2 as root on staging: `deploy` PM2 will not restart.
- Skipping chunk verification: `/api/health/build` can look right while browsers still load old JS.
- Reading `build-info.json` alone: compatibility JSON can look right while the compiled UI is old. Use `build-stamp.ts` and `scripts/verify-build.sh`.
- Worker or gateway task API drift: `/the-agency` loads, but progress is missing because `agent_activity` is not reaching `/api/tasks`.

## Done Means Done

Before reporting success:

```bash
curl -k -fsS https://134-209-76-227.sslip.io/api/health/build
scripts/verify-build.sh "$(sed -n 's/^  codename: "\(.*\)",$/\1/p' apps/interface/src/build-stamp.ts)" https://134-209-76-227.sslip.io
curl -fsS 'http://127.0.0.1:3000/api/tasks?limit=5'
```

Record what changed, which files were copied forward, which PM2 processes were restarted, and the smoke tests that passed.
