# Organization-Based Resource Sharing Plan

**Date**: October 29, 2025  
**Branch**: staging-fixes-jk7  
**Target**: staging  
**Status**: Planning

## Objective

Implement a resource sharing workflow that leverages Organization records to enable users to share Notes and HtmlGeneration (applets) with other users within their tenant. The sharing owner creates/manages an organization that acts as the container for shared resources and invited collaborators.

## Scope

### In Scope
- Extend Organization model with `sharedResources` field
- Add share button UI to Notes and HtmlGenerationViewer components
- Create unified sharing modal component
- Implement organization-based access control (OWNER, MEMBER/ADMIN roles)
- Display "shared by" indicators for non-owners
- Show shared resources in notes list and applet selector
- Create/update users without passwords when invited by email
- Leverage existing organization and role management actions

### Out of Scope
- Real-time collaboration (covered by existing pipecat notes collaboration)
- Version history/conflict resolution
- Advanced permission granularity beyond Read-Only/Read-Write
- Sharing across tenants
- Email notifications (phase 2)
- Audit logging beyond existing events (phase 2)

## Architecture

### Data Model Changes

#### 1. Organization Block Extension
**File**: `packages/prism/src/core/blocks/organization.block.ts`

```typescript
export interface IOrganization {
  _id?: string;
  tenantId: string;
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
  createdBy?: string;
  isActive?: boolean;
  // NEW: Map of resourceId -> contentType
  sharedResources?: Record<string, 'Notes' | 'HtmlGeneration'>;
}
```

#### 2. Organization Platform Definition Update
**File**: `packages/prism/src/core/platform-definitions/Organization.definition.ts`

```typescript
export const OrganizationDefinition: IDynamicContent = {
  access: {},
  dataModel: {
    block: 'Organization',
    indexer: [
      'name',
      'tenantId',
      'sharedResources' // NEW: Enable indexing on shared resources
    ],
    jsonSchema: {
      additionalProperties: false,
      properties: {
        _id: { format: 'uuid', type: 'string' },
        name: { type: 'string' },
        tenantId: { type: 'string' },
        description: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
        settings: { type: 'object', additionalProperties: true },
        // NEW: sharedResources field
        sharedResources: {
          type: 'object',
          additionalProperties: {
            type: 'string',
            enum: ['Notes', 'HtmlGeneration']
          }
        }
      },
      required: ['name', 'tenantId'],
      type: 'object'
    },
    parent: { type: 'field', field: 'tenantId' }
  },
  description: 'Dynamic Organization content type',
  name: 'Organization'
};
```

#### 3. Zod Schema Update
**File**: `packages/prism/src/core/blocks/organization.block.ts` (add Zod schema)

```typescript
import { z } from 'zod';

export const OrganizationSchema = z.object({
  _id: z.string().uuid().optional(),
  tenantId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
  createdBy: z.string().optional(),
  isActive: z.boolean().optional(),
  sharedResources: z.record(
    z.enum(['Notes', 'HtmlGeneration'])
  ).optional()
});
```

### Existing Infrastructure (Leverage)

#### Organization Actions (Already Available)
**File**: `packages/prism/src/core/actions/organization-actions.ts`

- ✅ `createOrganization(organizationData, creatorUserId)` - Automatically assigns OWNER role
- ✅ `assignUserToOrganization(userId, organizationId, tenantId, role)` - Idempotent
- ✅ `getUserOrganizationRoles(userId, tenantId)` - Get user's org memberships
- ✅ `getOrganizationRoles(organizationId, tenantId)` - Get all roles for an org
- ✅ `updateOrganization(organizationId, tenantId, updates)` - Update org fields
- ✅ `getOrganizationsForUser(userId, tenantId)` - List user's organizations
- ✅ `deactivateUserOrganizationRole(roleId, tenantId)` - Remove user from org

#### API Routes (Already Available)
**File**: `packages/prism/src/core/routes/organizations/route.ts`  
**File**: `apps/interface/src/app/api/tenants/[tenantId]/organizations/route.ts`

- ✅ POST `/api/organizations` - Create organization (auto-assigns OWNER)
- ✅ GET `/api/organizations` - List organizations
- ✅ PATCH `/api/organizations` - Update organization
- ✅ POST `/api/organization-roles` - Assign user to organization
- ✅ PATCH `/api/organization-roles` - Update role
- ✅ DELETE `/api/organization-roles` - Remove user from organization

#### User Creation
**File**: `packages/prism/src/core/actions/user-actions.ts`

- ✅ `createUser({ name, email })` - Creates user without password

#### Tenant Role Assignment
**File**: `packages/prism/src/core/actions/tenant-actions.ts`

- ✅ `assignUserToTenant(userId, tenantId, role)` - Assigns tenant role
- ✅ `getUserTenantRoles(userId)` - Get user's tenant roles

