# Global Settings Implementation Plan

## Objective

Define and persist a platform-scoped `GlobalSettings` configuration that controls which authentication affordances the Interface login dialog renders, surface the toggles in the Dashboard admin panel, and ensure the Interface loads the configuration before displaying the login screen. All feature flags default to enabled when no record exists. The primary property namespace is `interfaceLogin` to keep room for future app-specific groups.

## Current Context Snapshot

- Feature flags today are driven either by environment variables or assistant-level metadata; there is no global platform-level override for login UI elements.
- Prism platform definitions currently cover entities such as `Assistant`, `UserProfile`, and `AssistantTheme`; no `GlobalSettings` definition exists.
- The Interface login form is a client component (`apps/interface/src/components/login-form.tsx`) that unconditionally renders Google, guest, and password affordances (guest availability is inferred per-assistant at runtime).
- Dashboard admin tooling lacks a surface for toggling platform-wide login controls.

## Scope

### In Scope

- Model, schema, and access utilities for a `GlobalSettings` content definition with `interfaceLogin` flag booleans.
- Server-side helpers to fetch/update the single `GlobalSettings` record with sane defaults when missing.
- Dashboard admin UI page and REST endpoints to manage the three login flags and present them inside a reusable "Login" group container that matches dashboard styling. Reading is permitted for authenticated admins, while writes remain restricted to the `SUPERADMIN` role.
- Interface app startup changes to load `GlobalSettings` and gate login UI elements accordingly.
- Unit/UI tests covering new logic.

### Out of Scope

- Multi-record management, version history, or audit logging for global settings.
- Tenant-specific overrides (future enhancement).
- Non-login feature families; only the three requested flags will be included.

## Data Model & Shared Packages

- Add `GlobalSettings` block (`packages/prism/src/core/blocks/globalSettings.block.ts`) defining TypeScript interfaces and a Zod schema:
  - Root shape: `{ _id?: string; interfaceLogin: { googleAuth: boolean; guestLogin: boolean; passwordLogin: boolean }; updatedAt?: string; createdAt?: string; }`.
  - Provide `DefaultGlobalSettings` constant with all booleans `true`.
- Create platform dynamic content definition (`packages/prism/src/core/platform-definitions/GlobalSettings.definition.ts`) with:
  - No tenant parent (platform-level, `parent` omitted).
  - Indexer on `singletonKey` (constant value) to simplify lookups.
  - JSON schema enforcing the login flag structure and default `true` values.
- Register the definition and block export in `platform-definitions/index.ts` and `blocks/index.ts`.
- Extend `packages/features` with a `global-settings.ts` module exporting typings, default values, and helper utilities (e.g., `resolveLoginSettings`). Ensure these booleans default to `true` when no data is provided.
- Update shared permission constants to clarify `SUPERADMIN` is the only principal allowed to mutate platform settings.

## Prism Core Utilities

- Add `packages/prism/src/core/actions/globalSettings-actions.ts` with helpers:
  - `ensureGlobalSettingsDefinition(op)` similar to the user profile helper.
  - `getGlobalSettings()` → queries `GlobalSettings` with `tenantId: 'any'`, returns stored record or `DefaultGlobalSettings` when absent.
  - `upsertGlobalSettings(update: Partial<LoginFlags>)` → creates the singleton record (using fixed `singletonKey`) or updates the existing one.
- Export new helpers from `packages/prism/src/core/index.ts` for consumption by apps.
- Update GraphQL client calls if necessary to permit querying platform content without tenant IDs (should already work with `'any'`).

## Interface App Updates

- Introduce a `GlobalSettingsProvider`:
  - Server component loads `getGlobalSettings()` during layout (`apps/interface/src/app/providers.tsx` or a dedicated wrapper) and passes serialized flags to a client context (`apps/interface/src/providers/global-settings-provider.tsx`).
  - Client context exposes `globalSettings.interfaceLogin` with defaults that match `DefaultGlobalSettings`.
- Update `LoginForm` to consume the context and conditionally render:
  - Google button controlled by `interfaceLogin.googleAuth`.
  - Guest button controlled by `interfaceLogin.guestLogin` (still combined with assistant metadata).
  - Email/password section (divider, fields, submit) controlled by `interfaceLogin.passwordLogin`.
- Ensure the `allowGuest` determination now also respects the global flag (disable if the global flag is off regardless of assistant metadata).
- Adjust `login/page.tsx` if needed to stay client-friendly while relying on the provider for initial data.

## Dashboard Admin UI & API

- Create REST endpoints under `apps/dashboard/src/app/api/global-settings`:
  - `GET` returns current flags (defaults to all `true` if no record) and is accessible to authenticated admin users for read-only purposes.
  - `PUT` accepts partial/full updates, validates structure, and persists via Prism actions. Both routes must enforce `SUPERADMIN` authorization, returning 403 for any other role.
- Add a new admin page at `/dashboard/admin/global-settings`:
  - Client component loads data from the new API, shows three toggle switches and descriptions inside a dashboard-standard card labelled "Interface Login", allows updating, and displays optimistic feedback.
  - Style the group container to anticipate future sections (e.g., additional cards for other setting families) while keeping layout responsive.
  - Add a navigation card/link on `dashboard/admin/page.tsx`.
  - Ensure the page bypasses the tenant selector, clarifies platform scope, and hides navigation for non-`SUPERADMIN` users.

## Testing Strategy

- **Prism actions**: unit tests verifying `getGlobalSettings` returns defaults when empty and persists updates (`packages/prism/__tests__`).
- **Interface**: Jest DOM tests for `LoginForm` ensuring each flag hides its respective UI elements, including interaction with assistant guest logic.
- **Dashboard**: Component test (React Testing Library) covering toggle rendering and API interaction mocks.
- Update any snapshots or schema registration scripts if they rely on platform definition listings.

## Risks & Mitigations

- *Singleton enforcement*: use a fixed `singletonKey` index to prevent multiple records; API should upsert rather than create duplicates.
- *Data availability on first load*: server provider returns defaults while fetch in flight; ensure hydration uses the same values to avoid a React mismatch.
- *Permission model*: enforce `SUPERADMIN` checks end-to-end for mutations while allowing other authenticated admins read-only visibility.
- *Backward compatibility*: components consuming `@nia/features` shouldn’t break—new exports must be additive.

## Open Questions & Assumptions

1. Assume platform administrators manage these settings; no per-tenant overrides required now.
2. Assume GraphQL backend accepts storing platform-level content without additional migrations.
3. Assistant-level guest gating remains additive: the guest button only appears when both the global flag and assistant metadata permit it. If this differs from expectations, call out before implementation.
4. Future setting groups will reuse the same card layout introduced for "Login" to keep the page consistent as new toggles arrive.
