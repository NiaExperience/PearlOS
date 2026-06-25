# Shared-to-All (Read-Only) Workflow Plan

## Objective

Implement a "share-to-all (readonly)" workflow where any user can share an applet to all users with read-only access. This involves updates to the data model, indexing, access control logic, and the UI.

## Scope

- **Data Model**: Update `Organization` definition and schema to include `sharedToAllReadOnly`.
- **Prism Core**: Update Zod schema, TypeScript interfaces, and server actions.
- **API**: Update sharing API routes to handle the new field.
- **UI**: Add "Share to All" toggle in `SharingModal`.
- **Python Logic**: Update `sharing_actions.py` and `html_actions.py` to support the new workflow.

## Detailed Changes

### 1. Data Model & Prism Core

**Files**:
- `packages/prism/src/core/platform-definitions/Organization.definition.ts`
- `packages/prism/src/core/blocks/organization.block.ts`
- `packages/prism/src/core/actions/organization-actions.ts`

**Changes**:
- Add `sharedToAllReadOnly` (boolean) to `OrganizationDefinition` indexer and JSON schema.
- Add `sharedToAllReadOnly` to `IOrganization` interface and `OrganizationSchema` (Zod).
- Update `getUserSharedResources` in `organization-actions.ts`:
  - Fetch organizations where `sharedToAllReadOnly` is `true`.
  - Merge with user-specific shared resources.
  - **Conflict Resolution**: Explicit user roles (owner/admin/member) override global read-only access.

### 2. API & Client Actions

**Files**:
- `apps/interface/src/app/api/sharing/route.ts`
- `apps/interface/src/features/ResourceSharing/lib/client-actions.ts`

**Changes**:
- **API Route (`route.ts`)**:
  - Update `POST` to accept `sharedToAllReadOnly` when creating an organization.
  - Update `GET` to return `sharedToAllReadOnly` status.
  - Add/Update `PATCH` to handle organization updates (specifically `sharedToAllReadOnly`).
- **Client Actions (`client-actions.ts`)**:
  - Add `updateSharingOrganization` function to call the API.

### 3. UI Implementation

**File**: `apps/interface/src/features/ResourceSharing/components/SharingModal.tsx`

**Changes**:
- Add a toggle switch for "Share to All (Read-Only)".
- Display current state based on `organization.sharedToAllReadOnly`.
- Call `updateSharingOrganization` when toggled.
- Show a confirmation or info message explaining what this does.

### 4. Python Logic (Bot/Backend)

**Files**:
- `apps/pipecat-daily-bot/bot/actions/sharing_actions.py`
- `apps/pipecat-daily-bot/bot/actions/html_actions.py`

**Changes**:
- Update `get_user_shared_resources` in `sharing_actions.py`:
  - Query for `sharedToAllReadOnly: true` organizations.
  - Merge and resolve conflicts.
- Update `list_html_generations` in `html_actions.py`:
  - Include sharing metadata (`isShared`, `accessLevel`, `isGlobal`).

### 5. Verification

- Verify that `OrganizationDefinition` includes the new field.
- Verify that `list_html_generations` returns globally shared applets for a user not in the organization.
- Verify that explicit write access overrides global read-only access.
- Verify UI toggle works and persists state.
- Verify API correctly handles updates.

## Risks

- **Performance**: Fetching all `sharedToAllReadOnly` organizations might be slow if there are many. However, we expect this to be a relatively rare configuration.
- **Complexity**: Merging lists and handling conflict resolution adds complexity to both TS and Python `getUserSharedResources`.

## Rollback Plan

- Revert changes to data definitions.
- Revert changes to actions and UI.
