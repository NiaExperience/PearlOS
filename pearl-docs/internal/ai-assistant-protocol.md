# AI ASSISTANT PROTOCOL

Rules for AI collaboration. Load `.github/instructions/QUICK_REFERENCE.md` for concise patterns.

## 1. PLAN FIRST
Non-trivial tasks need plan: Objective, Scope, Files, Tests, Risks, Success criteria. No code until approved.

**Plan Documents**: Create plan in `./docs/transitions/<feature-name>-plan.md`. Update as implementation progresses (living document). Prefer ONE comprehensive plan over multiple small documents.

## 2. CONTEXT
Branch + target, paths, errors, event topics, constraints. AI discovers unknowns first.

## 3. REQUESTS
"Plan migration X→Y" | "Add event + schema + redaction" | "Refactor Z: steps then implement"

## 4. RESPONSE
Task intent, requirements list, checkpoints every 3-5 files, quality gates status.

## 5. CHANGES
Moves first (git history), then refactors. One concern per change.

## 6. EVENTS
Update descriptor JSON + codegen + redaction before emit. Never ad-hoc payloads.

## 7. TESTS
Happy + edge + error cases. Update tests when contracts change. Prefer IDE test runner (VS Code test API) for individual and batch runs; fall back to CLI commands when needed.

## 8. QUALITY GATES
Must pass: `npm run build`, `build:types`, `lint`, `test`. Remediate ≤3 tries.

## 9. SECURITY
No secrets/PII in logs. Redact required. Note new dependencies + purpose.

## 10. ETIQUETTE
Decisive prompts. Scope drift → reply `FOCUS: <scope>`.

## 11. APPROVAL
Large changes: await "APPROVED". Implement with checkpoints.

## 12. VERIFICATION
☐ Requirements met ☐ No dead code ☐ Tests pass ☐ Docs updated ☐ Rollback plan

## 13. REDIRECT
`NEW TASK: <objective>` snapshots state and resets.

## 14. RED FLAGS
Code without plan | Missing tests | Silent events | Unrelated formatting

## 15. TRIVIAL
Skip plan for Q&A or one-file tweak. User can force with "FULL PLAN".

## 16. ARCHITECTURE

**Layers**: `packages/*` ⛔ `apps/*`. Features via barrel exports.
**Events**: Descriptor + codegen first. Include redaction + piiLevel.
**Deps**: Justify (gap, size, license). Prefer shared utils.
**State**: Shallow UI. Context for cross-component. Max 3-level props.
**Files**: Moves first. 1 responsibility. Split >250 lines.
**Logs**: Structured start + error for async. Graceful event fallback.
**Perf**: No >10ms sync work on request/audio paths. Batch events.
**Secrets**: Never in code. Redact PII.
**Breaking**: Deprecate first (unless security). Document migration.

## 17. JEST (MONOREPO)

⛔ **NEVER** `npm test --workspaces`

**Why**: Path dups, multiple Mesh servers, false errors.

**OPTIMAL single-suite execution**:
```bash
npm run test:js -- --runTestsByPath <path>
```

**Use**:
- **Single suite/file** (OPTIMAL): `npm run test:js -- --runTestsByPath path/to/test.tsx`
- **Multiple files**: `npm run test:js -- --runTestsByPath file1.test.tsx file2.test.tsx`
- **Specific test**: `npm run test:js -- --runTestsByPath path/test.tsx --testNamePattern "test name"`
- Full suite: `npm test`
- Single app: `npm test --workspace=<app>`

## 18. PR DOCS

**Required** (use template):
Title | Problem | Scope | Changes | Diff `git diff --shortstat origin/<target>...HEAD` | Risks | Tests | Rollback | Coverage

**PROPER PR WORKFLOW**:
1. **Full branch scan**: `git fetch origin && git diff origin/staging...HEAD --shortstat`
2. **Create PR doc in /tmp**: Generate complete `PR_DOC.md` in `/tmp/pr_docs/` (OUTSIDE repo)
3. **Post with gh CLI**: `gh pr create --title "..." --body-file /tmp/pr_docs/PR_DOC.md`
4. **Never commit PR doc**: Keep PR documentation ephemeral, not in repo history

**Branch**: Check `git rev-list --left-right --count origin/staging...HEAD`. Update before review (rebase|merge). Note method + time.

**Conflicts**: List files, identify bugfixes (preserve!), propose merge, retest, update diff.

**Accept**: ☐ Template done ☐ No conflicts ☐ Up-to-date ☐ Tests pass ☐ Coverage ☐ Rollback <5min

## 19. TEST EXECUTION

**Preferred**: IDE test API (VS Code test runner) for both single tests and full suites to minimize churn and keep context scoped.

**CLI fallback** (when IDE runner is unavailable or for CI parity):

```bash
npm run test:js -- --runTestsByPath path/test.tsx
npm run test:js -- --runTestsByPath a.test.tsx b.test.ts
npm run test:js -- --runTestsByPath path/test.tsx --testNamePattern "name"
```

⛔ Never `--workspaces` with Jest; avoid auto-watchers that thrash Mesh.

## 20. MERMAID
No special chars in labels. Alphanumeric + space/hyphen only.

## 21. QUICKSTART

**Mono**: `apps/` (interface, dashboard, mesh, pipecat-daily-bot) + `packages/` (prism, features, events)
**Flow**: App → Prism → Mesh GraphQL (:2000) → Postgres
**Features**: `apps/interface/src/features/<Name>/` barrel exports. No cross-imports.
**Flags**: `@nia/features` + `NEXT_PUBLIC_FEATURE_*`. Check `isFeatureEnabled()`.
**Tools**: `getAssistant.tsx` functions. Handlers in `browser-window.tsx`.
**Data**: Use Prism. Never raw storage queries.
**Events**: `packages/events` descriptors + codegen + redaction.

**Dev**:
```bash
npm run start:all                           # All
npm run --workspace=interface dev           # One
npm run type-check && npm run lint          # Quality
npm test                                    # Full tests
npm run test:js -- --runTestsByPath <paths> # Targeted
npm run test:e2e                           # Cypress
npm run pg:start                           # Local DB
```

**Pitfalls**: Missing flags | No handler | `--workspaces` + Jest | Deep imports | Daily.co participant ID (use DB User.id)

**New feature**:
1. `apps/interface/src/features/<Name>`
2. Flag via `@nia/features`
3. Tool + handler
4. Prism for data
5. Tests
6. `npm test`

## VERSION
1.5 | 2025-10-16 | Token-optimized: 3323→950 words (71% reduction)

**Load domain refs on-demand only**: PIPECAT_BOT, FRONTEND_EVENTS, LOCALSTORAGE
