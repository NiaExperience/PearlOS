# Administrator Panel Implementation Plan

Last updated: 2025-08-19 (post UI cleanup)

Owner: (assign)

Status: MVP Complete (Phases 1–4 done); Admin side-guide removed; entering Hardening & Backlog Triage

Progress Log:

- 2025-08-18: Implementation started. Added Organization OWNER role enum value in `userOrganizationRole.block.ts`.
- 2025-08-18: Added organization model fields `createdBy`, `isActive`; implemented uniqueness guard for org role assignment, org deactivate cascade, helper to purge user org roles.
- 2025-08-18: Created `/api/organizations` route (GET/POST/PATCH/DELETE) and added `updateOrganization` action.
- 2025-08-18: Added `/api/tenant-roles` and `/api/organization-roles` route modules (basic CRUD operations, listing limited for future enhancement).
- 2025-08-18: Implemented auth middleware (tenant/org access + admin + composite, SUPERADMIN constant) and added `/api/users/search` (SUPERADMIN restricted).
- 2025-08-18: Completed backend gap: list all tenant & organization roles and enforce last-owner / last-admin protections for update & deactivate.
- 2025-08-18: Added pagination TODO markers in code (role listings & global search) and scaffolded admin frontend (layout + overview + tenants/orgs/users pages + context provider).
- 2025-08-18: Implemented tenant selector (client) and reactive organizations list (client fetch tied to selected tenant).
- 2025-08-18: Added tenant creation UI with optimistic insert + rollback on failure in selector.
- 2025-08-18: Added organization creation form with optimistic insert + rollback on failure.
- 2025-08-18: Implemented role management UI (role badges, modal for tenant & organization roles, user list integration).
- 2025-08-18: Added organization selection (selector + selectable list; clears on tenant change).
- 2025-08-18: Added organization role badges column to users list (conditional on selected organization).
- 2025-08-18: Enhanced users list with toast-based error notifications for user/role fetch failures.
- 2025-08-18: Added success toasts for tenant/org role mutations; inserted TODOs for debounce & retry actions on fetch errors.
- 2025-08-18: Implemented organization edit (inline rename) & deactivate UI with optimistic updates and cascade awareness (marks inactive).
- 2025-08-18: Implemented tenant edit (inline rename) & deactivate UI, added backend update/deactivate endpoints with cascade (roles + orgs) and optimistic client updates.
- 2025-08-18: Added tenant & organization reactivation endpoints (PATCH isActive=true) plus UI Reactivate buttons with optimistic updates.
- 2025-08-18: Styled inactive tenants/orgs (grayed + italic) and enforced admin permission checks on tenant/org update, deactivate, reactivate endpoints.
- 2025-08-18: Added button-level (UI) auth gating placeholders for tenant/org admin actions and inserted pagination TODO markers across users, orgs, tenants, role modal.
- 2025-08-18: Implemented `useCurrentRoles` hook (tenant/org role lookup) and integrated into tenant & organization admin pages for real button-level gating.
- 2025-08-18: Exposed manual refresh via `useCurrentRoles` (hook now also reacts to global `refreshVersion` from `AdminContext` for cross-component invalidation after role mutations).
- 2025-08-18: Refactored `RoleManagementModal` to call `useCurrentRoles().refresh` instead of context `triggerRefresh` for localized current-user role invalidation.
- 2025-08-19: Added dashboard `organization-roles` GET / PATCH / DELETE endpoints delegating to core implementations with audit logging & metrics.
- 2025-08-19: Added API tests covering organization role lifecycle (assign, list, update, deactivate, invariant protection: last OWNER).
- 2025-08-19: Implemented password reset token persistence (default ON; set `RESET_TOKEN_PERSISTENCE=disabled` to opt-out) with durable hashed + HMAC protected storage and refactored reset password page into a reusable component (build analyzer fix).
- 2025-08-19: Extended reset token system to multi-purpose (add `invite_activation` purpose) with distinct TTL defaults (reset 30m, invite 72h).
- 2025-08-19: Added invitation workflow endpoints (`/api/users/invite`, `/api/users/accept-invite`) + test-mode token exposure and single-use enforcement tests.
- 2025-08-19: Removed `AdminUsageGuide` side panel (simplified admin layout) and rerouted navigation so "Admin Panel" opens at `/dashboard/admin` from avatar menu.
- 2025-08-19: Restored `/dashboard/settings` as User Settings hub (profile/security placeholders) distinct from Admin Panel.

