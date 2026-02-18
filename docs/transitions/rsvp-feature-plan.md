# RSVP Feature — Plan (Historical Canonical)

This document preserves the original RSVP feature planning content. It has been superseded by the implemented UserProfile feature. See the UserProfile Focus Doc at `../user-profile.md`.

---

## RSVP Feature Plan

Date: 2025-09-11  
Current branch: staging-jk-followup3  
Target branch (merge): staging

## 1) Objective

Add a new Interface feature “Rsvp” that lets the AI assistant collect and persist RSVP details from a user via voice/tool calls. Data is stored as a new Prism content type `Rsvp`.

## 2) Scope

In-scope:

- New Interface feature folder `Rsvp` with canonical structure (actions, routes, definition, tests, barrel).
- New content type `Rsvp` with fields:
  - first_name: string
  - pronouns: string[] (optional)
  - email: string
  - avg_day: string
  - earliest_tech_memory: string
  - world_change: string
- New tool function contract `saveRsvp` (with serverUrl) for AI invocation.
- API route + server action to persist `Rsvp` via Prism with a minimal indexer.
- Feature flag `rsvp` (default on) and dual gating (command-time; render-time N/A since no UI view).
- System prompt addition in `docs/functional-prompt-reference.txt` to instruct the agent how to recognize intent and call `saveRsvp` with clarifying questions when needed.
- Unit + integration tests (happy + edge); redaction in logs.

Out-of-scope (this iteration):

- UI list/detail of RSVPs beyond a success confirmation message.
- Cross-app dashboard and analytics.
- New event topics (avoid until needed).

## 3) Assumptions

1. Interface feature code saves to Prism with available tenant context (parent_id) from session.
2. System prompt reference at `docs/functional-prompt-reference.txt` is included by the AI runtime; we will add a new “BEGIN RSVP” section.
3. Email is required; pronouns is optional.
4. No schema migration needed outside the feature-local content definition.

## 4) Requirements Checklist

- [ ] Introduce `Rsvp` content type with required fields and indexer.
- [ ] Add `saveRsvp` tool contract with serverUrl and parameter validation.
- [ ] Add API endpoint `/api/rsvp` wired to feature route (POST).
- [ ] Implement server action to validate, normalize and persist via Prism.
- [ ] Add feature flag `rsvp` with default true and command-time gating.
- [ ] Extend functional prompt reference with “BEGIN RSVP” section.
- [ ] Tests: unit (validation/normalization), integration (POST handler), and feature flag gating path.
- [ ] Redact PII (email, first_name) in logs; no raw payload logs.

## 5) Contracts (APIs, Tool)

Tool: `saveRsvp`

- name: `saveRsvp`
- description: Save RSVP details for the user
- serverUrl: `/api/rsvp` (POST)
- parameters (required unless noted):
  - first_name: string
  - pronouns: string[] (optional)
  - email: string (must contain `@`)
  - avg_day: string
  - earliest_tech_memory: string
  - world_change: string
  - userRequest: string (full original user utterance)

HTTP API: `POST /api/rsvp`

- Request body: matches parameters above.
- Response: `{ ok: true, id: string }` or `{ ok: false, error: string }`.

## 6) Data Model (Prism ContentDefinition)

Type: `Rsvp`

- content: the full payload per fields above
- indexer: `{ email: string, firstName: string, ts: number }`
- parent_id: tenantId (multi-tenant ownership)

Validation/Normalization:

- Required: first_name, email, avg_day, earliest_tech_memory, world_change
- email must include `@`
- pronouns: normalize to array of strings (split on comma/space if single string provided)

## 7) System Prompt Addition (functional-prompt-reference)

Add a new section to `docs/functional-prompt-reference.txt`:

