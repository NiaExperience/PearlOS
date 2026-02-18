# Interface Event System — Future Directions (AWS‑Aligned Planning)

Status: Draft

Owner: Jeffrey Klug  
Date: 2025-08-27 (AWS alignment revision)

This document lists forward‑looking experiments and enhancements for the Interface Event System, explicitly mapped to AWS services in our EKS environment. Not commitments; each item requires a sizing spike + cost/benefit review.

---

## 1) Orchestration overlays (client + cloud)

Client‑side:

- XState actors for complex domains (moderation, vote‑to‑remove) inside the worker; non‑blocking, chunk long work, timers delegated to engine.

Cloud augmentation:

- Evaluate AWS Step Functions (Express workflows) for multi‑step post‑session pipelines (e.g., final summary → sentiment → compliance check → persistence) triggered from EventBridge.
- Consider lightweight Lambda “decision lambdas” that consume EventBridge events to enrich or emit secondary topics back to clients (via WebSocket/API Gateway or polling endpoint) instead of inflating client actors.

Decision boundary: latency‑critical, user‑interactive loops stay in worker; multi‑minute or cross‑resource workflows move to Step Functions.

## 2) Cross-tab & cross-session collaboration

- BroadcastChannel mirroring (tab‑local) plus exploration of AWS API Gateway WebSocket or AppSync subscriptions for cross‑device / cross‑session real‑time events (e.g., host dashboard observing participant session topics).
- `tabId` envelope tagging + suppression to avoid duplicate processing.
- Always‑on timers owned by a “primary tab” elected via localStorage + heartbeat; future server fallback: a small coordinator service in EKS (or DynamoDB lease record) if multi‑browser reliability needed.

## 3) Client→server sinks expansion (EventBridge pipelines)

- Extend forwarding to multi‑bus strategy: keep `nia-interface-session` for session scope; add `nia-interface-analytics` bus for aggregated / transformed events.
- Use EventBridge Rules → SQS queue(s) → KEDA autoscaled consumers in EKS for burst smoothing (KEDA scales Deployments on SQS depth / CloudWatch metrics).
- EventBridge Pipes for direct filtering/enrichment (e.g., transform minimal envelope into analytics schema before SQS).
- Downstream fan‑out: SNS (multi protocol), Lambda, Step Functions, Firehose (to S3/Parquet/Glue catalog) for later Athena queries.

## 4) Observability & tracing (AWS native)

- Adopt AWS Distro for OpenTelemetry (ADOT) in browser exporting OTLP → collector (in EKS) → X-Ray + CloudWatch Metrics.
- Structured logs for `/api/events/forward` into CloudWatch Log Group with subscription filter → Lambda for PII redaction assurance sampling.
- Metrics: publish custom CloudWatch metrics (`EventsForwarded`, `ForwardFailures`, `DroppedClientEvents`) + dashboards (potentially Amazon Managed Grafana) with SLO burn‑rate panels.
- Explore CloudWatch Evidently (feature experiments) gating new topics or actor logic.

## 5) Replay, storage & analytics

- Short‑term client ring buffer remains local (IndexedDB).
- Server archival path (opt‑in topics) → Firehose → S3 (partition: `dt=YYYY-MM-DD/topic=`) with lifecycle to Glacier. Associated Glue table for Athena ad‑hoc queries (latency vs cost tradeoff).
- Consider DynamoDB for low‑cardinality counters (per session moderation stats) used in near real‑time dashboards; TTL for auto expiry.

## 6) Performance & adaptive backpressure

- Dynamic client rate adjustments fed by server hints: edge API responds with advisory budgets (events/sec by topic); client adapter updates drop/sample strategy.
- Server‑side: SQS buffering in front of heavy transforms; KEDA scales consumers; HPA fallback on CPU/latency.
- Evaluate ingestion move from Next.js route to API Gateway + Lambda if p95 latency / concurrency pressure rises (cost model comparison documented before switch).

## 7) Type & schema governance (platform integration)