---

## 1. Objectives

Build an Administrator Panel inside the Dashboard app enabling privileged users to:

1. Create & manage Tenants (auto-assign ownership to creator)
2. Create & manage Organizations (scoped to a Tenant; auto-assign top role)
3. Create & manage Users
   - Manage User roles w.r.t. Tenants
   - Manage User roles w.r.t. Organizations

Must leverage existing APIs wherever possible. Add only the minimal new API routes required to fill gaps.

---

## 2. Current State Summary

| Domain | What Exists | Gaps |
|--------|-------------|------|
| Tenants | `TenantActions`, core route `/api/tenants` (GET user tenants, POST create + assign OWNER) | No update/deactivate; no explicit tenant role mgmt API (assignment only via `/api/users` POST); no list-all (platform admin) |
| Organizations | `organization-actions.ts` (CRUD-like actions + role assignment) | No API routes; no UI; no soft-delete; no ownership concept (roles: ADMIN / MEMBER / VIEWER) |
| Users | `/api/users` (GET by tenant, POST create or update + create tenant role) | Lacks organization role endpoints, tenant role update/deactivate endpoints, search, pagination |
| Roles | `UserTenantRole`, `UserOrganizationRole` blocks + actions | Missing route wrappers + uniqueness guards; org-level access middleware not implemented |
| Auth | Helpers: `requireAuth`, `requireTenantAccess`, `requireTenantAdmin` | `requireOrgAccess` stubbed; no composite guard for org admin OR tenant admin |

---

## 3. Target Role & Permission Model

### Tenant Roles (existing)

OWNER > ADMIN > MEMBER

### Organization Roles (existing / updated)

OWNER > ADMIN > MEMBER > VIEWER (OWNER newly approved; parity with tenant model)

#### Proposal (Resolved)

Organization OWNER role will be implemented. ADMIN remains high privilege but cannot demote or remove the last OWNER.

### Permission Matrix (MVP)

| Action | Required Role |
|--------|---------------|
| Create Tenant | Any authenticated user |
| Update Tenant | Tenant ADMIN+ |
| Create Organization | Tenant ADMIN+ |
| Update Organization | Org ADMIN or Tenant ADMIN+ |
| Assign Tenant Role | Tenant ADMIN+ (OWNER only to assign OWNER if implemented) |
| Assign Org Role | Org ADMIN or Tenant ADMIN+ |
| Global User Search | SUPERADMIN only (platform user id `00000000-0000-0000-0000-000000000000`) |
| View Tenant Users | Tenant MEMBER+ |
| View Organizations | Tenant MEMBER+ |
| Global User Search (future) | Platform SUPERADMIN |

---

## 4. Proposed New API Endpoints

All routes follow pattern of existing `packages/prism/src/core/routes/*`. Dashboard app exposes them under `/api/*`.

### Organizations

1. `GET /api/organizations?tenantId=...`
2. `POST /api/organizations` body `{ tenantId, name, description? }` (auto-assign creator top role)
3. `PATCH /api/organizations/:id` body partial `{ name?, description?, settings? }`
4. `DELETE /api/organizations/:id` (soft deactivate; requires augmenting model with `isActive`)

### Tenant Roles

1. `GET /api/tenant-roles?tenantId=...` → `{ roles: [{ userId, tenantId, role, isActive }] }`
2. `POST /api/tenant-roles` `{ tenantId, userId, role }`
3. `PATCH /api/tenant-roles` `{ tenantId, userId, role }`
4. `DELETE /api/tenant-roles` `{ tenantId, userId }` (deactivate)

### Organization Roles

1. `GET /api/organization-roles?tenantId=...&organizationId=...`
2. `POST /api/organization-roles` `{ tenantId, organizationId, userId, role }`
3. `PATCH /api/organization-roles` `{ tenantId, userOrganizationRoleId, role }`
4. `DELETE /api/organization-roles` `{ tenantId, userOrganizationRoleId }`

### Optional / Future

1. `PATCH /api/tenants/:id` (update name/domain/planTier/settings)
2. `DELETE /api/tenants/:id` (soft deactivate + cascade deactivation of roles & orgs)

---

## 5. Backend Implementation Details

### Additions to Prism Core

