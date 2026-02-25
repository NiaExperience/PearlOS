# Claude Code Session Guide: Nia Universal

This document provides AI assistants (like Claude Code) with essential context for working effectively on the Nia Universal codebase.

---

## Quick Context

**What is Nia Universal?**
Feature-first, multi-tenant intelligent workspace platform. Small, stable core (identity, unified data via Prism + Mesh, content model) plus opt-in features shipped in isolation.

**Architecture Pattern:**
User → Interface Feature → Prism Client → Mesh GraphQL → Providers → Storage

**Key Principle:**
Optional capabilities are features (isolated, toggleable). Core stays minimal and stable.

---

## Session Bootstrap (Required Reading)

When starting any session, load these documents in order:

1. `.github/instructions/AI_SESSION_BOOTSTRAP.instructions.md` - Non-negotiables and load order
2. `.github/instructions/copilot.instructions.md` - Auto-generated summary (hash validated)
3. `docs/ai-assistant-protocol.md` - Full canonical rules, boundaries, and workflow
4. `ARCHITECTURE.md` - Platform architecture and layer model
5. `DEVELOPER_GUIDE.md` - Feature development patterns and best practices

**Focus Awareness:** Browse titles (not full content) of docs in `./docs`, `./apps/*/`, and `./packages/*/` to understand feature context.

---

## Non-Negotiables (Always Follow)

1. **Plan First** - Provide objective, scope, test strategy, assumptions before code
2. **Explicit Checklists** - Map requirements to plan steps
3. **Event Safety** - No event emits without descriptor, schema, redaction paths
4. **Test Coverage** - Add tests for new behavior (happy path + edge cases)
5. **No Reformatting** - Don't reformat unrelated code
6. **No Deep Imports** - Avoid cross-feature deep imports; use barrel exports
7. **No Secrets/PII** - Never log secrets or raw PII; enforce redaction
8. **Scope Discipline** - If scope drifts, respond with `FOCUS: <restated scope>`

---

## Repository Structure

```text
nia-universal/
├── apps/
│   ├── interface/          # Main user-facing app (Next.js, port 3000)
│   │   └── src/features/   # All optional features live here
│   ├── dashboard/          # Admin dashboard (port 4000)
│   ├── mesh/               # GraphQL Mesh server (port 2000)
│   └── pipecat-daily-bot/  # Python voice bot runtime
├── packages/
│   ├── prism/              # Multi-source data abstraction layer
│   ├── features/           # Shared feature flag module (@nia/features)
│   └── events/             # Event definitions and codegen
├── docs/                   # Architecture and protocol docs
└── charts/                 # Kubernetes deployment configs
```

**Key Constraint:** Core libs (`packages/*`) must NEVER import from app layers (`apps/*`).

---

## Feature Development Pattern (95% of Work)

### Canonical Feature Structure

```text
apps/interface/src/features/FeatureName/
├── definition.ts               # Dynamic content definition (if needed)
├── types/                      # Pure TypeScript types
├── actions/                    # Server actions (CRUD, orchestration)
├── services/                   # Long-lived orchestration (queues, sessions)
├── lib/                        # Stateless pure helpers (client-side)
├── components/                 # UI surfaces (React)
├── hooks/                      # Reusable React hooks (optional)
├── routes/                     # API route implementations (optional)
├── __tests__/                  # Unit + integration tests
└── index.ts                    # Barrel exports (public API only)
```

### 10-Step Feature Integration Checklist

1. **Folder:** Create `apps/interface/src/features/MyFeature/` with canonical structure
2. **UI:** Build React components in `components/` (client components)
3. **Server Actions:** Add to `actions/` if backend orchestration needed
4. **Services:** Only if long-lived loops/sessions required (no module-level side effects)
5. **API Route:** Thin re-export from `features/MyFeature/routes/route.ts` if needed
6. **Barrel:** Export ONLY public surface in `index.ts` (no internal leaks)
7. **Events:** Emit namespaced CustomEvents (e.g., `myfeature.action.performed`)
8. **Feature Flag:** Gate with `isFeatureEnabled('myFeature', assistant.supportedFeatures)`
9. **Tests:** Minimum one unit + one integration test
10. **Ship:** Verify no circular imports, no server code in client trees

---

## Feature Flags

**Module:** `@nia/features` (source: `packages/features`)

**Default:** All features ON unless explicitly disabled with: `0`, `false`, `off`, `disabled`

**Precedence:**
1. If `assistant.supportedFeatures` exists → feature must be in list AND env enabled
2. Otherwise → env flag alone decides

