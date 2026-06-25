# Contributing to PearlOS

Thanks for your interest in contributing to PearlOS! This guide will help you get started.

## Getting Started

1. **Fork the repo** and clone your fork
2. **Install dependencies:** `npm install` (or `pnpm install`)
3. **Copy environment config:** `cp .env.example .env.local` and fill in required values
4. **Run the dev server:** `npm run dev`
5. **Verify it works:** Open `http://localhost:3000` in your browser

See [docs/getting-started.md](docs/getting-started.md) for a more detailed setup walkthrough.

## Development Workflow

### Branching

- Create a feature branch from `main`: `git checkout -b feat/your-feature`
- Use prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(voice): add support for custom TTS providers
fix(notes): prevent duplicate saves on rapid edits
docs: update architecture diagram
chore(deps): bump next to 15.x
```

### Pull Requests

1. Keep PRs focused. One feature or fix per PR.
2. Write a clear description of what changed and why.
3. Include screenshots or recordings for UI changes.
4. Make sure existing tests pass.
5. Reference any related issues (e.g., `Closes #42`).

### Code Style

- **TypeScript** everywhere. Avoid `any` when possible.
- **React:** Functional components with hooks. No class components.
- **Formatting:** Run `npm run lint` before committing. We use ESLint + Prettier.
- **Imports:** Prefer absolute imports with `@/` prefix.
- **No em dashes or en dashes** in comments, docs, or UI copy. Use commas, parentheses, or rewrite instead.

## Project Structure

PearlOS is a monorepo. Key packages:

- `apps/interface` — Next.js frontend (the desktop environment)
- `apps/pipecat-daily-bot` — Voice pipeline (Pipecat + Daily.co)
- `apps/mesh` — GraphQL API layer
- `packages/` — Shared libraries and utilities

## Reporting Issues

- **Bugs:** Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Features:** Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Security:** See [SECURITY.md](SECURITY.md). Never open public issues for vulnerabilities.

## Code of Conduct

All participants in the PearlOS community are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Be kind, be respectful, be constructive.

## Questions?

Open a discussion on GitHub or join our community channels. We are happy to help new contributors find their footing.