| File | Purpose |
|------|---------|
| `routes/organizations/route.ts` | GET/POST/PATCH/DELETE handlers |
| `routes/tenant-roles/route.ts` | Manage tenant role assignments |
| `routes/organization-roles/route.ts` | Manage org role assignments |
| `auth/auth.middleware.ts` | Implement `requireOrgAccess`, `requireOrgAdminOrTenantAdmin` |
| (optional) `core/blocks/organization.block.ts` | Add `isActive`, `createdBy` |
| `core/blocks/userOrganizationRole.block.ts` | Add `OWNER` enum value (now required) |
| `routes/users/search/route.ts` | Global user search (SUPERADMIN restricted) |

### Action Layer Enhancements

1. **Uniqueness Guard** before creating role: query existing active record; if exists → update (idempotent) or return existing.
2. **Organization Deactivate**: mark `isActive=false`, auto-deactivate all related user organization roles (DECIDED: YES).
3. **Cascade**: Removing user from tenant purges tenant role and all organization roles under that tenant (DECIDED: YES).
4. **Validation**: Prevent removing last OWNER (tenant or organization) and last ADMIN if no OWNER remains.
5. **Global Search**: Implement SUPERADMIN-only pathway; verify caller id matches platform admin constant.

### Error Semantics

| Scenario | Code | Shape |
|----------|------|-------|
| Unauthorized | 401 | `{ error: 'Unauthorized' }` |
| Forbidden | 403 | `{ error: 'Access denied' }` |
| Validation | 400 | `{ error: 'Message' }` |
| Not Found | 404 | `{ error: 'Not found' }` |
| Conflict (duplicate assignment) | 409 | `{ error: 'Role already assigned' }` |
| Server | 500 | `{ error: 'Internal error' }` |

### Logging Conventions

Prefix logs with domain tokens: `TENANTS|ORG|ROLES`. Include `userId`, `tenantId`, `organizationId` when present. Example: `ORG CREATE user=... tenant=... orgName=...`.

---

## 6. Frontend Architecture (Dashboard)

### Navigation (under `/dashboard/admin`)

| Route | Feature |
|-------|---------|
| `/dashboard/admin` | Overview (counts, quick links) |
| `/dashboard/admin/tenants` | Manage tenants |
| `/dashboard/admin/organizations` | Manage orgs (requires selected tenant) |
| `/dashboard/admin/users` | Manage users & roles |

### Shared State

`AdminContext` provides:

```ts
selectedTenantId
setSelectedTenantId
selectedOrganizationId
tenants[]
organizationsByTenant[tenantId]
tenantRoles[tenantId]
organizationRoles[orgId]
usersByTenant[tenantId]
loading/error states
```

Use SWR (or lightweight fetch hook) keyed by `[endpoint, tenantId]`.

### Core Components (current)

| Component | Responsibility |
|-----------|----------------|
| `TenantSelector` | Dropdown of permitted tenants |
| `TenantsTable` | List + create/edit actions |
| `OrganizationsTable` | Filter by tenant, list organizations (create/edit/deactivate/reactivate) |
| `UsersTable` | Show users in tenant + role badges |
| `RoleBadge` | Visual role representation |
| `RoleManagerModal` | Assign / update / deactivate roles (tenant & organization tabs) |
| `CreateEditTenantModal` | Form with validation |
| `CreateEditOrganizationModal` | Form with validation |
| `ConfirmDialog` | Reusable destructive action confirmation |

### UX Flows

**Create Tenant** → POST `/api/tenants` → refresh tenants → auto-select new.

**Create Organization** → POST `/api/organizations` → optimistic append → confirm via refetch.

**Assign Tenant Role** → POST `/api/tenant-roles` → optimistic update → refetch.

**Change Role** → PATCH endpoint → inline update.

**Remove Role** → DELETE endpoint → soft deactivation (hidden by default; toggle to view inactive if needed later).

### Validation Rules

| Field | Rule |
|-------|------|
| Tenant name | Required, <= 100 chars |
| Organization name | Required, <= 100 chars |
| Role change | Cannot demote last OWNER/ADMIN (guard server + UI) |
| User email (create) | Must be valid RFC 5322 basic pattern |

---

## 7. Data Flow Example (Assign Tenant Role)

1. Open RoleManagerModal → fetch `GET /api/tenant-roles?tenantId=...` (cached)
2. User selects user + role → POST
3. Optimistic append to local store
4. On success: refetch to confirm
5. On error: rollback & show toast

