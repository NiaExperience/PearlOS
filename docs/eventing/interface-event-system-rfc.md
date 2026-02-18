# RFC: Interface Event System & Behavior Layer

Status: Draft (Updated with RuleSource abstraction & Option A decision)
Date: 2025-08-28
Authors: Jeffrey Klug
Reviewers: (TBD)
Target Release: Phase 1 (Worker Engine + EventBridge Forwarding MVP)

## 1. Summary

Introduce an off‑main‑thread, typed event system (Option A: Full Local + Forwarding) for the Interface application backed by a Dedicated Worker, a governed Topic Registry, and a minimal outbound forwarding path to AWS EventBridge. Layer conversation behavior (Conversation Policy) and prompt shaping atop the event fabric. A `RuleSource` abstraction (static snapshot now, remote/Composite later) future‑proofs policy rule loading without refactoring the runtime. Provide a future‑proof dovetail to platform‑wide notifications and orchestration services without reworking feature emitters.

## 2. Motivation

Current feature code relies on ad‑hoc CustomEvents / direct callbacks that mix concerns, hinder replay/debugging, complicate facilitation logic, and make future platform egress costly. We need:

- Deterministic, typed pub/sub decoupling.
- Isolation from UI jank (worker host) for high‑rate inputs (voice / Vapi / timers).
- A governed contract for topics (shape, PII classification, buffering, egress eligibility).
- A rules & prompt layer that can evolve independently of feature code.
- A minimal, safe path to forward selected session summaries / escalations to the platform (EventBridge) now.

## 3. Goals (Phase 1)

- Dedicated Worker event engine (publish / subscribe / schedule / replay) with typed SDK.
- Topic Registry (JsonSchema + codegen) generating typed topics, forwarding & redaction metadata.
- Conversation Policy runtime MVP using static, code‑generated rules snapshot (no remote fetch yet) via `RuleSource` (static implementation only).
- Prompt Shaping plan (personas, templates, redaction) — implementation deferred but interfaces aligned.
- EventBridge forwarding adapter with forward‑by‑default `forwardingPolicy` (default | sampled | conditional | deny) via `/api/events/forward`.
- Developer tooling: basic counters + ring buffer replay + health metrics.

## 4. Non‑Goals (Phase 1)

- Full notifications system (email/SMS templates, user preference management).
- Durable server‑side event store or replay service.
- Cross‑tab mirroring (BroadcastChannel) – deferred.
- Service Worker host – exploratory only.
- Complex orchestration actors (XState) beyond initial evaluation.

## 5. Architecture Overview

```text
Emitters (Vapi, UI, Timers) -> Typed SDK (publish/on/schedule) -> Worker Engine (bus + buffer)
    -> UI subscribers / Feature stores
    -> Dev Replay Panel
    -> Egress Adapter (policy: default|sampled|conditional|deny) -> /api/events/forward -> EventBridge -> Downstream Targets
```

Key Properties:

- Transport‑agnostic API; Dedicated Worker baseline.
- Structured envelope `{id, ts, topic, payload, meta, source}`.
- Per‑topic delivery & buffering policies; ring buffer for replay.
- EventBridge forwarding non‑blocking, batched, rate limited, PII‑aware.

Terminology Note: "Events SDK" refers to the distributable `@nia/prism/core/events` package (planned path within `prism/src/core/events`) that presents the stable API surface; components like the worker engine, forwarding adapter, and policy runtime sit behind this boundary and can evolve without breaking consumers.

## 6. Components

