# Mesh Container Hardening Plan

Last updated: 2025-10-28

Owner: Codex (AI pairing session)

## Objective
- Harden the `apps/mesh` container so it builds and runs cleanly on port 2000 and passes Trivy with zero HIGH/CRITICAL findings.

## Scope
- `apps/mesh/Dockerfile` and related build assets used by the Mesh server image.
- Runtime configuration needed for `npm start` inside the container (health endpoint on `/health`).
- Security fixes for base image and OS/package vulnerabilities that affect the Mesh image.

## Out of Scope
- Changes to other applications or Helm charts beyond what the Mesh image requires.
- Feature development unrelated to container build/run/scanning.

## Checkpoints
- **Checkpoint 1:** Baseline build/run/scan results captured (commands + failures noted).
- **Checkpoint 2:** Dockerfile and dependency hardening applied; rebuild/run/scan retested.
- **Checkpoint 3:** Final validation with clean Trivy results and documented commands.

## Test & Validation Strategy
- Build: `docker build -t mesh:codex ./apps/mesh`
- Run: `docker run -d --rm -p 2000:2000 --name mesh-test mesh:codex`
- Health: `curl -f http://localhost:2000/health`
- Scan: `trivy image --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1 mesh:codex`

## Risks & Mitigations
- **Base image CVEs:** May require bumping Node/Alpine; mitigate by pinning to patched versions and running `apk upgrade --no-cache`.
- **Runtime deps missing:** Removing build tooling could break start-up; validate by running container and health check after each change.
- **Secret/env assumptions:** Default envs may be missing; rely on safe defaults and document any required variables.

## Success Criteria
- Mesh container builds successfully from repo root context.
- Container starts and responds `{"status":"ok"}` on `/health` at port 2000.
- Trivy reports zero HIGH and CRITICAL vulnerabilities without suppressing fixes.