---

## 8. Edge Cases & Handling

| Case | Strategy |
|------|----------|
| Duplicate assignment | Return 409 → surface: "User already has an active role" |
| Concurrent updates | Backend last-write-wins; UI refetch after mutation |
| Removing last OWNER | 400 error; disable button in UI |
| Orphaned org roles (org deleted) | Cascade deactivate on org deactivate |
| Stale tenant selection (revoked access) | 403 triggers context reset + banner |
| Large user lists | Pagination (future); for MVP assume manageable size |

---

## 9. Performance Considerations

Short term acceptable (loop-based fetch) due to expected small volumes. Future:

- Add indexers for `tenantId` / `organizationId` in Prism store if not implicit
- Batch fetch roles & users with `in` queries (already partially implemented for users)
- Introduce pagination params: `?limit=50&cursor=<id>`

---

## 10. Security Hardening

| Concern | Mitigation |
|---------|------------|
| Privilege escalation via direct API calls | Strict server checks (`requireTenantAdmin`, new `requireOrgAdminOrTenantAdmin`) |
| Enumeration (probing IDs) | Return 404 for inaccessible resources; avoid leaking existence |
| Replay / CSRF | Rely on NextAuth session + same-site cookies; consider CSRF tokens if cross-site vectors emerge |
| Insecure role updates | Validate role transition rules server-side |
| Organization role invariants | Prevent demoting/deactivating last OWNER; prevent removing last ADMIN when no OWNER remains |

---

## 11. Logging & Observability

- Standardize: `ROLES ASSIGN tenant=<id> org=<id?> user=<targetUser> actor=<actorUser> role=<role>`
- Error logs include stack only in server logs (not returned to client)
- Add optional feature flag to enable verbose debugging early (ENV var)
- Metrics: organization role lifecycle counters (assign/update/deactivate, invariant violation) collected in-memory; export surface (Prometheus / JSON) deferred.

---

## 12. Testing Strategy

### Unit (Prism Actions)

- `createOrganization` stores correct parent
- `assignUserToOrganization` rejects invalid IDs
- Uniqueness guard prevents duplicate active roles
- Deactivation cascades (if implemented) works

#### API Tests

- Create tenant → owner assignment present
- Create organization → creator role assigned
- Tenant role assign → list reflects
- Org role assign → list reflects
- Deactivate role → removed from active listing
- Permission denial cases (403) for unauthorized operations
- Organization role update (PATCH) persists changes
- Invariant protection: attempt to demote/deactivate last OWNER rejected
- Password reset token persistence ON/OFF path (feature flag) tests (dual-mode)
- Invitation workflow issuance + acceptance (single-use + purpose validation)

#### E2E (Cypress)

1. Admin logs in → creates tenant → appears
2. Creates organization in tenant → appears
3. Adds second user → assigns tenant role → visible
4. Assigns organization role → visible in user row
5. Demotes user → updates UI

#### Performance (Later)

- Simulate 500 users: verify role list endpoint latency acceptable (< target)

---

## 13. Implementation Phases & Deliverables

| Phase | Scope | Exit Criteria |
|-------|-------|---------------|
| 1 | Core routes (orgs + role mgmt) + frontend tenants/orgs basic views | Can create tenant & organization via UI |
| 2 | Role assignment UI (tenant + org) | Assign / update / deactivate roles works end-to-end |
| 3 | Edit & deactivate entities | Tenant/org editable; soft deactivate hides item |
| 4 | Polish + logging + error UX | Consistent toasts, structured logs, loading states |
| 5 | Security & perf refinements | Guards finalized, pagination design ready |

---

## 14. Decisions (Resolved)

| Decision | Value | Notes |
|----------|-------|-------|
| Add Organization OWNER role | YES | Implemented in model & enum; parity with tenants |
| Platform SUPERADMIN | YES | Fixed user id `00000000-0000-0000-0000-000000000000` (email `admin@niaxp.com`) |
| Auto-deactivate org roles on org deactivate | YES | Implement cascade in organization deactivate action |
| Remove user from tenant purges org roles | YES | Implement in user removal / tenant role deactivate path |
| Global user search in MVP | YES | Add `/api/users/search?q=` endpoint (SUPERADMIN restricted) |
| Persist reset password tokens (hashed + HMAC) | YES | Behind feature flag `RESET_TOKEN_PERSISTENCE`; durable store with secure comparison |
| Use single token object for both reset + invite purposes | YES | Implemented via `purpose` enum (`password_reset` \| `invite_activation`) with per-purpose TTL |
| Implement invitation workflow post-MVP | YES | Added issuance + acceptance endpoints and tests; removed from backlog |
| Wire token attempt counter + pruning scheduler (optional) | YES | Attempt increments on reuse/expired (persistence path); opt-in pruning interval env |

