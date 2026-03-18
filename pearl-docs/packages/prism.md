## Prism Package (`packages/prism`)

Prism is the primary data access layer for PearlOS.

- **Purpose**: provide a typed, multi‑tenant abstraction over the Mesh GraphQL API and other data sources, so features never talk to storage directly.
- **Tech stack**: TypeScript library published as `@nia/prism`.
- **Key concepts**:
  - Content types, indexer fields, and tenant scoping.
  - Actions for common workflows (invites, tokens, user/session operations).
  - Auth helpers and blocks for permissions and guardrails.
- **Structure**:
  - `src/core/`: actions, auth, blocks, config, routes, and services.
  - `src/data-bridge/`: adapters to underlying data stores and external systems.
  - `__tests__/`: unit and integration tests focused on behavior of the core APIs.
- **Integration**:
  - Imported by `apps/interface` and `apps/dashboard` for all content and config reads/writes.
  - Used by Mesh to enforce shared invariants on the server side.

