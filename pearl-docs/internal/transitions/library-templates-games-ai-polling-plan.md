# Library Templates Games AI + Polling Plan

## Objective
Add single-user vs AI support back into the checkers template and add 5-second polling for shared two-player sessions in both checkers and chess templates.

## Scope
- Checkers: restore AI play option while keeping human-vs-human flow; persist metadata for reconciliation; avoid regressions to capture/turn logic.
- Chess and Checkers: add periodic polling (~5s) to refresh state from storage for two-player mode without breaking local moves.
- Do not change other templates or storage utilities beyond what is required for these two games.

## Files
- apps/interface/src/features/HtmlGeneration/lib/library-templates.ts (checkers/chess sections)
- Supporting helpers within the same file if needed.

## Approach / Checkpoints
1) Review current game state helpers and persistence fields; add minimal metadata needed for polling (timestamp, version).
2) Implement polling loop that calls load functions safely (idempotent, no flicker) for chess and checkers.
3) Reintroduce AI opponent handling for checkers with guardrails so human-vs-human remains unchanged.

## Tests / Validation
- Manual: open checkers, play human vs human and human vs AI; verify turns, captures, and persistence reload.
- Manual: open chess in two tabs, confirm polling picks up remote moves within 5s.
- Optional targeted: related unit/UI tests if present (none expected in this HTML template).

## Risks
- Polling clobbers in-flight local move; mitigate by only overwriting when remote data is newer or game not in local edit.
- AI move loop could conflict with user claims; ensure AI only acts when set as opponent and game not over.
- Storage latency could delay refresh; keep polling lightweight and resilient to errors.