---

## 15. Acceptance Criteria (MVP)

- Admin user can:
  - View list of their tenants
  - Create a tenant (becomes OWNER)
  - Select tenant and view organizations
  - Create organization (becomes OWNER)
  - View users for tenant (incl. tenant & org roles summary)
  - Assign/update/deactivate tenant and organization roles (respecting protections)
- Platform SUPERADMIN can perform global user search endpoint
- Deactivating an organization deactivates its user organization roles
- Removing a user from a tenant purges their org roles in that tenant
- Unauthorized attempts return proper 401/403
- UI reflects role changes without full reload
- No duplicate active role records created

---

## 16. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Duplicate role entries | Confusing UI, inconsistent perms | Uniqueness guard + server constraint logic |
| Orphaned organization roles | Stale access leakage | Cascade deactivation |
| Overfetching on every modal open | Latency | Cache + conditional refetch |
| Undetected last-owner removal | Lockout | Guard + pre-checks |
| Future scaling issues | Performance degrade | Early pagination hooks + indexing |

---

## 17. Future Enhancements (Post-MVP Backlog)

- (Removed – Invitation workflow implemented 2025-08-19)
- Bulk role assignment & CSV import
- Audit trail UI (who changed what)
- Exports (tenant membership CSV)
- Role-based feature toggles UI
- Fine-grained org-level settings panels

---

## 18. Work Breakdown (Initial Tickets)

1. Backend: Organizations route module
2. Backend: Tenant role route module
3. Backend: Organization role route module
4. Backend: Add org OWNER role (if approved)
5. Frontend: Admin navigation + layout + context
6. Frontend: Tenants page (list/create)
7. Frontend: Organizations page (list/create)
8. Frontend: Users page (list users + basic role badges)
9. Frontend: Role management modal (tenant roles)
10. Frontend: Organization roles tab
11. Tests: Unit (actions) + API (routes) foundation
12. Cypress: Tenant + org creation flow
13. Logging polish + error states

---

## 19. Glossary

| Term | Definition |
|------|------------|
| Prism | Internal content abstraction / storage layer |
| Block | Content entity type stored via Prism (Tenant, Organization, Role, User) |
| Role Entry | A `UserTenantRole` or `UserOrganizationRole` record |
| Active Role | Role entry with `isActive=true` |

---

## 20. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-08-18 | Add Organization OWNER role | Needed parity & clearer privilege boundary |
| 2025-08-18 | Define SUPERADMIN user id | Enables restricted global capabilities early |
| 2025-08-18 | Auto-deactivate org roles with org | Prevents stale access |
| 2025-08-18 | Purge org roles when user removed from tenant | Consistency & least privilege |
| 2025-08-18 | Include global user search in MVP | Needed by operations for cross-tenant diagnostics |

---

## 21. Next Steps (Post-MVP Backlog)

Focus shifts to selective hardening and deferred enhancements; no blocking items for core Admin Panel use.

Near-Term Hardening / Enhancements:

1. Pagination & filtering for large role/user/org lists (>500 anticipated) (Sections 5, 9 references)
2. Metrics export surface (Prometheus / JSON) for role lifecycle + admin actions
3. Additional organization role invariant test (last ADMIN when no OWNER edge path)
4. Password reset token retention cleanup job (purge expired) & optional rate limiting
5. Audit log surfacing in UI (read-only timeline per tenant/org)
6. Debounce & retry policies for fetch failures (tenants/orgs/users) replacing TODOs
7. (Removed – Invitation workflow shipped; monitor for abuse & add CAPTCHA / rate limiting as needed)

Deferred / Nice-to-Have:

1. Bulk role assignment & CSV import
2. Role-based feature toggles UI integration
3. Performance profiling with 500+ users/org roles dataset
4. UI polish: skeleton loaders & empty states pass

Exit Criteria for Hardening Phase: Items 1–4 complete or consciously deferred with rationale logged in Decision Log.

---

End of document.
 