### New Components & Actions

#### 1. Sharing Actions
**File**: `apps/interface/src/features/ResourceSharing/actions/sharing-actions.ts` (NEW)

```typescript
/**
 * Create or find existing sharing organization for a resource
 */
export async function createSharingOrganization(
  resourceId: string,
  contentType: 'Notes' | 'HtmlGeneration',
  resourceTitle: string,
  tenantId: string,
  userId: string
): Promise<IOrganization>

/**
 * Add resource to organization's sharedResources map
 */
export async function addSharedResource(
  organizationId: string,
  resourceId: string,
  contentType: 'Notes' | 'HtmlGeneration',
  tenantId: string
): Promise<IOrganization>

/**
 * Remove resource from organization's sharedResources map
 */
export async function removeSharedResource(
  organizationId: string,
  resourceId: string,
  tenantId: string
): Promise<IOrganization>

/**
 * Get all organizations where user has access to a specific resource
 */
export async function getResourceSharingOrganizations(
  resourceId: string,
  userId: string,
  tenantId: string
): Promise<IOrganization[]>

/**
 * Get all shared resources accessible to a user
 */
export async function getUserSharedResources(
  userId: string,
  tenantId: string,
  contentType?: 'Notes' | 'HtmlGeneration'
): Promise<Array<{
  resourceId: string;
  contentType: 'Notes' | 'HtmlGeneration';
  organization: IOrganization;
  role: OrganizationRole;
}>>

/**
 * Share resource with user by email
 * - Creates user if doesn't exist
 * - Ensures user has tenant MEMBER role before adding to org
 * - Assigns organization role (MEMBER or ADMIN)
 */
export async function shareResourceWithUser(
  resourceId: string,
  contentType: 'Notes' | 'HtmlGeneration',
  email: string,
  role: 'read-only' | 'read-write',
  tenantId: string,
  ownerId: string
): Promise<{ user: IUser; tenantRole: IUserTenantRole; orgRole: IUserOrganizationRole }>
```

#### 2. Sharing Modal Component
**File**: `apps/interface/src/features/ResourceSharing/components/SharingModal.tsx` (NEW)

```typescript
interface SharingModalProps {
  open: boolean;
  onClose: () => void;
  resourceId: string;
  resourceTitle: string;
  contentType: 'Notes' | 'HtmlGeneration';
  isOwner: boolean;
  currentUserId: string;
  tenantId: string;
}

export function SharingModal(props: SharingModalProps) {
  // Display:
  // - Modal title: "Sharing <resource name>"
  // - Subtitle: contentType in small caps
  // - List of current users with emails and roles
  // - Add user form (email input + role selector)
  // - Remove user buttons (owner only)
  // 
  // Uses existing theme/dark-light mode via shadcn components
}
```

#### 3. Share Button Components
**File**: `apps/interface/src/features/Notes/components/ShareButton.tsx` (NEW)  
**File**: `apps/interface/src/features/HtmlGeneration/components/ShareButton.tsx` (NEW)

```typescript
interface ShareButtonProps {
  resourceId: string;
  resourceTitle: string;
  contentType: 'Notes' | 'HtmlGeneration';
  currentUserId: string;
  resourceOwnerId: string;
  tenantId: string;
}

export function ShareButton(props: ShareButtonProps) {
  // Square button with up arrow icon
  // Only enabled if currentUserId === resourceOwnerId
  // Opens SharingModal on click
}
```

#### 4. Shared Badge Component
**File**: `apps/interface/src/features/ResourceSharing/components/SharedByBadge.tsx` (NEW)

```typescript
interface SharedByBadgeProps {
  ownerName: string;
  ownerEmail?: string;
}

export function SharedByBadge(props: SharedByBadgeProps) {
  // Dark green badge with white text
  // "shared by <user name>"
  // Shows tooltip with email on hover
}
```

#### 5. Shared Resource Indicator
**File**: `apps/interface/src/features/ResourceSharing/components/SharedIndicator.tsx` (NEW)

```typescript
interface SharedIndicatorProps {
  size?: 'sm' | 'md';
}

export function SharedIndicator(props: SharedIndicatorProps) {
  // Small icon/badge that prefixes titles in lists
  // Character-height visual indicator
  // Use: 👥
}
```

## Implementation Plan

### Phase 1: Data Model & Backend (Checkpoints 1-3)

**Checkpoint 1: Organization Model Extension** ✅ COMPLETE
- [x] Update `IOrganization` interface in `organization.block.ts`
- [x] Add Zod schema export
- [x] Update `Organization.definition.ts` with `sharedResources` field
- [x] Add `sharedResources` to indexer array
- [x] Run `npm run build` to verify no TypeScript errors
- [x] Run platform definitions registration

