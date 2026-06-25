# Production Release Workflow

Prod should be a deploy target, not a development workspace. The goal is rapid
staging iteration with boring prod releases that do not leak runtime files or
overwrite working fixes.

## Current Prod Shape

- App domain: `app.pearlos.org`
- Prod host: `pearlos-production`
- Interface PM2 process runs from `/workspace/nia-universal-pearl-prod/apps/interface`
- Interface runtime/deploy root is `/workspace/nia-universal-pearl-prod`
- Pipecat gateway, runner, and queue worker run from `/opt/pearlos/apps/pipecat-daily-bot`
- Mesh runs from `/opt/pearlos/apps/mesh`
- #qa is handled through Pearl's normal Discord conversation path. No standalone
  QA watcher process is part of prod.
- PM2 owner on prod: `root`
- `/workspace/nia-universal` still exists on prod as a dirty checkout, but it is
  not the live interface cwd. Do not deploy there assuming it will affect
  `app.pearlos.org`.

## Coherent Target Shape

Prod should converge to one explicit release root plus separated config/data:

```text
/opt/pearlos/releases/<release-id>/   immutable app release extracted from Git
/opt/pearlos/current                  symlink to the active release
/etc/pearlos/                         prod env/config, never copied from staging
/workspace/user/                      user FileSpace data until a separate data migration
/root/.pm2/dump.pm2                   PM2 process list owned by root
```

All PearlOS repo-backed PM2 processes should run from `/opt/pearlos/current`
or a subdirectory below it:

- `interface`: `/opt/pearlos/current/apps/interface`
- `mesh`: `/opt/pearlos/current/apps/mesh`
- `pipecat-gateway`, `pipecat-runner`, `bot-queue-worker`, `pearl-worker`:
  `/opt/pearlos/current/apps/pipecat-daily-bot`
- repo-backed watchers/scripts: `/opt/pearlos/current`

Runtime services that are not repo releases, such as `pocket-tts`, may remain
global/system-level services, but they must be listed in the release manifest
with their health checks.

Until that migration is complete, treat the current split as intentional and
copy only scoped, reviewed files into the live target paths listed above.

## Release Rules

1. Build and test on staging first.
2. Promote a reviewed commit, not a dirty workspace.
3. Never deploy `.env*`, backups, logs, uploads, memory journals, task output, or local audit captures.
4. Edit prod source only for emergency hotfixes. Mirror every hotfix back into Git immediately.
5. For `/opt/pearlos` services, copy only changed approved source files from `/workspace/nia-universal` to the same path under `/opt/pearlos`.
6. Do not run `git reset --hard`, broad `rsync`, or whole-folder copies on prod while prod has uncommitted drift.

## Preflight

Run before every release commit or prod deploy:

```bash
scripts/prod-preflight-audit.sh
```

For a specific release range:

```bash
scripts/prod-preflight-audit.sh <base-commit> <release-commit>
```

The audit blocks runtime/dev paths and scans diffs for secret-looking strings.

## Staging Smoke Tests

Minimum checks before prod:

```text
/api/health/build reports the intended commit and codename
/api/notes/files unauthenticated returns 401
chat upload paths are user scoped
public task creation records tenant/user workspace_path
bot gateway health is OK
voice join works if voice code changed
```

## Prod Deploy

For interface-only changes:

```bash
cd /workspace/nia-universal
PEARLOS_BUILD_ID=<commit> PEARLOS_BUILD_CODENAME=<codename> npm run build --prefix apps/interface
install -m 0755 scripts/pearl-codex-sandbox /usr/local/bin/pearl-codex-sandbox
install -m 0755 scripts/pearl-claude-sandbox /usr/local/bin/pearl-claude-sandbox
install -m 0755 scripts/pearl-openclaw-sandbox /usr/local/bin/pearl-openclaw-sandbox
mkdir -p /usr/local/lib/pearl-cli
# If the host has the packaged Claude CLI, make it visible inside user sandboxes.
test ! -x /home/deploy/.claude/local/claude || install -m 0755 /home/deploy/.claude/local/claude /usr/local/lib/pearl-cli/claude
scripts/terminal-sandbox-smoke.sh
# Copy only the reviewed changed source files and built interface output into
# /workspace/nia-universal-pearl-prod before restarting.
pm2 restart interface --update-env
pm2 save
curl -fsS https://app.pearlos.org/api/health/build
```

For pipecat or queue-worker changes:

```bash
cd /workspace/nia-universal
cp apps/pipecat-daily-bot/<changed-file> /opt/pearlos/apps/pipecat-daily-bot/<changed-file>
pm2 restart pipecat-gateway --update-env
pm2 restart pipecat-runner --update-env
pm2 restart bot-queue-worker --update-env
pm2 save
```

Restart only the process whose code changed.

## Release Manifest

Record each prod deploy in the release notes or task summary:

```json
{
  "commit": "<sha>",
  "codename": "PEARL-PROD-YYYYMMDD",
  "deployedAt": "<utc-iso-time>",
  "sourceBranch": "Pearl-Staging-Private-Omega",
  "servicesRestarted": ["interface"],
  "smokeTests": ["health", "notes-auth", "bot-health"]
}
```

## Prod Drift Reconciliation

When prod is dirty:

1. Snapshot `git status --porcelain`, `git diff --stat`, PM2 cwd, and live build health.
2. Classify changed files as code hotfix, generated artifact, runtime state, backup, or unknown.
3. Backport code hotfixes into source commits.
4. Ignore or quarantine runtime/backup files.
5. Only after all prod-only fixes are in Git should prod be returned to a clean checkout.

## Deployment Coherence Migration

Use this sequence to make prod boring again:

1. Capture the current live state: PM2 JSON, live build health, service health,
   env/config file metadata, and hashes for every file that differs between
   source and the live target paths.
2. Preserve a rollback snapshot of `/workspace/nia-universal-pearl-prod`,
   `/opt/pearlos/apps/mesh`, `/opt/pearlos/apps/pipecat-daily-bot`, PM2 dump,
   and prod env/config files.
3. Reconcile prod-only code changes back into `/workspace/nia-universal` and
   push a reviewed release commit.
4. Build a release from that commit into `/opt/pearlos/releases/<release-id>`.
   Use Git as the source, not a dirty prod checkout.
5. Point `/opt/pearlos/current` at the new release.
6. Update PM2 cwd/script paths so repo-backed services all run from
   `/opt/pearlos/current`.
7. Restart services in dependency order: `mesh`, `interface`, then Pipecat and
   worker services that changed.
8. Verify `/api/health/build`, `/api/health`, protected unauthenticated `401`
   checks, login page load time, a signed-in PearlOS page, bot gateway health,
   voice join if voice changed, and one Notes/FileSpace smoke test.
9. Keep `/workspace/nia-universal-pearl-prod` as a rollback snapshot until the
   new release has survived QA, then retire it from PM2 entirely.
