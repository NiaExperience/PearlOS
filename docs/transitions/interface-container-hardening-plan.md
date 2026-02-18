# Interface Container Hardening Plan

Last updated: 2025-12-14

Owner: Codex (AI pairing session)

## Objective
- Harden the `apps/interface` container so it builds, runs, and scans cleanly (zero HIGH/CRITICAL in Trivy) while serving the app correctly on its expected port.

## Scope
- `apps/interface/Dockerfile` and related build artifacts for the interface image.
- Build/run validation loop (Next.js production start) and Trivy scanning of the produced image.
- Target port: follow interface default (Next.js) and verify health/availability via HTTP.

## Out of Scope
- Feature code changes unrelated to container build/run/scanning.
- Helm/chart updates beyond what’s required for the container itself.

## Checkpoints
- **Checkpoint 1:** Baseline build/run/scan results captured.
- **Checkpoint 2:** Dockerfile/dependency hardening applied; rebuild/run/rescan.
- **Checkpoint 3:** Final clean run with zero HIGH/CRITICAL and documented commands.

## Validation Commands
- Build: `docker build -t interface:codex ./apps/interface`
- Run: `docker run -d -p 3000:3000 --name interface-test interface:codex`
- Health: `curl -f http://localhost:3000` (or `/health` if exposed)
- Scan: `trivy image --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1 interface:codex`

## Risks & Mitigations
- **Native deps (sqlite3, lmdb):** Ensure build deps pruned from runtime; keep runtime slim.
- **Env expectation:** Next.js may require PUBLIC env vars; provide safe defaults or document requirements.
- **Large node_modules:** Use multi-stage and prune dev deps to minimize surface area.

## Success Criteria
- Image builds successfully from repo root context targeting `apps/interface`.
- Container starts and serves the interface (HTTP 200).
- Trivy reports zero HIGH/CRITICAL without suppressing fixes.
