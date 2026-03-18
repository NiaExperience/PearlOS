## Interface App (`apps/interface`)

The Interface app is the main PearlOS desktop experience, implemented as a Next.js application.

- **Purpose**: render the browser-based desktop, window manager, taskbar, and all first‑party apps (Notes, YouTube, Soundtrack, Wonder Canvas, Sprites, Settings, Task Manager).
- **Tech stack**: Next.js App Router, TypeScript, React with functional components, Tailwind CSS, Radix UI.
- **Key directories**:
  - `src/app/`: Next.js route tree and layout definitions.
  - `src/features/`: feature‑scoped modules (actions, services, components, routes, lib).
  - `src/components/`: shared UI (desktop shell, window chrome, taskbar, modals).
  - `src/contexts/`: React contexts for global UI and assistant state.
  - `public/`: static assets.
- **Backend integration**:
  - Talks to the Mesh GraphQL server via `@nia/prism` client.
  - Listens for and emits CustomEvents for cross‑component signaling as documented in the frontend events reference.
- **Tests**:
  - Co‑located Jest tests under `__tests__/`, plus Cypress E2E specs in the `tests/cypress/` folder.

