---
description: Development workflow reference for AI assistants
applyTo: '**/*'
---

# Development Reference (Concise)

**Purpose**: Essential development workflows, testing strategies, and contribution guidelines. Load on-demand when creating tests, PRs, or troubleshooting CI/CD.

## Feature Development Structure

**Canonical Layout** (use for ALL new features):

```text
apps/interface/src/features/FeatureName/
├── definition.ts               # Content type schema (IDynamicContent)
├── types/                      # Pure TypeScript interfaces
├── actions/                    # Server actions (CRUD, orchestration)
├── services/                   # Stateful orchestration (queues, sessions)
├── lib/                        # Client-side pure helpers (browser-only)
├── components/                 # React UI (client components)
├── hooks/                      # (optional) React hooks
├── store/                      # (optional) Zustand/local state
├── routes/                     # (optional) API route handlers
├── __tests__/                  # Tests (unit, integration)
└── index.ts                    # Barrel exports
```

## Services vs Lib

| Placement | Use For | Examples |
|-----------|---------|----------|
| `services/` | Stateful loops, retries, external sessions | Queue managers, WebSocket clients, timers |
| `lib/` | Client-side pure helpers, browser APIs | Navigation parsers, volume calculators, event utils |

**Rule**: Keep `lib/` browser-focused. No server-specific logic (no `fs`, `path`, Node imports).

## Testing Strategy

| Test Type | Directory | Focus | Tools |
|-----------|-----------|-------|-------|
| Pure unit | `__tests__/*-utils.test.ts` | Navigation parsing, calculations | IDE test API preferred; Jest CLI fallback |
| Queue/logic unit | `__tests__/queue-*.test.ts` | Ordering, throttling, retry logic | IDE test API preferred; Jest CLI fallback |
| Integration (jsdom) | `__tests__/*-integration.test.ts` | Event sequencing, component+service | IDE test API preferred; Jest + jsdom fallback |
| E2E | `tests/cypress/e2e/` | User flows (HTML gen, nav) | Cypress |

**Guidelines**:

- Prefer IDE test runner (VS Code test API) for single and batch runs; switch to CLI when IDE runner is unavailable or for CI parity.
- Export pure functions for deterministic tests
- Mock minimally (e.g., `fetch` only)
- For `requestAnimationFrame` loops, use real timers with bounded waits
- Avoid deep mocking of pure helpers

**Test Execution**

- Preferred: IDE test API (VS Code) for individual or batch runs
- CLI fallback (use when IDE runner is unavailable or for CI):

```bash
npm run test:js -- --runTestsByPath path/to/test.tsx   # Targeted suite
npm run test:js -- --runTestsByPath a.test.tsx b.test.tsx
npm run test:js -- --runTestsByPath path/test.tsx --testNamePattern "name"
npm test                                              # Full unit suite
npm run test:e2e                                      # Cypress E2E (headless)
npm run cypress:open                                  # Cypress UI
npm run test:perf                                     # Performance benchmarks
```

## Pull Request Process

1. **Create Branch**: `git checkout -b feature/your-feature-name`
2. **Develop**: Follow canonical feature structure
3. **Write Tests**: Add focused tests for new code
4. **Lint**: `npm run lint` and `npm run format`
5. **Test**: `npm test` (verify all pass)
6. **Commit**: Clear, descriptive messages
7. **Push**: `git push origin feature/your-feature-name`
8. **PR**: Submit to `staging` branch with description

**PR Template** (auto-loaded from `PULL_REQUEST_TEMPLATE.md`):

- Description of changes
- Related issues
- Testing performed
- Screenshots (if UI changes)
- Breaking changes (if any)

## Code Standards

**TypeScript**:

- Use strict mode
- Prefer interfaces over types for object shapes
- Export types from `types/` folder

**Formatting**:

- Prettier configured (auto-format on save)
- 2-space indentation
- Single quotes for strings

**Testing**:

- All new features require tests
- Minimum 80% coverage for new code
- Test edge cases and error paths

**Commits**:

- Present tense: "Add feature" not "Added feature"
- Imperative mood: "Fix bug" not "Fixes bug"
- Reference issues: "Fix #123: Handle null case"

