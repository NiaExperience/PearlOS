# Milestone 3 Plan

## Objectives
- Harden the websocket server for production: robust error surfacing, observability, and operational controls.
- Provide developer tooling (debug CLI, mock clients) to exercise the protocol locally and aid integrations.
- Prepare deployment artifacts and monitoring hooks for staging/production environments.

## Tasks
- **Operational Hardening**
  - Implement structured logging enrichment (request IDs, chunk metrics) and expose OpenTelemetry-compatible hooks.
  - Add Prometheus/StatsD-style metrics counters for active connections, chunks streamed, and error categories.
  - Surface Kokoro inference timing and queue depth; ensure thread executor usage does not starve event loop.
  - Support graceful shutdown: cancel in-flight synthesis, emit `finalOutput`/errors if closing.

- **Configuration & Secrets**
  - Introduce configuration file support (e.g., TOML/YAML) layered beneath env vars for deploy convenience.
  - Support rotating API keys and optionally stateless JWT auth for multi-tenant scenarios.
  - Add rate limiting knobs (per-connection chunk cap, global concurrency) using `asyncio.Semaphore` or FastAPI dependencies.

- **Developer Tooling**
  - Create a `scripts/ws_client.py` CLI to send sample text via websocket, inspect streamed audio, and measure latency.
  - Provide Postman/Insomnia collections or cURL snippets for handshake, streaming, and error cases.
  - Add optional text fixture support (e.g., random sentence generator) to stress auto-mode chunking.

- **Monitoring & Alerts**
  - Integrate health and readiness endpoints with expanded info (active connections, version hash).
  - Add log-based alerts for repeated engine failures or auth denials.
  - Document dashboards/alerting expectations (Grafana, CloudWatch) and provide seed queries.

- **Testing & QA**
  - Add load-test scenario using `pytest` async clients or `locust` harness to simulate streaming concurrency.
  - Write integration tests covering inactivity timeout, rate limiting, and error propagation with mocked failures.
  - Ensure deterministic seeds: when `seed` query param is provided, confirm repeated runs produce identical audio chunk sequences.

- **Deployment**
  - Provide Dockerfile / container image definition with sensible entrypoints.
  - Add GitHub Actions or CI workflow to run tests, lint, and optionally publish images.
  - Outline deployment playbook (config map env vars, mounting model/voice data, scaling considerations).

## Deliverables
- Extended FastAPI stack with metrics/logging hooks, rate limiting, and robust shutdown support.
- Developer utilities for local websocket testing and sample clients.
- Documentation updates covering configuration files, monitoring, and deployment steps.
- CI/CD pipeline or scripts to build and ship the service container.
- Milestone 3 checklist documenting completion status.