| Component | Responsibility | Notes |
|-----------|----------------|-------|
| SDK (`@nia/prism/core/events`) | Type‑safe publish/subscribe + schedule + replay | React hooks wrapper `useBus()` |
| Worker Engine | Run bus off main thread; buffering, scheduling, ring replay | Dedicated Worker; IndexedDB (deferred) |
| Topic Registry | Governance (schema, PII, buffer, forwardingPolicy) + codegen | Single source for types & redaction |
| Conversation Policy | Rule evaluation -> action events | MVP uses static snapshot; dynamic loading deferred |
| RuleSource Abstraction | Supplies ruleset to runtime | Phase 1: `StaticCompiledRuleSource`; future: remote + composite |
| Prompt Shaping | Personas/templates/redaction hints | Deferred execution; metadata alignment only |
| Egress Adapter | Filter + redact + batch + forward allowed topics | `forwardingPolicy` drives behavior; circuit breaker |
| Edge API | Validate + rate limit + put events on EventBridge | 202 async contract |
| Observability | Counters, latency, error events, health() | `events.health()` + dev panel integration |

## 7. Topic Registry (abridged)

Fields: `topic, version, description, deliveryPolicy, bufferPolicy, ringSize?, rateLimitPerSec?, sampleEveryN?, piiLevel, redactionHint?, forwardingPolicy, sampleRate?, sampleEveryN?, payloadSchema, metaSchema?, tags[], deprecated?, aliases[]`.
Rules:

- Pattern validation for topic; semver versioning.
- ringSize required when `bufferPolicy=ring`.
- High PII + egress requires redactionHint.
- Codegen to TS types; runtime validation in dev builds only.

## 8. EventBridge Forwarding

Forward‑by‑default topics (session lifecycle, facilitation, moderation, summaries). Adapter consults per-topic `forwardingPolicy` (`default|sampled|conditional|deny`). Sampling reduces high‑volume analytics topics; conditional topics undergo redaction before enqueue. Circuit breaker prevents UI blocking on server faults. Server re‑validates policy, schema, and rate/PII constraints; rejects or accepts with 202 partial statuses.

## 9. Edge API Contract (excerpt)

- POST `/api/events/forward`
- Request JSON: `{ events: [ { id, ts, topic, payload, meta, schemaVersion } ], client: { appVersion, sessionId, tabId, nonce } }`
- Responses: `202` with accepted/rejected arrays; `400/401/403/413/429/500` error codes
- Server checks: schema, forwardingPolicy, quota, freshness (skew ≤2m), payload size \<=4KB
- EventBridge mapping: `detail-type = topic`, `source = nia.interface`, `time = ts`

Full details live in `../transitions/eventing/interface-event-system-plan.md` (Edge API contract section).

## 10. Conversation Policy (Rules Layer)

- Declarative rules: `when` (topic + predicates) + `guards` (cooldown, rate, quorum) + `then` actions (publish, schedule, mask, delegate, set-flag).
- Layered resolution precedence (future): User > Feature > Assistant > Tenant > Platform (Phase 1 only uses a single static compiled layer).
- Rule loading via `RuleSource` abstraction (Phase 1: static snapshot; remote polling / push sources deferred).
- Observability: per-rule match counters, latency, action audit (Phase 1 minimal counters only).
- Pre-publish validation via Dashboard / codegen pipeline ensures schema & guard correctness (dynamic authoring deferred).

### 10.1 Rule Loading Strategy

Phase 1 builds a generated (code‑compiled) rules snapshot consumed by `StaticCompiledRuleSource`. The runtime depends solely on the `RuleSource` interface, enabling later introduction of:

- RemoteHttpRuleSource (poll + ETag) for rapid experimentation.
- PushRuleSource (SSE/WebSocket) for immediate propagation.
- CompositeRuleSource (baseline + overlay with version/hash arbitration).

Deferring dynamic loading avoids startup latency and extra failure modes while keeping migration cost near zero.

## 11. Prompt Shaping (Planning Alignment)

- Personas, templates, summary assembly, redaction guidance.
- Policy actions may emit events that trigger prompt regeneration; bus ensures decoupling.
- Redaction hints reused by egress adapter.

## 12. API Surface (Illustrative)

- `events.publish<Topic>(topic, payload, meta?)`
- `events.on(topic, handler)` / `once` / `off`
- `events.schedule({ id, at?, intervalMs?, jitterMs?, topic, payload? })`
- `events.replay({ topic?, since?, limit? })`
- `events.health()`

