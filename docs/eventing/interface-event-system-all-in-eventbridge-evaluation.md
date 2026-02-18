# Event System Architecture Evaluation — “All‑In EventBridge” vs Hybrid vs Full Local

Status: Draft
Date: 2025-08-28
Owner: Interface Platform
Related: `../transitions/eventing/interface-event-system-implementation-plan.md`, `interface-event-system-rfc.md`, `interface-event-topics-forwarding.md`

## 1. Why This Document

We have a mission‑critical requirement for extremely low and deterministic client‑side reaction latency (sub‑frame, sub‑10ms p95) to unlock adaptive UI, conversational flows, and future prompt shaping. The current richer plan (dedicated worker, ring buffer, policy runtime foundation, forwarding adapter) was questioned for complexity. This evaluation now re‑anchors on latency and future local policy agility as first‑order constraints, and reassesses whether we should: (A) stay the course (full local + forwarding), (B) adopt a slimmer “hybrid” stopgap, or (C) go “all‑in” on AWS EventBridge immediately. Given the clarified latency mandate, bias is intentionally toward the architecture that guarantees local determinism (Option A).

## 2. Option Overview

| Option | Label | Description | Primary Goal |
|--------|-------|-------------|--------------|
| A | Full Local + Forwarding | Worker engine (bus, ring, scheduling), local policy runtime (later), then forward to EventBridge | Rich local semantics & future policy runway |
| B | Hybrid Slim (Proposed Pivot) | Thin in‑thread (or lightweight worker) bus + small ring (debug/offline), batching + redaction + sampling; no complex policy yet | Fast delivery & cost/privacy guardrails |
| C | All‑In EventBridge | Client simply POSTs (maybe tiny queue) every event to edge → EventBridge; minimal local abstraction | Extreme simplicity & immediate central availability |

## 3. Evaluation Criteria

1. Latency for intra‑UI reactions
2. Offline / flaky network resilience
3. Developer ergonomics & debugging (replay/time‑travel)
4. Privacy & PII risk containment
5. Cost control (ingest + downstream processing)
6. Implementation speed (Phase 1)
7. Future extensibility (policies, prompt shaping, adaptive sampling)
8. Operational / vendor lock‑in risk

## 4. Option Profiles

### 4.1 Option A — Full Local + Forwarding (Current Plan)

Pros:

- Mission‑critical latency: deterministic <5ms p95 local event dispatch (worker isolation removes layout/GC jitter from handlers)
- Strong isolation (worker keeps heavy handlers off UI thread)
- Local policy/runtime runway (cooldowns, rate guards, shaping, prompt pre‑flight)
- Deterministic local replay (ring) & potential time‑travel debug
- Pre‑egress redaction & suppression reduces data surface
- Future adaptive / conversational features without network round‑trip
- Minimizes architectural rework later (no second migration to worker)
Cons:

- Higher initial complexity (protocol, buffering, governance code)
- Longer time-to-first-value vs minimal hybrid
- Larger maintenance surface (tests, debugging two execution contexts)
- Slight upfront perf cost to spin up worker (mitigated by lazy boot after first publish)

### 4.2 Option B — Hybrid Slim (Transitional Only)

Characteristics:

- Minimal in‑thread bus (GC + layout contention introduces tail latency)
- Small ring (N≈200) purely for dev panel + resend after reconnect
- Batching + sampling + registry‑driven redaction before POST
- Registry‑only policies (no dynamic rule logic / guards)
- Defers scheduling / deeper replay, no isolation boundary
Pros:

- Faster initial implementation (days vs weeks)
- Partial privacy & cost optimization retained (sampling + redaction)
- Lower initial cognitive load for contributors
Cons / Strategic Gaps:

- Latency nondeterministic under UI load (paint, large React commits)
- Future policy & adaptive flows require later migration (double work)
- Risk of silent regression when handler complexity grows (no isolation)
- Replay depth & debugging ergonomics limited
- Encourages direct imperative coupling (event abstraction erodes)

### 4.3 Option C — All‑In EventBridge

Pros:

- Conceptual simplicity (publish == POST)
- Immediate global availability for analytics & pipelines
Cons / Risks (High Severity for Latency Mission):