**Usage:**
```ts
import { isFeatureEnabled } from '@nia/features';

// With assistant context
if (!isFeatureEnabled('youtube', assistant.supportedFeatures)) {
  return <Disabled />;
}
```

**Environment Override:**
```bash
echo "NEXT_PUBLIC_FEATURE_YOUTUBE=off" >> .env.local
```

**Current Features:**
`youtube`, `notes`, `htmlContent`, `browserAutomation`, `avatar`, `gmail`, `googleDrive`, `calculator`, `miniBrowser`, `terminal`

---

## Data Flow & Key Components

### Prism (Data Abstraction)
- Package: `packages/prism`
- Purpose: Multi-source query engine with provider registration
- Usage: `prism.query({ contentType: 'Type', where: {...} })`
- **Never** hand-code storage queries in features; use Prism APIs

### Mesh (GraphQL Layer)
- App: `apps/mesh`
- Port: 2000
- Playground: http://localhost:2000/graphql
- Purpose: Unified GraphQL endpoint consumed by all apps via Prism client

### Content Model
- Single table: `type`, `content` (JSONB), `indexer` (JSONB, GIN indexed)
- Ownership: `parent_id` for multi-tenancy
- Keep indexer keys flat, primitives only, sized for performance

---

## Common Development Commands

```bash
# Install dependencies
npm install

# Start all apps (Interface, Dashboard, Mesh)
npm run start:all

# Focused development (single app)
npm run --workspace=interface dev

# Type checking
npm run type-check

# Linting
npm run lint

# Testing (NEVER use --workspaces flag with Jest!)
npm test                                              # Full suite
npm run test:js -- --runTestsByPath <file.test.tsx>  # Targeted test

# E2E testing
npm run test:e2e                                      # Run Cypress
npm run cypress:open                                  # Open Cypress UI

# Performance testing
npm run test:perf                                     # Jest performance harness
npm run test:profile                                  # Clinic profiling
npm run test:flamegraph                              # Flamegraph generation

# Postgres helpers
npm run pg:start                                      # Spin up local DB
npm run pg:stop                                       # Archive and teardown

# AI Protocol sync
npm run sync:ai-protocol                              # Regenerate summaries
npm run verify:ai-protocol                            # Verify up-to-date
```

---

## Testing Rules (Critical)

### NEVER Use `--workspaces` with Jest
**Reason:** Root script already iterates workspaces; adding flag causes path duplication, ENOENT errors, and multiple server lifecycle churn.

**Correct:**
```bash
npm test                                              # Full suite
npm run test:js -- --runTestsByPath path/file.test.tsx  # Targeted
```

**Incorrect (DO NOT USE):**
```bash
npm test --workspaces                                 # ❌ Causes errors
```

### Console-Only Test Execution
- **Never** use editor/agent test runners or watch loops
- Always run tests from console with explicit paths
- Summarize results: report PASS/FAIL and totals only

### Test Coverage Requirements
- **Unit:** Pure helpers (one assertion focus)
- **Integration:** Event ordering + side effects with real timers
- **Mock Only Boundaries:** Network, time (not internal pure helpers)
- **Descriptive Names:** Capture behavior, not implementation

---

## Event System Rules

When adding/changing events:

1. **Descriptor JSON:** Update in `packages/events` with schema, piiLevel, redaction paths
2. **Codegen:** Run after descriptor updates
3. **Validation:** Add redaction + validation tests
4. **No Ad-Hoc:** Never emit unregistered event topics
5. **Namespacing:** Use pattern `feature.action.detail` (e.g., `youtube.volume.change`)

---

## Git & PR Workflow

### Committing (Only When Asked)
**Safety Protocol:**
- Never update git config
- Never run destructive commands (force push, hard reset) unless explicitly requested
- Never skip hooks (--no-verify) unless explicitly requested
- Never force push to main/master
- Avoid `git commit --amend` unless (1) user requested OR (2) adding pre-commit hook edits

