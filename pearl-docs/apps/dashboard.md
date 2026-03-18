## Dashboard App (`apps/dashboard`)

The Dashboard app is an admin and authoring surface for PearlOS.

- **Purpose**: manage tenants, assistants, content definitions, feature flags, and operational settings.
- **Tech stack**: Next.js App Router, TypeScript, React, Tailwind CSS, Radix UI (mirrors Interface stack for consistency).
- **Key directories**:
  - `src/app/`: admin routes and layouts.
  - `src/components/`: admin UI components (forms, tables, detail views).
  - `src/features/`: feature‑scoped admin workflows (e.g. content library, HTML templates, user management).
- **Backend integration**:
  - Uses `@nia/prism` to query and mutate Mesh content and configuration.
  - Shares event descriptors and feature flags with Interface via `@nia/events` and `@nia/features`.
- **Tests**:
  - Co‑located Jest tests in `__tests__/`, plus shared integration and health checks under `tests/`.

