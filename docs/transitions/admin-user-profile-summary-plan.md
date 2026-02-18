# Admin User Profile Summary Modal Plan

Last updated: 2025-11-09

Owner: GitHub Copilot (AI Pair)

## Objective

Add a conversation summary viewer to the dashboard admin User Profiles table so administrators can inspect the latest `lastConversationSummary` and archived session summaries without leaving the page.

## Scope

- Add a per-row control that opens a modal displaying conversation summaries for the selected profile.
- Merge `lastConversationSummary` with any `sessionHistory` entries whose `action === 'session-summary'`, consolidating by `sessionId`.
- Present a human-readable timestamp next to each summary and ensure the modal is scrollable and dismissible.
- Introduce a small helper to normalize and merge summary data so it can be unit tested.

## Out of Scope

- Backend/API changes to retrieve additional profile data.
- Editing or deleting summaries from the admin UI.
- Broader styling changes to the admin panel beyond the new modal content and trigger control.

## Proposed Implementation

1. Extract a pure helper (e.g. `buildConversationSummaries`) in the user profile admin page directory that accepts an `IUserProfile` and returns merged summary entries sorted by timestamp.
2. Write Jest unit tests covering combinations of `lastConversationSummary` and `sessionHistory` data, including duplicate session IDs and missing timestamps.
3. Extend the User Profiles table row tools with a new button (likely using a `FileText`/`List`-style icon) that opens a dedicated dialog when summaries are available; disable the control when no summaries exist.
4. Add a React `Dialog` instance driven by new state (selected profile + open flag) that renders the helper output inside a scrollable container with timestamp + summary text, showing session ID metadata when useful.
5. Reuse shared UI primitives (`Dialog`, `Card`, `Button`) and ensure accessibility attributes (`aria-label`, focus trap) remain intact.

## Files & Directories

- `apps/dashboard/src/app/dashboard/admin/userProfile/page.tsx`
- `apps/dashboard/src/app/dashboard/admin/userProfile/conversation-summaries.ts` (new helper)
- `apps/dashboard/src/app/dashboard/admin/userProfile/__tests__/conversation-summaries.test.ts` (new tests)

## Test Strategy

- Jest unit tests for helper logic via `npm run test:js -- --runTestsByPath apps/dashboard/src/app/dashboard/admin/userProfile/__tests__/conversation-summaries.test.ts`.
- Manual verification instructions: load Admin → User Profiles, trigger modal on records with summary data (if fixtures allow). Documented for QA follow-up.

## Risks & Mitigations

- **Sparse data**: Some profiles may lack timestamps; display "Unknown" label if parsing fails.
- **Large summaries**: Ensure modal is scrollable; truncate with preserved whitespace if necessary.
- **RefIds without descriptions**: Fallback to ID display so the entry is still useful.

## Success Criteria

- New button appears next to existing tools and is disabled when no summaries are available.
- Modal lists merged summaries sorted newest-first with human-readable timestamps and combined summaries per session ID.
- Helper tests cover edge cases (no data, duplicates, missing timestamps) and pass.
- Existing functionality (profile editing, session history modal) remains unaffected.

## Checkpoints

1. Helper + tests implemented and passing locally.
2. UI wiring complete (button, dialog, integration) with manual smoke verification.
