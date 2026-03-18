## Features Package (`packages/features`)

The Features package implements PearlOS’s feature flag system and content definition helpers.

- **Purpose**: make it easy to gate capabilities behind environment and per‑assistant flags without sprinkling custom logic across apps.
- **Tech stack**: TypeScript library published as `@nia/features`.
- **Structure**:
  - `src/`: feature flag evaluation logic and helper APIs.
  - `descriptors/content-definitions.json`: descriptors for dynamic content types.
  - `generated/` and `python/nia_library_templates/`: code‑generated helpers for JS/TS and Python.
- **Flag evaluation**:
  - Considers both environment variables (e.g. `NEXT_PUBLIC_FEATURE_*`) and the assistant’s `supportedFeatures` list.
  - Defaults to enabled unless explicitly disabled by config.
- **Integration**:
  - Imported by Interface and Dashboard components to guard UI surfaces.
  - Used by server actions to ensure backend behavior matches frontend flags.

