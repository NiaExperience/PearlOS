# Enterprise Phase 0 Preflight Status - 2026-06-04

This is the current restore-first gate status for
`docs/PEARLOS_ENTERPRISE_PUBLIC_PEARL_PLAN.md`.

## Gate Summary

Staging/source is committed and restorable. Production is reachable and backed
up, but production is not clean or safely committable without a deliberate drift
reconciliation pass.

Do not begin Phase 0 implementation until one of these is true:

- production drift is reconciled into reviewed source commits and prod is clean,
  or
- Blair explicitly authorizes staging-only implementation while production
  remains dirty but backed up.

## Staging Evidence

- Host: `pearl-staging-private-omega`.
- Source tree: `/workspace/nia-universal`.
- Deploy/runtime tree: `/home/deploy/pearlos`.
- Latest pre-code source commit: `abdcba6f`.
- Source/deploy gate doc copy verified:
  `docs/staging-handoff/ENTERPRISE_PHASE0_RESTORE_AND_QA_GATE.md`.
- Staging backup root:
  `/workspace/backups/pearlos-enterprise-preflight-20260604-025258`.
- Staging backup artifacts verified:
  source/deploy code tarballs, git bundles, runtime metadata, Redis/local DB
  snapshots, env-file secure tar, and external review outputs.
- Live staging health at audit time:
  build codename `PUBLIC PEARL SEARCH PROFILE RESTORE`, commit `e4819a79`.

## Production Evidence

- Host: `pearlos-production`.
- SSH access: verified as `root` using the dedicated production key on staging.
- Production source tree: `/workspace/nia-universal`.
- Production pipecat deploy tree: `/opt/pearlos`.
- Production PM2 owner: `root`.
- Production backup root:
  `/workspace/backups/pearlos-production-preflight-20260604-031805` on
  `pearlos-production`.
- Production backup artifacts verified:
  `/workspace/nia-universal` code tarball, `/opt/pearlos` code tarball,
  env-file secure tar, git status/diff snapshots, PM2 metadata, Redis snapshot,
  and live health JSON.
- Production drift snapshot ref created with a temporary Git index:
  `refs/pearlos-backups/pre-enterprise-prod-drift-20260604`. This ref preserves
  the current production tracked drift plus the untracked OpenClaw sanitizer
  file without moving production HEAD, changing the working tree, or restarting
  services.
- Live prod health at audit time:
  build codename `DISCORD CONNECT CHANNELS`, commit `2c179711`.

## Production Drift Classification

Production source HEAD:

```text
2c17971171c4688db7159eedadee6e158b605361
```

Production source branch:

```text
Pearl-Staging-Private-Omega
```

Production source is still not clean:

- staged drift exists across interface and pipecat files
- unstaged drift exists in Discord routes, build-stamp files, OpenClaw runtime
  patch files, and generated bot tool manifest
- untracked files exist, including `abc.txt`, `list5282200`, and
  `openclaw-runtime-patches/discord-outbound-sanitizer.mjs`
- unresolved index entry exists for:

```text
apps/interface/src/build-info.json
```

The working file currently contains a valid build-info JSON for the live
`DISCORD CONNECT CHANNELS` build, but git still reports it as unmerged. The
drift snapshot ref above captures the current working-file state for restore,
but the production index should still not be resolved blindly.

## Why Coding Is Still Gated

The user requested that prod and staging be committed and restorable before any
coding begins. Restore evidence now exists for staging and production. Production
is restorable from verified backups and the dedicated drift snapshot ref, but the
production working tree remains dirty and should not be used as a development
workspace.

The next safe action is a production drift reconciliation pass:

1. Compare production source drift against current staging source.
2. Classify each changed file as code hotfix, generated build artifact,
   deploy/runtime artifact, backup/scratch file, or unknown.
3. Backport real production code hotfixes into `/workspace/nia-universal` source
   on staging.
4. Leave runtime/generated/scratch artifacts out of release commits.
5. Only after production-only fixes are captured in source should production be
   cleaned or committed, and only with explicit approval.

## Review Evidence Already Captured

Read-only reviews and advisory outputs are stored in the staging backup under:

```text
/workspace/backups/pearlos-enterprise-preflight-20260604-025258/external-reviews
```

Valid review evidence:

- Claude CLI source-grounded Phase 0 security review.
- Gemini security QA methodology through OpenRouter runtime credentials.
- Kimi adversarial stop/go review through OpenRouter runtime credentials.

The first direct env-file OpenRouter attempt failed authorization and should not
be treated as review evidence.
