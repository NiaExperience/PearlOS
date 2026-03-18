## Redis Package (`packages/redis`)

The Redis package provides a thin, domain‑aware client over Redis for PearlOS.

- **Purpose**: standardize how Redis connections, pub/sub channels, and messaging patterns are used across services.
- **Tech stack**: TypeScript library published as `@nia/redis`, built on top of `ioredis`.
- **Structure**:
  - `src/`: connection factory, pub/sub helpers, and higher‑level messaging utilities.
  - `types/`: shared type definitions for Redis message payloads.
- **Integration**:
  - Used by Mesh and other services to coordinate background work and cache invalidation.
  - Relies on configuration under the root `config/redis` directory for env‑specific settings.

