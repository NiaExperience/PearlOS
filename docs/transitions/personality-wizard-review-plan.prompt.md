# Personality Wizard Review Explanation Plan

## Objective
Ensure the personality wizard review route always asks the model for a fine-grained, detailed explanation of the changes it makes to the prompt.

## Scope
- Update the outbound prompt in `apps/dashboard/src/app/api/personalities/wizard/review/route.ts` to explicitly require a detailed, fine-grained explanation of revisions.
- Keep the existing response shape (`revisedPrompt`, `explanation`) and logging intact.
- Avoid broader UI or wizard logic changes unless the prompt contract requires them.

## Requirements
- Make the model instruction clearly demand a detailed breakdown of changes applied to the prompt.
- Preserve current JSON response shape and parsing behavior.
- Keep guidance for structure/sections/tools intact while adding the explanation requirement.
- Add wizard UX tweaks:
	- Auto-trigger AI review when the wizard opens and the prompt loads.
	- Increase explanation font size in the AI review pane.
	- Add a "Request Specific Change" button in the AI review header; it opens a modal asking "What would you like to change?" with cancel/submit. On submit, close the modal and call the AI review route with `mode: "REWORK"` and the user-provided guidance.
- Extend review API to support modes:
	- Accept `mode` values `INITIAL_REVIEW` and `REWORK`.
	- Existing hardcoded guidance is the `INITIAL_REVIEW` guidance.
	- Add REWORK guidance: keep everything else the same, apply only the user-requested change, and explain diffs.

## Files (planned)
- `apps/dashboard/src/app/api/personalities/wizard/review/route.ts`
- `apps/dashboard/src/app/dashboard/admin/personalities/personality_wizard_dialog.tsx`

## Tests / Validation
- Manual: invoke the review route and verify the `explanation` field returns fine-grained detail on applied changes.
- Consider adding a lightweight contract/assertion test for the prompt payload if feasible.

## Risks
- More verbose explanations could increase token usage and latency.
- If guidance conflicts, the model might still return terse explanations; may need iterative prompt tuning.

## Checkpoints
1) Update outbound prompt with explicit detailed-explanation requirement.
2) Validate response shape and content manually (or via a small harness) to ensure explanations are detailed.

## Success Criteria
- The outbound prompt explicitly requests detailed explanations of changes.
- Model responses include fine-grained change descriptions without breaking existing JSON contract.