**Commit Message Format:**
```text
Brief summary of change

[Detailed explanation if needed]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

### Pull Request Requirements (Section 20 of AI Protocol)

**Before Creating PR:**
1. Check branch divergence: `git fetch origin && git status -sb`
2. Update if behind: `git rebase origin/staging` or `git merge origin/staging`
3. Generate diff stats: `git diff --shortstat origin/staging...HEAD`

**PR Document Must Include:**
- Problem Statement / Motivation
- Scope (In/Out)
- Change Summary (high-level bullets)
- Detailed Diffs Snapshot (shortstat + top 10 files)
- Risk & Mitigations
- Migration / Ops Impact
- Testing Evidence (unit/integration/E2E + manual matrix)
- Observability / Instrumentation
- Performance Considerations
- Security / PII Review
- Rollback Plan
- Follow-Ups / Deferred Items
- Requirements Coverage Matrix
- Screenshots (if UI changes)

**Auto-Generate:** Create `PR_DOC.md` at root (ephemeral, not committed) for developer to copy into PR description.

---

## Common Pitfalls (Avoid These)

1. **Missing Feature Flags** - Leads to hidden UI when feature disabled
2. **Tool Without Handler** - Emitting tools without `browser-window.tsx` handler
3. **Jest --workspaces** - Causes path duplication and errors (Section 19)
4. **Deep Cross-Feature Imports** - Violates boundaries; use barrel exports
5. **Server Code in Client** - No server actions in client component trees
6. **Module-Level Side Effects** - Services must not execute at import time
7. **Unregistered Events** - Never emit ad-hoc event payloads
8. **Raw Storage Access** - Always use Prism APIs, not raw queries
9. **Reformatting Unrelated Code** - Only touch relevant lines
10. **Missing Tests** - Every new behavior needs unit + integration test

---

## Architectural Boundaries

### Layering Rules
| Boundary | Rule |
|----------|------|
| Feature → Core | Only via exported contracts (no deep imports) |
| Core → Feature | One-way; core never depends on features |
| Feature ↔ Feature | Communicate via events, contexts, or core utilities |
| Packages → Apps | Never; core libs can't import from apps |

### State & Data Flow
- React components: Shallow local UI state
- Persistent state: Established store/context patterns
- No prop drilling > 3 levels (introduce context)
- Don't couple UI to WebSocket/Daily internals (use service/hook boundary)

### File Organization
- Migrations: Pure moves first (preserve git history), then refactors
- One responsibility per file
- Split when file > ~250 lines (unless cohesive)

---

## Performance Considerations

### Hot Paths
- Indexer-based filtering (selective keys, avoid large arrays)
- ContentDefinition caching (warm on startup)
- YouTube search latency (debounce repeated queries)

### Optimization Guidelines
- Avoid synchronous CPU-heavy work on request/real-time paths (> ~10ms)
- Batch event publications (avoid tight loops of small events)
- Use real timers with bounded waits for integration tests
- Track feature flag evaluation counts (detect render thrash)

---

## Security & PII

### Required Practices
- **Secrets:** Environment variables only (never in repo)
- **PII Redaction:** Add redaction paths in event descriptors
- **HTML Sanitization:** Audit dynamic content viewer regularly
- **Server Validation:** Validate tool call parameters server-side
- **Rate Limiting:** Add for high-frequency external provider calls

### Logging Rules
- Never log raw secrets or credentials
- Never log user-identifiable text without redaction
- Structured logs with request correlation ID
- Slow query threshold logging (> 300ms)

---

## Tools & Media Features

### Conversational Tools
- **Location:** `apps/interface/src/actions/getAssistant.tsx` (functions array)
- **Handler:** `apps/interface/src/components/browser-window.tsx` (switch/custom events)
- **Pattern:** Model emits tool call → UI inspects → mutates state or dispatches event

### Dynamic HTML Content
- **Tool:** `createHtmlContent` → server route → `HtmlContentViewer`
- **Flag:** `htmlContent`
- **Security:** Sanitize/sandbox scripts (CSP/iframe)

### YouTube Integration
- **Search:** `/api/youtube-search?query=`
- **Smart Volume:** Drops to 20% during speech
- **Flag:** `youtube`

### Rive Avatar
- **Component:** `apps/interface/src/components/RiveAvatar.tsx`
- **Inputs:** stage, relax, lookLeft, speech booleans
- **Events:** vapi `speech-update`, transcript messages

---

## Mermaid Diagram Guidelines (Section 22)

When creating diagrams in docs:
- **Avoid:** HTML tags, slashes, backslashes, parentheses, plus signs, pipes, quotes
- **Prefer:** Simple alphanumeric labels with spaces or hyphens
- **No Line Breaks:** Keep labels on single line
- **No Code References:** Use `compose ts` not `compose.ts`

**Bad:** `IC[compose.ts<br/>(system prompt)]`
**Good:** `IC[compose ts system prompt]`

---

## Documentation Standards

### When to Update Docs
- New provider kind added
- Tool categories expand
- Avatar system changes
- Breaking changes to exported symbols
- New architectural patterns introduced

### Doc Governance
- Architecture changes: Update `ARCHITECTURE.md` + summarize in PR
- Developer workflow: Update `DEVELOPER_GUIDE.md`
- AI protocol changes: Update `docs/ai-assistant-protocol.md` + run `npm run sync:ai-protocol`

---

## Quick Reference: Getting Started

### New to the Codebase?
1. Read `README.md` for quick start
2. Read `ARCHITECTURE.md` for system understanding
3. Read `DEVELOPER_GUIDE.md` for development patterns
4. Run `npm install && npm run start:all`
5. Confirm Mesh playground loads: http://localhost:2000/graphql
6. Toggle a feature flag locally and verify behavior

### Starting a Feature?
1. Scaffold `apps/interface/src/features/<Name>` with canonical structure
2. Add feature flag to `@nia/features`
3. Wire tool (if conversational) in `getAssistant.tsx` and `browser-window.tsx`
4. Use Prism APIs for data operations
5. Add unit + integration test
6. Run `npm test` to verify

### Need to Debug?
- **Type errors:** `npm run type-check`
- **Lint errors:** `npm run lint`
- **Test failures:** `npm run test:js -- --runTestsByPath <file>`
- **Mesh issues:** Check http://localhost:2000/graphql playground
- **Feature not appearing:** Verify flag enabled and handler in `browser-window.tsx`

---

## Example: Adding a Simple Feature

```typescript
// 1. Create folder: apps/interface/src/features/Weather/

