# Notes Logging Migration Plan

## Objective
Complete structured logging migration for Notes feature by replacing `console.*` with message-first logger usage and aligning metadata with existing logging patterns.

## Scope
- In: `apps/interface/src/features/Notes/services/pdf-processor.ts`, `apps/interface/src/features/Notes/components/notes-view.tsx` (all remaining `console.*`).
- Out: New features, backend services, non-Notes components.

## Approach
1. Inventory remaining `console.*` calls and classify by context (info/debug/warn/error).
2. Replace with `log.<level>(message, metadata?)` using existing `getClientLogger('Notes')` instance; keep progress callbacks intact.
3. Ensure errors include `.message` and `.stack` when available; avoid PII.
4. Re-verify logging around fallback/OCR/render flows for readability and thresholds.
5. Keep formatting changes minimal (no unrelated refactors).

## Files to Touch
- `apps/interface/src/features/Notes/services/pdf-processor.ts`
- `apps/interface/src/features/Notes/components/notes-view.tsx`

## Tests / Validation
- Targeted lint: `npm run lint -- --filter notes` (or closest available lint scope) if present; otherwise `npm run lint` if time allows.
- Consider targeted unit/integration covering Notes logging paths if existing; otherwise sanity type check.

## Risks & Mitigations
- Risk: Over-logging sensitive data → ensure metadata only includes non-PII snippets and lengths.
- Risk: Behavior change if log functions throw → keep side-effects unchanged and avoid new branches.
- Risk: Missing logger import in components → verify logger available or add minimal import.

## Success Criteria
- Zero `console.*` remaining in scoped files.
- Logs are message-first with structured metadata where useful.
- No TypeScript errors from logger calls.
- Codacy analysis passes on modified files; lint/tests green as executed.