## 13. Observability & SLOs (Phase 1 Targets)

| Metric | Target |
|--------|--------|
| Publish→Handler p50 | < 8 ms (in-session) |
| Publish→Handler p95 | < 30 ms |
| Dropped events (allowed topics) | < 0.5% under normal load |
| Forward latency (batch dispatch) | < 500 ms p95 |
| Worker CPU (median session) | < 10% of a core |

Error Budget: < 5 consecutive forwarding failures before breaker open; reopen after exponential cool‑down.

## 14. Security & Privacy
 
- PII classification per topic; high PII blocked from forwarding unless redacted.
- Client redaction executed pre-forward; schema marks redaction fields.
- Idempotency: `{sessionId, event.id}` cached 2m server side.
- Strict same-origin; no third-party calls.

## 15. Migration Plan

1. Define registry + generate types (topics, redaction, forwardingPolicy) + codegen baseline rules snapshot.
2. Implement worker engine + SDK; migrate initial emitters (e.g., session lifecycle, Vapi stream subset).
3. Add ring replay panel + basic counters.
4. Enable EventBridge forwarding (dry‑run → live) for baseline topics.
5. Introduce Conversation Policy runtime with static snapshot (latency & cooldown test cases).
6. (Deferred milestone) Add optional RemoteHttpRuleSource behind flag once value pressure appears.
7. Integrate prompt shaping triggers (post‑baseline) as separate feature gate.

## 16. Alternatives Considered
 
- RxJS bus: higher cognitive load, bundle weight, operator misuse risk.
- In-thread bus first: adds rework when moving to worker; merged into single step.
- SharedWorker host: Safari/iOS reliability issues.
- Direct SNS/SQS: EventBridge affords flexible routing/rules without topic explosion or early schema rigidity.

## 17. Open Questions

- Cross-tab ownership for timers (primary tab election) – needed now or later?
- Required retention duration vs count for ring buffer (current: count). Time-based window?
- Are sampling rates sufficient for engagement metrics vs raw volume? Any topics needing upgrade from sampled → default?
- Need for lightweight server-side redaction audit logging now vs defer.
- Trigger criteria for enabling remote rule loading (rule churn threshold? ops SLA?).
- Versioning convention for ruleset (semver vs timestamp) to arbitrate Composite sources.

## 18. Success Criteria (Phase 1 Acceptance)
 
- No user-visible regressions in migrated features.
- <1% increase in dropped frames / input lag metrics under Vapi stress vs control.
- Replay panel surfaces last N (configurable, default 200) events correctly after reload.
- Forwarded events appear in EventBridge with correct envelope mapping; zero high-PII leakage in spot checks.
- Conversation Policy can trigger at least one autonomous interrupt + one escalation under test fixtures.

## 19. Future Directions (Pointers)

See `interface-event-system-future-directions.md` (XState actors, BroadcastChannel, expanded routing, deeper telemetry, Service Worker exploration, dynamic rule loading via Remote / Push / Composite `RuleSource`).

## 20. Rollout & Flag Strategy
 
| Flag | Scope | Purpose |
|------|-------|---------|
| `eventBus.enabled` | session | Enable worker engine + SDK routing |
| `eventBus.replayPanel` | user/dev | Toggle dev replay UI |
| `eventBus.forwarding` | env / cohort | Allow EventBridge adapter flush |
| `policy.rules.enabled` | session | Run Conversation Policy evaluation |
| `prompt.shaping.experimental` | user | Enable prompt shaping triggers |

## 21. Glossary (Non‑obvious Terms)