## Environment Setup

**Prerequisites**:

- Node.js 18+ (use `nvm` to manage versions)
- PostgreSQL 14+
- pnpm (package manager)

**Initial Setup**:

```bash
pnpm install                   # Install dependencies
cp .env.example .env.local     # Configure environment
npm run db:migrate             # Run migrations
npm run db:seed                # Seed test data
```

**Start Development**:

```bash
npm run dev                    # Start all services
# OR individually:
npm run dev:interface          # Interface (3000)
npm run dev:dashboard          # Dashboard (4000)
npm run dev:mesh               # Mesh API (2000)
npm run dev:pipecat            # Pipecat bot (4444)
```

## Common Tasks

**Database**:

```bash
npm run db:reset               # Reset database
npm run db:migrate             # Run migrations
npm run db:seed                # Seed data
npm run pg:db-archive          # Backup database
```

**Code Quality**:

```bash
npm run lint                   # ESLint check
npm run lint:fix               # Auto-fix issues
npm run format                 # Prettier format
npm run type-check             # TypeScript check
```

**Debugging**:

- Use VS Code debugger configurations (`.vscode/launch.json`)
- Set breakpoints in TypeScript/JavaScript
- Use `console.log` sparingly (prefer structured logging)
- Check browser DevTools Network tab for API calls

## Feature Flags

**Usage in Code**:

```typescript
import { isFeatureEnabled, guardFeature } from '@nia/features';

// Check flag
if (isFeatureEnabled('youtube')) {
  // Feature-specific code
}

// Guard pattern
guardFeature('notes',
  () => null,                   // onDisabled
  () => <NotesView />           // onEnabled
);
```

**Environment Variables**:

```bash
NEXT_PUBLIC_FEATURE_YOUTUBE=on       # Enable YouTube
NEXT_PUBLIC_FEATURE_NOTES=off        # Disable Notes
```

**Default**: All features ON unless explicitly disabled with `0`, `false`, `off`, or `disabled`.

## Cross-Feature Patterns

**CustomEvents** (UI coordination):

```typescript
// Dispatch
window.dispatchEvent(new CustomEvent('desktopModeSwitch', {
  detail: { mode: 'work', action: 'SWITCH_DESKTOP_MODE' }
}));

// Listen
useEffect(() => {
  const handler = (e: CustomEvent) => {
    console.log(e.detail);
  };
  window.addEventListener('desktopModeSwitch', handler);
  return () => window.removeEventListener('desktopModeSwitch', handler);
}, []);
```

**Speech Context** (global state):

```typescript
import { useSpeechContext } from '@/contexts/speech-context';

const { userSpeaking, assistantSpeaking, confidence } = useSpeechContext();
```

**Prism (data operations)**:

```typescript
import { prism } from '@nia/prism';

// Query
const photos = await prism.query({
  contentType: 'Photo',
  where: { indexer: { userId: 'user-1', album: 'summer' } }
});

// Create
await prism.create({
  contentType: 'Photo',
  data: { url: 'https://...', caption: 'Sunset' },
  indexer: { userId: 'user-1', album: 'summer' }
});
```

## Troubleshooting

**Common Issues**:

| Problem | Solution |
|---------|----------|
| Port already in use | Kill process: `lsof -ti:3000 \| xargs kill -9` |
| Stale dependencies | `rm -rf node_modules && pnpm install` |
| TypeScript errors | `npm run type-check` then fix issues |
| Test failures | Check console for stack traces, use `--verbose` |
| Database issues | `npm run db:reset` (WARNING: destroys data) |

## CI/CD

**GitHub Actions** (`.github/workflows/`):

- `test.yml` - Runs on every PR (lint, type-check, tests)
- `deploy-staging.yml` - Deploys to staging on merge to `staging`
- `deploy-prod.yml` - Deploys to production on merge to `main`

**Pre-commit Hooks** (Husky):

- Lint-staged: Formats and lints changed files
- Type check: Validates TypeScript compilation
- Test: Runs affected tests

## When to Load Full DEVELOPER_GUIDE.md

- Platform definition creation (backend specialists only)
- Understanding Prism provider architecture
- Migrating legacy features
- Deep dive into content type system