// 2. Define types
// types/weather-types.ts
export interface WeatherData {
  temp: number;
  condition: string;
}

// 3. Add server action
// actions/weather-actions.ts
'use server';
export async function fetchWeather(city: string): Promise<WeatherData> {
  // Implementation
}

// 4. Build UI component
// components/WeatherView.tsx
'use client';
import { isFeatureEnabled } from '@nia/features';

export function WeatherView({ assistant }) {
  if (!isFeatureEnabled('weather', assistant.supportedFeatures)) {
    return <div>Weather feature disabled</div>;
  }
  // Component implementation
}

// 5. Barrel export
// index.ts
export { WeatherView } from './components/WeatherView';
export type { WeatherData } from './types/weather-types';

// 6. Add test
// __tests__/weather-view.test.tsx
describe('WeatherView', () => {
  it('renders weather data', () => {
    // Test implementation
  });
});

// 7. Wire into browser-window.tsx
case 'weather':
  if (isFeatureEnabled('weather')) {
    setShowView('weather');
  }
  break;
```

---

## Troubleshooting

### Common Issues

**Feature not visible after toggle?**
- Check flag in both command handler AND render block
- Verify env var format: `NEXT_PUBLIC_FEATURE_<NAME>=off`
- Restart dev server after env changes

**Tests failing with ENOENT errors?**
- Remove `--workspaces` flag (see Section 19)
- Use explicit paths: `--runTestsByPath <file>`

**Type errors after changes?**
- Run `npm run type-check` for full report
- Check barrel exports for missing types

**Merge conflicts after rebase?**
- Preserve upstream bugfixes (commit messages with `fix|bug|hotfix`)
- Re-run tests after resolution: `npm test`

**Event not firing?**
- Verify descriptor registered in `packages/events`
- Check event name matches exactly (case-sensitive)
- Run codegen after descriptor changes

---

## Support & Escalation

- **Questions:** Open discussion or PR comment
- **Bugs:** Create issue with reproduction steps
- **Architecture Decisions:** Tag architecture owner in PR
- **Protocol Updates:** Submit PR with rationale and concise diff

---

## Summary: Key Takeaways

1. **Plan before code** - Non-negotiable for non-trivial tasks
2. **Features are isolated** - Use canonical structure, barrel exports, feature flags
3. **Test everything** - Unit + integration minimum
4. **Use Prism for data** - Never raw storage access in features
5. **Events need descriptors** - No ad-hoc payloads
6. **Console-only tests** - Never use `--workspaces` with Jest
7. **PR docs required** - Full template for all non-trivial changes
8. **Boundaries matter** - No deep imports, packages can't import apps
9. **Security first** - Redact PII, no secrets in logs
10. **Scope discipline** - Respond with `FOCUS:` if drifting

---

**Version:** 1.0
**Last Updated:** 2025-10-09
**Source Docs:** README.md, ARCHITECTURE.md, DEVELOPER_GUIDE.md, docs/ai-assistant-protocol.md

For detailed information, always refer to the canonical source documents listed in the Session Bootstrap section.

Happy building! 🚀