- Header: `=== BEGIN RSVP ===` ... `=== END RSVP ===`
- Trigger phrases: e.g., “I’d like to RSVP”, “save my RSVP”, “sign me up”, “record my details”.
- Behavior:
  - Use `saveRsvp` with provided fields.
  - If required fields are missing, ask concise follow-up questions to fill them.
  - Always include `userRequest` verbatim.
  - Respond naturally on success (e.g., “Saved your RSVP.”).
- Examples:
  - Single-turn with all fields.
  - Multi-turn where email or avg_day is asked and then saved.

## 8) Architecture & Boundaries

- Feature lives at `apps/interface/src/features/Rsvp/` and exposes a minimal barrel.
- No cross-feature deep imports. Use Prism for persistence.
- No server code imported into client components; API route re-exports from feature `routes`.
- No events emitted initially (skip descriptor/redaction overhead for now).

## 9) File/Module Impact

- apps/interface/src/features/Rsvp/
  - definition.ts (ContentDefinition for `Rsvp`)
  - actions/rsvp-actions.ts (validation + persist via Prism)
  - routes/route.ts (export `POST_impl`)
  - __tests__/rsvp-actions.test.ts (unit)
  - __tests__/rsvp-integration.test.ts (integration)
  - index.ts (barrel: export minimal public surface)
- apps/interface/src/app/api/rsvp/route.ts
  - `export { POST_impl as POST } from '@/features/Rsvp/routes/route'`
- apps/interface/src/actions/getAssistant.tsx (or functions registry)
  - Register `saveRsvp` with schema + serverUrl
- apps/interface/src/components/browser-window.tsx
  - Add command-time handler branch for `saveRsvp` with feature-flag guard and user feedback
- apps/interface/src/features/feature-flags.ts
  - Add `rsvp` key, default true, map to `isFeatureEnabled('rsvp')`
- docs/functional-prompt-reference.txt
  - Add “BEGIN RSVP” section

## 10) Test Strategy

Unit tests:

- validateAndNormalize: catches missing/invalid fields; normalizes pronouns array.
- action persist: sets indexer, uses tenantId, returns saved id.

Integration tests:

- POST /api/rsvp happy path → `{ ok: true, id }`
- Missing required field → 400 with clear error
- Feature flag disabled → BrowserWindow handler responds with disabled message, no API call

Performance: N/A (simple single-row write).

## 11) Observability

- Structured logs with redaction:
  - action: "rsvp.save", tenantId, requestId/callId, ok, errorCode (if any)
- No metrics added in this iteration (optional follow-up).

## 12) Security & PII

- Do not log raw email or first_name; redact as `***`.
- Validate all inputs on server; never trust client/tool blindly.
- No secrets added; no external deps.

## 13) Feature Flag & Rollout

- Flag: `NEXT_PUBLIC_FEATURE_RSVP` (default on)
- Command-time gating in handler; render-time gating N/A (no UI view added yet)
- Rollback: disable flag or revert route binding.

## 14) Risks & Mitigations

- PII leakage → Strict redaction + tests.
- Partial data from model → Prompt clarifications + server validation errors.
- Schema drift → Keep definition local; stable field names.

## 15) Success Criteria

- Model recognizes RSVP intent and calls `saveRsvp`.
- Required fields validated; clarifications asked when missing.
- Data persisted with correct type/indexer/tenant ownership.
- Tests (unit+integration) pass; no PII in logs.

## 16) Open Questions

- Should `pronouns` be required? (Assume optional.)
- Any additional indexer keys desired (e.g., createdBy userId)? (Assume email/firstName/ts sufficient.)
- Any immediate UI surfaces needed? (Assume not in this iteration.)

## 17) Implementation Steps (after approval)

1. Scaffold feature folder and content definition.
2. Implement validation/normalization and persist action; add route.
3. Register tool in assistant functions; add handler (command-time guard).
4. Add RSVP system-prompt section to functional reference.
5. Add/Run tests (unit + integration). Run lint/type/tests; fix issues.
6. Prepare PR with diff stats, divergence status, risks/mitigations, and test evidence.
