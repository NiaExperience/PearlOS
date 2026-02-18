# Personality Wizard Review Fix Plan

## Objective
Restore AI review output so Suggested diff shows real text (no `[object Object]`), explanation renders, and layout remains stable for personality wizard.

## Scope
- API: `/apps/dashboard/src/app/api/personalities/wizard/review/route.ts`
- Client: dialog parsing/rendering in `/apps/dashboard/src/app/dashboard/admin/personalities/personality_wizard_dialog.tsx`
- Shared logic: normalization in `/apps/dashboard/src/app/dashboard/admin/personalities/wizard_logic.ts`
- Out of scope: new features, persistence changes, non-wizard flows.

## Approach
1) Harden API request/response: enforce JSON response format and avoid coercing objects to strings; log diagnostics safely.
2) Normalize revisedPrompt client-side: handle object payloads and guard against `[object Object]` fallbacks; ensure explanation strings.
3) Verify UI: Suggested diff shows beats/text, explanation visible, tabs unaffected.

## Tests / Validation
- Targeted manual check: trigger AI review in wizard and confirm revised prompt sections render and beats populate.
- If time permits: add/adjust unit coverage in `wizard_logic.test.ts` for object payload normalization.

## Risks
- OpenAI response variations may still break parsing; mitigate with schema validation/fallbacks.
- Tightening parsing could hide useful freeform responses; keep fallback to string display.

## Checkpoints
- After API changes.
- After client normalization/display updates.

## Success Criteria
- Suggested prompt displays structured sections/beats (no `[object Object]`).
- Explanation text shown when returned.
- No regression to tab layout or existing serialization behavior.
