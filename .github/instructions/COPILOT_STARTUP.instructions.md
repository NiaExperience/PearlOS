# Copilot Session Startup Guide

Version: 1.0

This guide defines what I load at session start and how I align with the repository’s AI protocols. It complements `.github/instructions/copilot.instructions.md` and ensures tests/PRs follow project conventions without you reminding me.

## Load order at session start

1. .github/instructions/copilot.instructions.md (authoritative guardrails)
2. .github/instructions/COPILOT_STARTUP.instructions.md (this file)
3. .github/instructions/COPILOT_PROJECT.instructions.yml (machine-readable settings)
4. .github/instructions/AI_SESSION_BOOTSTRAP.instructions.md (project bootstrapping notes)
5. .github/instructions/QUICK_REFERENCE.md (essential patterns and rules)
6. PULL_REQUEST_TEMPLATE.md (required PR sections)
7. package.json (scripts, workspaces)
8. turbo.json / tsconfig.json (build/types setup)
9. App/package READMEs under apps/\* and packages/\* as needed

**Load on-demand** (only when working on specific areas):

- ARCHITECTURE.reference.md (platform architecture)
- DEVELOPMENT.reference.md (testing, PRs, CI/CD)
- README.testing.md (full test documentation)
- PIPECAT_BOT.reference.md (voice bot patterns)
- FRONTEND_EVENTS.reference.md (event system)
- LOCALSTORAGE.reference.md (client storage)

If `.github/instructions/copilot.instructions.md` hash mismatches, I will run the sync script noted there.

## Branching and PR protocol

- Default target branch: `staging` (unless specified otherwise)
- **PROPER PR CREATION WORKFLOW**:
  1. **Full branch scan**: `git fetch origin && git diff origin/staging...HEAD --shortstat` to get complete diff
  2. **Create PR doc in /tmp**: Generate `PR_DOC.md` in `/tmp/pr_docs/` (OUTSIDE repo) with full template
  3. **Use gh CLI to post**: `gh pr create --title "..." --body-file /tmp/pr_docs/PR_DOC.md`
  4. **Never commit PR doc**: Keep PR documentation ephemeral in /tmp, not in repo history
- PR description must use the repository template and include:
  - Purpose/summary and scope
  - Diff summary vs target (files changed, +/- counts from full branch comparison)
  - Ahead/behind counts (`git rev-list --left-right --count origin/staging...HEAD`)
  - Test strategy and results (unit, e2e if relevant)
  - Quality gates status (build, types, lint)
  - Backwards compatibility and deployment notes
  - Risks/mitigations and reviewer checklist
- Rebase/merge policy: Check divergence and update branch before final push.

## Test execution rules (monorepo)

- **Preferred**: IDE test API (VS Code test runner) for both single tests and full suites to minimize churn and keep context scoped.
- **CLI fallback** (when IDE runner is unavailable or for CI parity):
  - `npm run test:js -- --runTestsByPath <path>` for single suite/file (multiple paths allowed)
  - `npm run test:js -- --runTestsByPath path/test.tsx --testNamePattern "specific test"` for targeted tests
  - Full unit suite: `npm test` (workspace-wide)
- Jest rule: **NEVER** use `--workspaces` with Jest (causes path conflicts and false errors)
- E2E: `npm run test:e2e` (or `npm run cypress:open` for UI)
- Performance: `npm run test:perf` (and profiling via `npm run test:profile`, `npm run test:flamegraph`)
- Types: `npm run build:types`
- Lint: `npm run lint`

## Quality gates (must pass before completion)

- Build: `npm run build`
- Types: `npm run build:types`
- Lint: `npm run lint`
- Tests: Unit tests (targeted or full as appropriate); E2E for UI/flow changes when applicable

## Repository conventions snapshot

- Monorepo: `apps/*` (interface, dashboard, mesh, pipecat-daily-bot) and `packages/*` (prism, features, events)
- Do not import from apps/\* into packages/\*
- Features under `apps/interface/src/features/<FeatureName>`
- Prism APIs preferred for data access
- Feature flags via `@nia/features` and `isFeatureEnabled`
- Events: update descriptor JSONs and add redaction paths; never emit ad-hoc payloads
- **Python logging**: ALWAYS use old-school `%` formatting: `logger.info("msg %s" % (var,))` NOT comma notation or f-strings

## Startup checklist I will follow

- Read the files listed above (in order)
- **PLANNING WORKFLOW**:
  - Create a plan document in `./docs/transitions/<feature-name>-plan.md` for non-trivial work
  - Include: objective, scope, files to modify, test strategy, risks, checkpoints
  - Update the plan document as implementation progresses (living document)
  - Prefer ONE comprehensive plan doc over multiple small documents
- Create/refresh a TODO plan; mark items in-progress one at a time
- Verify default branch and PR target from COPILOT_PROJECT.instructions.yml
- For code changes: plan → implement → run build/types/lint/tests → summarize results
- For PRs: compute diff vs target, ahead/behind, include checklist from template

## Troubleshooting

- If any required file is missing, I’ll proceed with reasonable defaults from `.github/instructions/copilot.instructions.md` and project scripts and note assumptions.

