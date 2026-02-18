# Creation Engine Storage Library Plan

## Objective
Distill the HTML generation guidance string into a reusable "storage library" appendix that creation engine calls can attach to generated applets, providing built-in persistence patterns without repeating prompt text.

## Scope
- Extract and normalize the NiaAPI CRUD helper + usage guidance into a single appendix payload.
- Provide a consumable module (e.g., library map/export) the creation flow can attach when persistence is requested.
- Keep behavior opt-in so existing flows without storage requests are unchanged.

## Non-Scope
- UI changes in the dashboard/creation engine shell.
- Broader refactors to AI prompt composition beyond adding the appendix hook.
- New persistence features beyond what the guidance string already describes.

## Approach
1) Source analysis: Identify required content from the guidance string (NiaAPI class, usage notes, validation/interaction rules) and define what the appendix should include or trim.
2) Library design: Create a typed module (likely under `apps/interface/src/features/HtmlGeneration/lib/`) exporting the storage appendix content/metadata for attachment.
3) Flow integration: Hook the library into the creation path (e.g., `createHtmlGeneration` or provider prompt builder) with a feature flag/parameter to include the appendix.
4) Safeguards: Ensure no duplicate attachment; keep size reasonable; fall back to current behavior when not requested.

## Files (expected)
- `apps/interface/src/features/HtmlGeneration/lib/storage-library.template.ts` (new) – exports appendix content/metadata.
- `apps/interface/src/features/HtmlGeneration/actions/html-generation-actions.ts` – attach storage appendix conditionally.
- Tests near the library or actions (e.g., `__tests__` under HtmlGeneration/lib or actions).

## Testing Strategy
- Unit: library exports correct appendix shape/content; optional parameter toggles attachment; no attachment when absent.
- Integration/light: creation flow includes appendix when flag set and omits otherwise.
- Run targeted jest via `npm run test:js -- --runTestsByPath <test>`.

## Risks / Mitigations
- Prompt bloat: keep appendix concise and reusable; avoid duplicating the entire guidance string.
- Unintended default changes: guard behind explicit flag/parameter and add tests for absence.
- Drift from existing guidance: keep source-of-truth snippet documented and referenced.

## Success Criteria
- Storage library appendix is available as a reusable module and attaches only when requested.
- Existing creation flows remain unchanged when not using the storage library.
- Tests cover on/off paths and pass via targeted jest.
