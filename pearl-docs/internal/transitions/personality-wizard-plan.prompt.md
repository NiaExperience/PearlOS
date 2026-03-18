# Personality Wizard Plan

## Objective
Design and implement a personality authoring wizard in the Dashboard admin Personalities page that structures prompts into PERSONALITY, RULES, SEQUENCE LOGIC, PRIMARY OBJECTIVE, and BEAT 1..n sections, supports import/parse of existing prompts, AI-assisted review/edit, and saves back to the personality record while preserving existing raw edit flows.

## Scope
- Dashboard admin Personalities page: add a "Wizard" entry point and modal/page for guided authoring.
- Wizard features: sectioned editors, beat management (add/remove/reorder), import parser, serialized preview/export, AI review loop, diff/accept/reject, save back to personality.
- Persistence via existing personality CRUD endpoints; no backend schema changes anticipated.
- Assume OPENAI_API_KEY available server-side for AI review endpoint.
- Update Tiltfile/dashboard secrets to surface OPENAI_API_KEY for local preview of AI review flow.
- We're only interested in creating the personality prompt text.  Although Personality records also employ a 'beats' system which is integrated with the pipecat-daily-bot flow manager, we are NOT authoring those in this work.  The beats created in the wizard are only for prompt structuring and do not need to be synchronized with the bot flow manager.

## Non-Goals
- Changing personality storage schema or assistant composition logic.
- Building a full WYSIWYG editor; keep to structured text + textarea controls.
- Model selection or key management UI.

## Current State (from repo recon)
- Personalities page lives under `apps/dashboard/app/(authenticated)/admin/personalities/page.tsx` → client component `components/admin/personalities/PersonalityPageClient.tsx`.
- UI uses shadcn/radix Dialog for history modal; header has Create/Refresh; detail panel contains Primary Prompt textarea and beats list; history diff modal exists.
- API routes for personalities in `apps/dashboard/app/api/personalities/[id]/route.ts` and `.../route.ts` for list/create, plus clone route. Personality model includes `prompt`, `beats`, history.
- Assistant UI composes system prompts using personality + functional prompts; modal patterns available in `components/admin/assistants/PersonalityPickerDialog`.

## UX Plan
- Add a "Wizard" button alongside Create/Refresh (or in detail panel header) opening a modal dialog sized for editing.
- Wizard layout:
  - Tabs or sections stacked: PERSONALITY, RULES, SEQUENCE LOGIC, PRIMARY OBJECTIVE, Beats list.
  - Beats list: each beat has title (auto "BEAT n"), goal text textarea, optional guidance for tool calls; allow add/remove/reorder.
  - Live preview panel shows serialized output with `===` separators.
  - Import raw prompt: paste existing text → parse into sections/beats.
  - Inline beat reference highlighting: within section text, detect tokens like "BEAT 3" and render dropdown selector to relink; store as structured references and re-render as text on export.
- Footer actions: Close (cancel), Save (serialize to prompt + persist), Review with AI (opens review flow), maybe Copy Preview.

## Data Model (wizard state)
```
{
  personality: string,
  rules: string,
  sequenceLogic: string,
  primaryObjective: string,
  beats: Array<{ id: string; title: string; goal: string; toolCallHint?: string }>,
  imports: { raw?: string, parseErrors?: string[] },
  aiReview?: { status, diff, explanation, revisedPrompt }
}
```

## Parsing & Serialization
- Import parser: split on `===` boundaries; recognize headers (case-insensitive) PERSONALITY, RULES, SEQUENCE LOGIC, PRIMARY OBJECTIVE, BEAT <n>. First unnamed block → PERSONALITY.
- Beats: capture order; allow arbitrary count.
- Inline beat references: regex `\bBEAT\s+(\d+)\b`; track as links for dropdown rendering. When serializing, render as text "BEAT X".
- Serialization: emit blocks in order with headings and `===` separators. Beats labeled `// BEAT n:` or `BEAT n:` followed by text.

## AI Review Flow
- Trigger from wizard footer: compile current serialized prompt plus guidance appendix:
  - Author rules: one goal per beat; clear transitions; numbered beats; no missing sections; include PERSONALITY/RULES/SEQUENCE/OBJECTIVE.
  - Tool appendix: include known dashboard bot tools + parameters if available (fetch from existing config or static list placeholder).
  - Request LLM to return edited prompt (same section structure) and bullet explanation of changes.
- API: create a dashboard route (e.g., POST `/api/personalities/wizard/review`) using OPENAI_API_KEY server-side. Input: serialized prompt + guidance + tools. Output: { revisedPrompt, explanation }.
- Client UI: show explanation and a diff (colored) between current and revised; offer Accept (replace wizard state via import parser) / Reject (discard).

## Integration with Personality CRUD
- On Save/Close: serialize wizard state to prompt text and beats array; call existing PUT `/api/personalities/[id]` to update `prompt` and `beats` fields. Maintain history as is.
- Keep raw editing textarea available; wizard operates on selected personality record.

## Component/Implementation Plan
1. **Trigger & Modal Shell**: Add Wizard button to personalities page header; create `PersonalityWizardDialog` component using shadcn Dialog; pass selected personality data.
2. **State & Hooks**: Build hook to manage wizard state, parsing, serialization, diffing.
3. **Import/Parse UI**: Textarea or file drop to import existing prompt; show parse errors and parsed section previews.
4. **Section Editors**: Inputs for personality/rules/sequence/objective; inline beat reference dropdown renderer inside text areas (chip markers or popovers on detected tokens).
5. **Beats Manager**: List with add/remove/reorder, per-beat textarea, optional tool-call hint field and single-goal reminder.
6. **Preview**: Read-only pane showing serialized prompt with separators.
7. **AI Review**: Button launches call; show spinner; render explanation + diff; Accept/Reject updates state.
8. **Persistence**: On Save, serialize and call existing update API; refresh page state.
9. **Testing**: Unit tests for parser/serializer, beat detection, AI review request/response handling; integration test for import→edit→save happy path (if feasible with msw/mocks).

## Testing, local
- Add OPENAI_API_KEY to dashboard Tiltfile secrets so local Tilt flows can hit AI review.

## Open Questions / Risks
- Source of authoritative tool metadata for appendix; may need stub or minimal list.
- Large prompts/diffs: ensure diff component can handle size; maybe limit height with scroll.
- Error handling for AI review (timeouts, rate limits). Add retry/toast.
- i18n not in scope; keep copy minimal.

## Delivery Checkpoints
- Parser/serializer ready with tests.
- Wizard UI scaffold with import/preview, beats CRUD.
- AI review API + client flow with diff preview and accept/reject.
- Save integration with existing personality update API.
- UX polish and docs.

## Status (2025-12-11)
- Wizard dialog, import/preview, beats CRUD, AI review flow, and save integration are complete and shipped (`personality_wizard_dialog.tsx`, `wizard_logic.ts`, `personalities_client.tsx`).
- Parser/serializer, AI review handler, and dialog behaviors are covered by unit tests; dashboard personality CRUD integration verified via happy-path integration test.
- Secrets wired for local, staging, and production (OPENAI_API_KEY) to support the AI review endpoint; Tiltfile and kube secrets updated.
- Validation runs: `npm test` (full suite), dashboard wizard integration test suite, and AI review endpoint smoke in dev and staging all passed.

### Next Steps
- None. Workstream complete.

## Deployment TODO
- None. Completed as part of delivery.
