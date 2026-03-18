# Copilot Instructions (Auto-Generated)

DO NOT EDIT. Source: pearl-docs/internal/ai-assistant-protocol.md

Source SHA256: 9c9cd70e19b90e7e56f071110033679536f0b90bec201fbe6f32ee8566bc3d36
Generated: 9c9cd70e19b9

## Purpose
Provide condensed enforceable guardrails for AI sessions (plans-first, boundaries, tests, security).

## Core Principles Snapshot
| # | Title | First Sentence |
|---|-------|----------------|
| 1 | PLAN FIRST | Non-trivial tasks need plan: Objective, Scope, Files, Tests, Risks, Success criteria. |
| 2 | CONTEXT | Branch + target, paths, errors, event topics, constraints. |
| 3 | REQUESTS | "Plan migration X→Y" &#124; "Add event + schema + redaction" &#124; "Refactor Z: steps then implement". |
| 4 | RESPONSE | Task intent, requirements list, checkpoints every 3-5 files, quality gates status. |
| 5 | CHANGES | Moves first (git history), then refactors. |
| 6 | EVENTS | Update descriptor JSON + codegen + redaction before emit. |
| 7 | TESTS | Happy + edge + error cases. |
| 8 | QUALITY GATES | Must pass: npm run build, build:types, lint, test. |
| 9 | SECURITY | No secrets/PII in logs. |
| 10 | ETIQUETTE | Decisive prompts. |
| 11 | APPROVAL | Large changes: await "APPROVED". |
| 12 | VERIFICATION | ☐ Requirements met ☐ No dead code ☐ Tests pass ☐ Docs updated ☐ Rollback plan. |
| 13 | REDIRECT | NEW TASK: <objective> snapshots state and resets. |
| 14 | RED FLAGS | Code without plan &#124; Missing tests &#124; Silent events &#124; Unrelated formatting. |
| 15 | TRIVIAL | Skip plan for Q&A or one-file tweak. |
| 16 | ARCHITECTURE | Layers: packages/ ⛔ apps/. |
| 17 | JEST (MONOREPO) | ⛔ NEVER npm test --workspaces. |
| 18 | PR DOCS | Required (use template):. |
| 19 | TEST EXECUTION | Preferred: IDE test API (VS Code test runner) for both single tests and full suites to minimize churn and keep context scoped. |
| 20 | MERMAID | No special chars in labels. |
| 21 | QUICKSTART | Mono: apps/ (interface, dashboard, mesh, pipecat-daily-bot) + packages/ (prism, features, events). |
| 22 | VERSION | 1.5 &#124; 2025-10-16 &#124; Token-optimized: 3323→950 words (71% reduction). |

## Usage
Always load this plus the canonical file at session start. If hash mismatch, run: `npm run sync:ai-protocol`.
