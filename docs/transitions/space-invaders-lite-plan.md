# Plan: Space Invaders Lite crash hardening

## Objective
Fix the `space_invaders_lite` HTML template so it no longer crashes or hangs the browser, and harden it against runtime errors.

## Scope
- Update the `space_invaders_lite` template logic and rendering inside `apps/interface/src/features/HtmlGeneration/lib/library-templates.ts`.
- Keep seed script mappings consistent if template shape changes.

## Out of scope
- Other game templates (chess, checkers, etc.).
- New backend APIs or storage schema changes.

## Approach
1. Review the existing template logic to spot crash vectors (null DOM refs, unbounded loops, DOM growth, unsafe array mutation while iterating, missing guards).
2. Patch the game loop to be defensive: guard DOM lookups, avoid mutating arrays during iteration, cap counts, and fail-soft if the playfield disappears.
3. Add cleanup/pause safeguards around the animation loop to avoid runaway rAF after errors.
4. Validate template still loads and renders; ensure persistence calls stay optional.

## Testing
- Manual: load the template, move/shoot for ~30s, verify no console errors and no crash/hang. (No automated harness available here.)

## Risks & mitigations
- Risk: Over-guarding could stop gameplay; ensure loop continues when DOM present.
- Risk: Template string edits are error-prone; keep changes localized and syntax-checked.

## Checkpoints
- After defensive loop rewrite in template.
- After any seed/mapping adjustments (if needed).