- Source of truth registry persisted via DynamicContent; nightly job (Lambda in EventBridge schedule) generates openapi/JsonSchema bundle into S3 for codegen caching.
- Introduce schema evolution rules (no breaking removal without deprecation window); automated diff job posts to a Slack channel via Chatbot.
- Optional schema validation in Lambda (fast fail) using precompiled validators (AJV) loaded from S3.

## 8) UI state & server echo patterns

- Optional server “echo” for critical events (e.g., escalation acknowledged) published via EventBridge rule → WebSocket push (API Gateway) to confirm durable ingestion—only for reliability‑sensitive flows.
- Client reconciles echo vs local optimistic event ids; if mismatch, publishes correction topics.

## 9) Alternative hosts & hybrid execution

- Service Worker host (background timers); blocked by Next.js bundling complexity; revisit if persistent offline summarization needed.
- Edge compute (CloudFront Functions or Lambda@Edge) for lightweight mutation (header injection, coarse sampling) — probably overkill; track.

## 10) Security, privacy & compliance

- IAM least privilege: forwarding Lambda role limited to `events:PutEvents` on specific bus ARNs.
- All at‑rest storage (S3, DynamoDB) encrypted with KMS CMKs; payload redaction verified by periodic Lambda scanner (sample subset).
- Audit trail: EventBridge Archive (optional) for regulated topics; retrieval via Athena (cost gating!).
- Secret distribution (redaction patterns, quotas) via AWS Secrets Manager or SSM Parameter Store cached in edge API runtime.

## 11) Multi‑tenant & isolation

- Tenant scoping strategy options:
	- Single bus with `detail.tenantId` rule filtering (simplest).
	- Multiple buses per environment (cost vs isolation) if noise creates scaling hotspots.
- Consider per‑tenant SQS queue for high volume analytics -> isolates hot tenants; KEDA scales per queue.

## 12) Cost optimization levers

- Batch size tuning (target 5–10 events) to minimize PutEvents calls; log CloudWatch metric on batch fill ratio.
- Switch heavy batch transforms to Firehose when > N events/day threshold reached.
- Use EventBridge Archive only for compliance topics (flag in registry) to avoid blanket costs.
- DynamoDB adaptive capacity: keep hot partitions small by hashing `sessionId` with short prefix.

## 13) Resilience & failure drills

- Chaos tests: inject synthetic 5xx from edge API; verify breaker open rate and UI degradation path (drop not block).
- Regional outage simulation: plan multi‑region forwarding (secondary bus) only if scale justifies; initially single region.
- Dead letter: For critical topics add EventBridge Rule → SQS DLQ; monitor CloudWatch alarms for threshold breaches.

## 14) Tooling & developer ergonomics

- Dev panel: integrate CloudWatch metrics snapshot (signed URL or proxy) for forwarded counts.
- In-editor codegen watch (schema → types) using local cache with fallback to S3 manifest.
- CLI helper (Node) to validate new topic definitions against registry + produce diff summary.

## 15) Progressive rollout strategy

- Feature flags in DynamoDB / LaunchDarkly (current approach) toggle for cohorts; EventBridge forwarding canary (5%) → ramp.
- Automated rollback: CloudWatch alarm triggers Lambda to flip forwarding flag off if failure rate > threshold for X mins.

## 16) Open evaluation items

- When (if) to introduce server push channel (WebSocket) vs continue pull/poll for acknowledgements.
- Whether Kinesis adds enough value over EventBridge+SQS for analytical firehose (only if ordering/window aggregation becomes critical).
- Feasibility of using EventBridge Pipes for schema enrichment vs Lambda transform stage.

## 17) Initial AWS milestone candidates

- A: EventBridge → SQS → KEDA consumer POC (verify autoscale + latency).
- B: Step Functions Express workflow triggered by `session.summary.final` adding compliance enrichment.
- C: Firehose stream for anonymized analytics topics (cost + partitioning analysis).

---

All items to be revisited quarterly; remove, promote, or replace based on metrics & product needs.