- Fails deterministic latency requirement (dependent on network + edge + EB path)
- Must rebuild minimal queue/batching anyway (negating simplicity claim)
- Intra‑UI reactive flows devolve into ad‑hoc direct calls (loss of unified model)
- Offline / flaky network increases complexity (retry, persistence)
- Cost amplification (egresses micro-events better kept local)
- Larger privacy blast radius (more raw data leaves browser)
- Debugging & iteration speed reduced (no local replay)
- Vendor lock‑in & rework later when local policy inevitably needed

## 5. Risk Comparison (Reframed Around Mission‑Critical Latency)

| Risk / Concern | A: Full Local | B: Hybrid Slim | C: All‑In EB |
|----------------|--------------|----------------|--------------|
| Deterministic sub‑10ms latency | YES (worker isolation) | PARTIAL (contention) | NO (network RTT) |
| Future policy extensibility | High (native) | Medium (migration) | Low (rebuild) |
| Over‑engineering | Moderate (justified by requirement) | Low | Very Low (but misaligned) |
| Privacy leakage scope | Low (pre‑egress filtering) | Low/Med | High |
| Network outage resiliency | High (local queue + ring) | Medium (small queue) | Low (needs added layer) |
| Cost control (filter locally) | High | Medium | Low |
| Time to first usable slice | Longer | Shorter | Shortest |
| Rework probability (12‑mo view) | Low | High | Very High |
| Vendor lock‑in amplification | Low (abstraction) | Med | High |

## 6. Privacy & PII Considerations

Simple outbound “strip a few fields” filtering is insufficient for sustained privacy posture. Required minimum (independent of chosen option):

- Registry‑anchored field classification (`piiLevel` + `redactionHint`)
- Deny-by-default for unknown topics & unexpected keys
- Hashing or truncation for sensitive identifiers (salt rotation server-side)
- Metrics: redacted field counts, unknown field occurrences
- Tests: golden input → expected redacted output

Option impacts:

- A / B: Redaction executed client-side before egress; fewer raw sensitive values transmitted.
- C: Stronger need for robust server-side sanitization + risk of irrecoverable leakage if POST happens before redaction.

## 7. Decision Matrix (Latency‑Weighted)

Weights shifted to reflect clarified priority: latency & future local policy runway.

| Criterion | Weight | A Score | B Score | C Score | Notes |
|-----------|--------|---------|---------|---------|-------|
| Deterministic latency | 0.25 | 1.0 | 0.6 | 0.1 | A isolates handlers; C depends on network |
| Future extensibility | 0.20 | 0.9 | 0.6 | 0.3 | A has built‑in worker + policy runway |
| Privacy posture | 0.10 | 0.9 | 0.8 | 0.4 | Local redaction earlier |
| Cost control | 0.10 | 0.8 | 0.6 | 0.3 | Filtering & sampling earliest |
| Rework avoidance | 0.10 | 0.9 | 0.4 | 0.2 | B & C require later migration |
| Offline resilience | 0.10 | 0.9 | 0.6 | 0.3 | A ring + queue; C minimal |
| Time to MVP | 0.08 | 0.5 | 0.9 | 1.0 | De‑emphasized vs latency |
| Complexity overhead | 0.07 | 0.45 | 0.8 | 1.0 | A invests more early |
| Vendor neutrality | 0.08 | 0.85 | 0.6 | 0.3 | A abstracts EB boundary |
| Weighted Total | 1.00 | 0.89 | 0.63 | 0.31 | Option A leads decisively |

## 8. Recommendation

Adopt Option A (Full Local + Forwarding) now. The decisive factor is guaranteed low, stable latency and eliminating a known future migration. The incremental calendar delay is outweighed by:

- Avoiding rework (one build, not hybrid then worker)
- Ensuring future adaptive/policy features plug into an already isolated execution lane
- Stronger privacy & cost controls before events ever leave the client
- Higher confidence in meeting UX/interaction SLAs from the outset

Mitigation of complexity risk: strict scoping (Phase 1 excludes advanced prompt shaping, dynamic sampling) + early performance micro‑benchmarks + incremental merges per workstream (see implementation plan Section 14).