**Checkpoint 2: Sharing Actions** ✅ COMPLETE
- [x] Create `apps/interface/src/features/ResourceSharing/` directory
- [x] Create `actions/sharing-actions.ts` with all functions
- [x] Add comprehensive JSDoc comments
- [x] Import and use existing organization actions
- [x] Import tenant role actions for user provisioning
- [x] Implement tenant MEMBER role assignment in `shareResourceWithUser()`
- [x] Add barrel export `index.ts`

**Checkpoint 3: Backend Testing** ✅ COMPLETE
- [x] Create `__tests__/sharing-actions.test.ts`
- [x] Test create sharing organization
- [x] Test add/remove shared resource
- [x] Test get user shared resources
- [x] Test share with non-existent user (creates user + tenant role)
- [x] Test share with existing user without tenant role (adds tenant role)
- [x] Test share with existing user with tenant role (skips tenant role assignment)
- [x] Run: `npm run test:js -- --runTestsByPath apps/interface/src/features/ResourceSharing/__tests__/sharing-actions.test.ts`
- [x] All 11 tests passed ✅

### Phase 2: Shared Components (Checkpoints 4-5)

**Checkpoint 4: Sharing Modal** ✅
- [x] Create `components/SharingModal.tsx`
- [x] Use shadcn Dialog, Input, Select, Button components
- [x] Implement user list with remove buttons (disabled placeholder)
- [x] Implement add user form with email validation
- [x] Map 'Read-Only' → MEMBER, 'Read-Write' → ADMIN
- [x] Add loading states and error handling
- [x] Test with existing theme provider
- [x] npm run build passes
- [x] Export from barrel

**Checkpoint 5: Badge & Indicator Components** ✅
- [x] Create `SharedByBadge.tsx` with dark green styling (emerald color scheme)
- [x] Create `SharedIndicator.tsx` icon component (Users icon)
- [x] Create `ShareButton.tsx` with Share2 icon (square + up-arrow)
- [x] Add hover states and tooltips
- [x] Export all from barrel
- [x] npm run build passes

### Phase 3: Notes Integration (Checkpoints 6-7)

**Checkpoint 6: Notes Share Button** ✅
- [x] Update `apps/interface/src/features/Notes/components/notes-view.tsx`
- [x] Add ShareButton to title bar area (next to Download button)
- [x] Add state management for sharing modal
- [x] Implement handleShareNote to create/find sharing organization
- [x] Pass currentNote._id, title, userId, tenantId to modal
- [x] Position alongside existing top controls
- [x] Add SharingModal component with proper props
- [x] npm run build passes

**Checkpoint 7: Notes List Indicators**
- [ ] Fetch shared resources in `loadNotes()`
- [ ] Call `getUserSharedResources(userId, tenantId, 'Notes')`
- [ ] Merge with existing notes array
- [ ] Add `isShared` flag to Note interface locally
- [ ] Prefix SharedIndicator icon to titles in list
- [ ] Update BookSpine component to show indicator
- [ ] Test filtering still works with shared notes

### Phase 4: HtmlGeneration Integration (Checkpoints 8-9)

**Checkpoint 8: HtmlGenerationViewer Share Button**
- [ ] Update `apps/interface/src/features/HtmlGeneration/components/HtmlGenerationViewer.tsx`
- [ ] Add ShareButton to viewer title bar (only if owner)
- [ ] Add SharedByBadge to viewer title bar (only if non-owner)
- [ ] Pass htmlGeneration._id, title, createdBy, tenantId
- [ ] Position near edit/delete controls

**Checkpoint 9: Applet Selector Integration**
- [ ] Identify applet selector component (HtmlGenerationFlow or similar)
- [ ] Fetch shared resources in list view
- [ ] Call `getUserSharedResources(userId, tenantId, 'HtmlGeneration')`
- [ ] Merge with user's own applets
- [ ] Prefix SharedIndicator to shared applet titles
- [ ] Test selector UI doesn't break with mixed ownership

### Phase 5: Testing & Polish (Checkpoints 10-11)

**Checkpoint 10: Integration Testing**
- [ ] Create E2E test for Notes sharing workflow
- [ ] Create E2E test for HtmlGeneration sharing workflow
- [ ] Test user without password creation flow
- [ ] Test tenant MEMBER role auto-assignment for new users
- [ ] Test tenant MEMBER role auto-assignment for existing users without tenant role
- [ ] Test owner can delete shared resource
- [ ] Test member can only view (read-only)
- [ ] Test admin can edit (read-write)
- [ ] Test removing user from organization

**Checkpoint 11: Documentation & Cleanup**
- [ ] Update this plan with completion status
- [ ] Add inline comments to complex logic
- [ ] Verify no console errors in dev mode
- [ ] Run full test suite: `npm test`
- [ ] Run type check: `npm run type-check`
- [ ] Run lint: `npm run lint`

