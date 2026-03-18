Objective
- Add a daily GitHub Action that builds all container images, scans with Trivy at CRITICAL/HIGH, and files one issue per unique vulnerability ID if no prior issue exists.

Scope
- New scheduled workflow in `.github/workflows/` with `schedule` + `workflow_dispatch`.
- Parallel jobs per image for isolated disk space: `nia-web-base`, `nia-dashboard`, `nia-interface`, `nia-mesh`, `pipecat-daily-bot`, `kokoro-tts`.
- Run Trivy with the same configuration as CI and store JSON outputs as artifacts.
- Aggregate job downloads artifacts, deduplicates vulnerabilities by ID, and files issues only if no issue already exists for that ID.
- Add a sample-only workflow mode that downloads a public Trivy JSON example and runs the aggregator in dry-run mode (no issues).

Files
- `.github/workflows/daily-image-scan.yml`
- `docs/transitions/daily-image-scan-plan.md`
- `scripts/security/trivy-issue-aggregator.mjs`

Tests
- Manual `workflow_dispatch` run after merge to validate build, scan, and issue creation.

Risks
- Scheduled workflow may lack required secrets (e.g., `NIAXP_PAT`) for private submodules.
- Disk pressure during Docker builds and Trivy scans on GitHub-hosted runners.
- Search-based dedupe depends on issue title convention.
- Sample input relies on the external report format remaining stable.

Success Criteria
- Workflow runs daily and on manual trigger.
- All target images build and scan.
- Issues are created only for new vulnerability IDs not previously filed.