## 9. Evolution Path (Post Option A Baseline)

| Trigger Signal | Action |
|----------------|--------|
| Need rapid rule iteration (no redeploy) | Enable CompositeRuleSource with RemoteHttpRuleSource (poll + ETag) |
| Desire instant propagation of policy tweaks | Add SSE/WebSocket push RuleSource (stream diffs) |
| Richer adaptive behaviors (contextual shaping) | Extend rule model (conditions, predicates) + guard metrics |
| Debugging requires > N events replay or time-travel | Add persistent ring (IndexedDB) & time-travel tooling |
| Cost spikes due to event volume | Adaptive sampling hints from server + dynamic rule refresh |
| Privacy review finds gap | Expand redaction taxonomy & hashed field coverage |
| Need cross-tab consistency | Introduce BroadcastChannel sync for active ruleset version |

## 10. Scope Affirmation (Phase 1 Option A)

In Scope:

- Worker engine (publish/subscribe, scheduling, ring buffer)
- Forwarding adapter (batching, sampling, redaction, circuit breaker)
- Policy runtime MVP (cooldown + action emission) – limited rule set
- Registry + codegen (topics, PII metadata, redaction map)
- Health & metrics (counters, latency, breaker state, ring stats)
- Feature flags (dry‑run forwarding, enable/disable worker)

Deferred:

- Advanced prompt shaping logic
- Dynamic server‑driven sampling adjustments
- Persistent storage (IndexedDB) for replay
- Cross‑tab synchronization
- Complex policy DSL editor / remote rule fetch
- Remote / dynamic rule loading (CompositeRuleSource & RemoteHttpRuleSource) — abstraction present in implementation plan; execution deferred

## 11. Minimal Technical Contract (Option A Snapshot)

Publish API:

```ts
publish<T>(topic: Topic, payload: T, meta?: Meta): void
```

Forwarder Envelope (batched):

```json
{
  "events": [ { "id": "uuid", "ts": "iso", "topic": "...", "payload": { ... }, "meta": { ... } } ],
  "client": { "appVersion": "x", "sessionId": "...", "nonce": "..." },
  "stats": { "redactedFields": 12, "sampledOut": 37 }
}
```

Health Snapshot (dev only):

```json
{ "queued": 3, "lastFlushMs": 142, "ringSize": 120, "breaker": "closed", "redactedFields": 58 }
```

## 12. Privacy Guardrails (Phase 1 Definition of Done)

| Guardrail | Mechanism | Test |
|-----------|-----------|------|
| Deny unknown topic | Codegen topic map, runtime lookup | Publishing unknown logs warning & drops |
| Redact high PII fields | Generated redaction function | Golden test fixtures per topic |
| No raw emails externally unless hashed | Regex + registry classification | Unit tests + lint rule |
| Sampling declared topics | `sampleRate` or `sampleEveryN` | Statistical test (±10% tolerance) |
| Metrics on redaction | Counter increment per removed field | Health endpoint assertion |

## 13. Open Questions

| Question | Proposed Handling (Phase 1) |
|----------|-----------------------------|
| Cross‑tab consistency | Ignore for now (per-tab state) |
| Persistence of unsent events | In-memory only (risk accepted) |
| Dynamic sampling adjustments | Static in registry (future server hints) |
| Hash salting strategy | Server rotates salt; client one-way hash optional |

## 14. Next Steps

1. Re‑affirm latency SLA (target p95 & p99 thresholds) and capture in RFC.
2. Kick off Workstreams REG, SDK, WKR, FWD in parallel (see implementation plan Section 14).
3. Land codegen + SDK fallback, then worker protocol skeleton.
4. Implement ring buffer + replay; add micro benchmark (baseline latency numbers).
5. Add forwarding adapter (default → sampling → redaction → breaker).
6. Integrate policy runtime MVP (cooldown + action emission) behind flag.
7. Ship to staging behind feature flags (dry‑run forwarding on initially).
8. Capture metrics for 1–2 weeks (latency, redaction counts, failure rates).
9. Decide on advancing prompt shaping & adaptive sampling based on metrics.

---
Feedback welcome; upon sign‑off we proceed with Option A implementation (plan already aligned).