## File Structure

```
apps/interface/src/features/ResourceSharing/
├── actions/
│   └── sharing-actions.ts
├── components/
│   ├── SharingModal.tsx
│   ├── ShareButton.tsx
│   ├── SharedByBadge.tsx
│   └── SharedIndicator.tsx
├── types/
│   └── sharing-types.ts
├── __tests__/
│   └── sharing-actions.test.ts
└── index.ts (barrel export)

packages/prism/src/core/
├── blocks/
│   └── organization.block.ts (updated)
└── platform-definitions/
    └── Organization.definition.ts (updated)

apps/interface/src/features/Notes/
└── components/
    └── notes-view.tsx (updated)

apps/interface/src/features/HtmlGeneration/
└── components/
    └── HtmlGenerationViewer.tsx (updated)
```

## Data Flow

### Sharing Workflow
```
1. User clicks Share button on Note/Applet
2. ShareButton opens SharingModal
3. SharingModal calls createSharingOrganization()
   - Creates org named "Sharing <resource title>"
   - Sets current user as OWNER
   - Adds resourceId to sharedResources map
4. Owner enters collaborator email
5. Modal calls shareResourceWithUser()
   - Creates user if doesn't exist (no password)
   - Checks user's tenant roles
   - Assigns tenant MEMBER role if user has no tenant role yet
   - Assigns organization MEMBER or ADMIN role
   - Returns to modal
6. Modal refreshes user list
```

### Resource Access
```
1. User opens Notes or Applets
2. Component calls getUserSharedResources()
3. Action queries organizations where user has role
4. Filters by sharedResources contentType
5. Returns array of {resourceId, contentType, organization, role}
6. Component merges with owned resources
7. Displays with SharedIndicator prefix
```

### Permission Checks
```
- OWNER: Can share, manage users, delete resource
- ADMIN (read-write): Can edit resource content
- MEMBER (read-only): Can view resource content
- Non-member: Cannot see resource
```

## Dependencies

### Existing (No Changes Needed)
- `@nia/prism/core/actions/organization-actions` - All CRUD operations
- `@nia/prism/core/actions/user-actions` - User creation
- `@nia/prism/core/actions/tenant-actions` - Tenant role assignment
- `@nia/prism/core/blocks/organization.block` - IOrganization interface (extend)
- `@nia/prism/core/blocks/userOrganizationRole.block` - OrganizationRole enum
- `@nia/prism/core/blocks/userTenantRole.block` - TenantRole enum
- `apps/interface/components/ui/*` - shadcn components for modal

### New
- `apps/interface/src/features/ResourceSharing` - New feature directory

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Organization naming conflicts | Medium | Use unique pattern: "Sharing <title> (<resourceId suffix>)" |
| Orphaned organizations after resource delete | Medium | Add cleanup logic in delete handlers |
| Performance with many shared resources | Low | Index sharedResources field, paginate lists |
| User confusion with MEMBER/ADMIN vs Read-Only/Read-Write | Low | Clear UI labels, tooltips |
| Stale resource references in sharedResources | Medium | Add validation checks before displaying |

## Success Criteria

- [ ] User can share a Note with another user by email
- [ ] User can share an HtmlGeneration with another user by email
- [ ] Non-existent users are created automatically (no password)
- [ ] Owner can remove users from shared resources
- [ ] Shared resources show "shared by" badge for non-owners
- [ ] Shared resources appear in notes list and applet selector with indicator
- [ ] Read-only users cannot edit shared resources
- [ ] Read-write users can edit shared resources
- [ ] All existing tests continue to pass
- [ ] No type errors or lint warnings
- [ ] Manual testing shows proper dark/light mode theming

## Follow-up Tasks (Phase 2)

- [ ] Email notifications when resource is shared
- [ ] Activity log for shared resource access
- [ ] Bulk share operations
- [ ] Share link generation (time-limited)
- [ ] Transfer ownership capability
- [ ] Advanced permission granularity

## Notes

- Leverage existing organization infrastructure to avoid reinventing wheel
- Keep UI consistent with existing Notes/HtmlGeneration patterns
- Use existing shadcn theming for automatic dark/light mode support
- Organization name pattern makes it easy to identify sharing-purpose orgs
- MEMBER/ADMIN mapping to Read-Only/Read-Write keeps UI simple while using platform roles
- **Tenant Role Provisioning**: All users must have at least MEMBER role in the tenant before joining sharing organizations. The `shareResourceWithUser()` function automatically ensures this by checking and assigning tenant MEMBER role if needed.

---

**Last Updated**: October 29, 2025
**Status**: ✅ Plan Complete - Ready for Implementation
