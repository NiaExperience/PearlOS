# Interface Event Topics — External Forwarding Set (Dinner Facilitation Scenario)

Status: Draft
Date: 2025-08-27
Owner: Jeffrey Klug

Purpose: Define an initial broad (forward‑by‑default) set of Interface session topics appropriate for forwarding to AWS EventBridge in the "AI assistant facilitating a dinner with randos" workflow, while documenting which are sampled, conditional (redaction required), or denied (internal only).

## Principles

1. Forward state transitions, facilitation decisions, moderation, lifecycle, summaries, low‑rate analytics triggers.
2. Sample or aggregate noisy telemetry (engagement metrics, interim summaries) to cap volume.
3. Redact or hash fields carrying low PII; exclude high PII raw content until redaction confidence matures.
4. Deny purely local UX / high‑frequency / debug streams (typing, partial tokens, cursor, level meters) to preserve cost & clarity.
5. Make forwarding configuration data‑driven via `forwardingPolicy` (registry) instead of a static allow‑list.

## Taxonomy (Prefixes)

`session.*`, `participant.*`, `assistant.facilitation.*`, `conversation.*`, `moderation.*`, `analytics.*`, `experiment.*`, `notification.*`, `retention.*`, `replay.*`, `system.*`

## Forwarding Policies

| Policy | Meaning | Adapter Behavior |
|--------|---------|------------------|
| default | Forward every occurrence | Batch & send normally |
| sampled | Forward a subset (probabilistic or 1-in-N) | Adapter tags event with `sampleRate` & `sampled=true` |
| conditional | Apply redaction rules then treat as `default` | Redaction must succeed; else drop & count |
| deny | Never forward (internal only) | Filtered early (no batching) |

`sampleRate` (0<r<=1) or `sampleEveryN` (int) MAY be used; adapter records effective rate in meta.

## Forward‑By‑Default Topics (Concise Initial Baseline)

```text
session.lifecycle.created
session.lifecycle.started
session.lifecycle.ended
participant.lifecycle.joined
participant.lifecycle.left
participant.lifecycle.ejected
assistant.facilitation.roundStart
assistant.facilitation.roundEnd
assistant.facilitation.topicShift.approved
assistant.facilitation.nudgeIssued
conversation.segment.started
conversation.segment.ended
conversation.segment.summary.final
conversation.moderation.escalation.notice
moderation.safety.violationDetected
moderation.safety.violationCleared
```

## Sampled Topics (Potentially Noisy)

```text
conversation.segment.summary.interim   (sampled)
conversation.engagement.metricsSnapshot (sampled)
```

Suggested baseline sampling: interim summaries 1/N adaptive; engagement metrics every 60s or probability 0.2.

## Conditional (Redaction Required)

```text
(none for MVP)
```

```text
conversation.token.partial
conversation.typing.activity
participant.cursor.movement
audio.stream.levelMeter
debug.*
system.health.adapterDegraded
assistant.facilitation.topicShift.detected
assistant.facilitation.checkInRequested
conversation.moderation.participantMuted
```

## Registry Field Additions

Add / evolve topic registry fields:

| Field | Type | Purpose |
|-------|------|---------|
| forwardingPolicy | enum(`default`,`sampled`,`conditional`,`deny`) | Governs adapter decision (replaces boolean allow‑list) |
| sampleRate? | number (0<r<=1) | Probability of forwarding each event (if `sampled`) |
| sampleEveryN? | integer >=1 | Deterministic 1-in-N sampling alternative |
| redactionHint? | { remove?: string[]; hash?: string[] } | Guides conditional redaction; must succeed for `conditional` |

Backward compatibility: legacy `eventBridgeEgressAllowed` may be mapped -> `forwardingPolicy = default` (true) or `deny` (false) during migration.

## Example Registry Entries

### participant.lifecycle.joined (default)

```json
{
  "topic": "participant.lifecycle.joined",
  "version": "1.0.0",
  "description": "Participant enters session",
  "deliveryPolicy": "reliable",
  "bufferPolicy": "ring",
  "ringSize": 50,
  "piiLevel": "none",
  "forwardingPolicy": "default",
  "payloadSchema": {
    "type": "object",
    "required": ["participantId","sessionId","joinTs","source"],
    "properties": {
      "participantId": {"type":"string"},
      "sessionId": {"type":"string"},
      "joinTs": {"type":"string","format":"date-time"},
      "source": {"type":"string","enum":["invite","rejoin","auto"]}
    },
    "additionalProperties": false
  },
  "tags": ["lifecycle","participant"]
}
```

### conversation.engagement.metricsSnapshot (sampled)

```json
{
  "topic": "conversation.engagement.metricsSnapshot",
  "version": "1.0.0",
  "description": "Periodic engagement KPIs",
  "deliveryPolicy": "best-effort",
  "bufferPolicy": "last",
  "piiLevel": "none",
  "forwardingPolicy": "sampled",
  "sampleRate": 0.2,
  "payloadSchema": {
    "type": "object",
    "required": ["sessionId","windowSec","participants"],
    "properties": {
      "sessionId": {"type":"string"},
      "windowSec": {"type":"integer","minimum":5,"maximum":120},
      "participants": {"type":"array","items": {"type":"object","required":["id","speakingMs","turns","interruptions"],"properties":{"id":{"type":"string"},"speakingMs":{"type":"integer"},"turns":{"type":"integer"},"interruptions":{"type":"integer"}},"additionalProperties": false},"maxItems": 16}
    },
    "additionalProperties": false
  },
  "tags": ["analytics","engagement"]
}
```

<!-- Conditional example removed for MVP scope -->

## Adapter Behavior Summary

1. Load registry snapshot; build fast map `{topic => forwardingPolicy}` (and sampling config).
2. On publish: if `deny` → stop; if `conditional` → apply redaction; drop & count failures.
3. If `sampled`: apply probabilistic or deterministic test; annotate meta `{sampleRate, sampled}`.
4. Enqueue event; flush (priority topics immediate) using existing batching logic.
5. Metrics: increment `forwarded_total{topic}` or `suppressed_total{topic,reason}`.

## Governance & Observability

| Concern | Approach |
|---------|----------|
| Volume drift | Compare forwarded vs published counts (topic family) and alert on ratio spikes |
| Rule hygiene | Nightly job flags EventBridge rules targeting `deny` or deprecated topics |
| PII safety | CI lint verifies `conditional` topics include `redactionHint` & redactable fields present |
| Cost control | Adaptive sampling (tune `sampleRate` when forwarded volume crosses threshold) |
| Documentation | This file + generated dashboard from registry metadata |

## Migration From Boolean Allow‑List

1. Introduce new fields; map legacy `eventBridgeEgressAllowed=true` → `forwardingPolicy=default`.
2. Add linter to forbid new usage of legacy boolean after cutover date.
3. Remove boolean field once all topics migrated & codegen updated.

---
Feedback welcome; update alongside RFC & plan when policies evolve.
