## Mesh Server (`apps/mesh`)

The Mesh app is the GraphQL API server that provides unified data access for PearlOS.

- **Purpose**: expose a single GraphQL endpoint over the PearlOS content model and configuration, backed by PostgreSQL.
- **Tech stack**: Node.js, TypeScript, GraphQL Mesh / Yoga, Express‑style HTTP server.
- **Key directories**:
  - `src/api/` and `src/resolvers/`: GraphQL schema, queries, and mutations.
  - `src/services/`: domain services and orchestration (sessions, invites, tokens).
  - `src/middleware/`: HTTP and auth middleware.
  - `prisma/` or equivalent DB schema folder: migrations and database model.
- **Integration**:
  - Acts as the primary backend for `@nia/prism`.
  - Stores content, indexer fields, and tenant scoping for Interface and Dashboard.
- **Environment**:
  - Configured via `.env` (database URL, ports, JWT secrets).

