# Plan: Revamp Assistant Feedback

## Objective
Revamp the 'Assistant Feedback' feature to allow the assistant to silently archive user suggestions during a session, which administrators can then review and manage in the Dashboard.

## Constraints & Guidelines
- **Data Model:** Preserve the existing data model in `packages/prism/src/blocks/assistant-feedback.ts`. Do not modify the schema unless absolutely necessary.
- **Legacy Code:** Remove old implementation details (API routes, frontend components) before implementing the new system.
- **Feature Flag:** All new functionality must be gated behind a new feature flag.

## Implementation Checklist

### 1. Cleanup Legacy Code
- [ ] **Remove API Route:** Delete `apps/interface/src/app/api/feedback/route.ts`.
- [ ] **Remove Frontend Logic:** Remove `handleFeedback` and related unused code in `apps/interface/src/features/chat/components/chat-interface.tsx`.

### 2. Feature Flagging
- [ ] **Define Flag:** Add `assistant-feedback` (or similar key) to `packages/features/src/index.ts`.

### 3. Bot Tool Implementation (Mesh)
- [ ] **Create Tool:** Create a new bot tool `submit_feedback` in `apps/mesh/src/tools/feedback.py`.
- [ ] **Tool Logic:** Implement logic to capture user suggestions.
    - *Note:* Verify if `apps/mesh` should call an internal API or access the database directly. Follow existing patterns in `apps/mesh`.

### 4. Dashboard Implementation
- [ ] **Create Page:** Create a new management page at `apps/dashboard/src/app/dashboard/feedback/page.tsx`.
    - Fetch data using Prism.
    - Display feedback items in a table/list.
    - Add functionality to "Mark as Reviewed" or manage status.
- [ ] **Update Navigation:** Add a "Feedback" item to the sidebar in `apps/dashboard/src/components/app-sidebar.tsx`.

## Verification
- [ ] Verify the bot tool correctly captures feedback without interrupting the user flow.
- [ ] Verify the Dashboard page correctly lists the captured feedback.
- [ ] Verify the "Mark as Reviewed" functionality updates the database.