| Term | Plain Explanation | Why It Matters Here |
|------|-------------------|---------------------|
| Emitter | Any source that produces events (UI feature code, Vapi bridge, timers) | Defines the entry points into the event fabric |
| Envelope | Standard wrapper `{id, ts, topic, payload, meta, source}` around every event | Enables uniform routing, validation, replay, and forwarding to EventBridge |
| Topic | Hierarchical string name (e.g. `session.summary.final`) identifying event semantic | Drives subscription filtering, governance policies, and routing rules |
| Topic Registry | Authoritative catalog of topics + schemas + policies | Enforces typing, PII classification, egress eligibility, buffering rules |
| Ring Buffer | Fixed-size circular in‑memory (or IndexedDB backed) store retaining the last N events | Supports replay/dev debugging without unbounded memory growth |
| Buffer Policy | Per-topic rule: keep none, last only, or a ring (N) of events | Controls memory usage & replay granularity per topic |
| Backpressure | Strategies (drop, sample, ring) to avoid overload when events spike | Prevents UI jank and memory bloat under bursty sources |
| Event Edge (Worker) | Dedicated Worker hosting the local bus/scheduler | Isolates high‑rate processing from main thread, normalizes envelopes |
| Forward Adapter | Client component that filters, redacts, batches, then POSTs events to `/api/events/forward` | Bridges in‑session events to EventBridge reliably and safely |
| EventBridge Rule | AWS pattern filter + target configuration triggered by forwarded events | Decouples downstream actions (Lambda, Step Functions, SQS) from client logic |
| Circuit Breaker | Client-side guard that halts forwarding after repeated failures then retries later | Protects UX from persistent server issues |
| Redaction Hint | Schema annotation guiding which payload fields to remove or hash before forwarding | Ensures only privacy‑safe data leaves the session context |
| PII Level | Classification: none / low / high (sensitivity of topic payload) | Governs eligibility for forwarding and logging behavior |
| Replay Panel | Developer UI to inspect recent events from ring buffer | Accelerates debugging & policy test iteration |
| Guard (Policy) | Constraint (cooldown, rate limit, quorum) attached to a rule | Prevents runaway or noisy automated actions |
| Action (Policy) | Effect triggered by a matched rule (publish, schedule, mask, set-flag, delegate) | Mechanism by which policies influence system behavior |
| Schedule | Timer setup: delayed or periodic future emission of a topic | Enables periodic tasks (ticks, reminders) off main thread |
| Health Endpoint (`events.health()`) | Diagnostics snapshot counters & adapter state | Observability hook for tests and UI instrumentation |
| Forwarding Policy | Per-topic setting: default (always), sampled, conditional (redact then forward), deny | Governs adapter filtering & downstream volume |
| Idempotency (Forwarding) | Dropping duplicate event id+session combinations server-side | Prevents double-processing if client retries |
| Batch Flush | Sending accumulated events in one request when size/time threshold reached | Minimizes network overhead & PutEvents cost |
| Shadow Rule | EventBridge rule duplicating an existing route for testing | Enables safe deployment / comparison of new downstream logic |
| Orphan Rule | EventBridge rule referencing deprecated or removed topic | Target for cleanup; reduces noise and cost |
| Dead Letter Queue (DLQ) | SQS queue capturing failed target deliveries | Reliability surface for investigation & replay |
| KEDA | Kubernetes Event-Driven Autoscaling for EKS | Dynamically scales consumers based on SQS/Event metrics |
| Step Functions (Express) | AWS state machine for short-lived workflows | Chains multi-step enrichments post-forwarding |
| Sampling (Analytics) | Selecting subset of high-volume events (e.g., every Nth) | Controls costs while preserving statistical signal |
| ClientTs | Original client timestamp copied into forwarded detail | Allows end-to-end latency calculations in the platform |
| Governance (Topics) | Process + tooling ensuring schema, deprecation, and PII policies are enforced | Maintains consistency & safety as system scales |
 
- Full plan: `../transitions/eventing/interface-event-system-plan.md`
- Conversation Policy plan: `conversation-policy-plan.md`
- Prompt Shaping plan: `prompt-shaping-plan.md`
- Future directions: `interface-event-system-future-directions.md`
- Forwarding topic policies: `interface-event-topics-forwarding.md`

---
Feedback welcome; propose sign-off after initial spike validates latency & forwarding metrics.
