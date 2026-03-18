## Web Base Image (`apps/web-base`)

The `web-base` folder defines a shared Docker base image used when building the Interface, Dashboard, and related web services.

- **Purpose**: provide a consistent Node.js and system dependency baseline so app images can be built quickly and reproducibly.
- **Contents**:
  - `Dockerfile`: installs Node, system packages, and any shared build‑time tools.
- **Usage**:
  - Referenced by local and CI build scripts (for example via `npm run docker:build:web-base` in `package.json`).
  - Other app Dockerfiles use `FROM nia-web-base:local` or the published variant.

