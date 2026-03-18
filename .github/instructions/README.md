# AI Instructions Directory

Concise, token-efficient instructions. Start with the quick card, then load deeper topics only when relevant.

## Quickstart Card (auto-loaded)
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) — start here; core guardrails, quality gates, when to load references
- [AI_SESSION_BOOTSTRAP.instructions.md](AI_SESSION_BOOTSTRAP.instructions.md) — load order, non-negotiables
- [copilot.instructions.md](copilot.instructions.md) — condensed protocol summary
- [COPILOT_STARTUP.instructions.md](COPILOT_STARTUP.instructions.md) — startup checklist, branching, testing rules
- [codacy.instructions.md](codacy.instructions.md) — Codacy CLI enforcement (always active)

## Workflow Mini-Cards (open only when needed)
- Planning & Architecture: [ARCHITECTURE.reference.md](ARCHITECTURE.reference.md)
- Implementation patterns & commands: [DEVELOPMENT.reference.md](DEVELOPMENT.reference.md)
- Testing/Debugging (IDE-first, CLI fallback): [DEVELOPMENT.reference.md](DEVELOPMENT.reference.md)
- Cross-service integrations: [FRONTEND_EVENTS.reference.md](FRONTEND_EVENTS.reference.md), [PIPECAT_BOT.reference.md](PIPECAT_BOT.reference.md), [LOCALSTORAGE.reference.md](LOCALSTORAGE.reference.md)
- Instruction maintenance/pattern catalog: [DOMAIN_SPECIFIC.reference.md](DOMAIN_SPECIFIC.reference.md)

## Norms (non-negotiable)
- Plan first; checkpoints every 3–5 files
- Feature flags for optional capabilities; events need descriptor + redaction before emit
- Use Prism for data access; no `apps/*` imports inside `packages/*`
- Prefer IDE test runner (VS Code test API) for single and batch runs; CLI fallback allowed; never `--workspaces` with Jest
- Keep secrets/PII out of logs; structured logging; no unrelated reformatting

## Updating Auto-Generated Files
- Edit source: [pearl-docs/internal/ai-assistant-protocol.md](../../pearl-docs/internal/ai-assistant-protocol.md)
- Regenerate summaries: `npm run sync:ai-protocol`
- Commit source + generated `.instructions.md` together

## Adding or Updating References
- Create `[DOMAIN].reference.md` for deep guidance
- Add a short pointer in [QUICK_REFERENCE.md](QUICK_REFERENCE.md) under “When to load”
- Keep `.instructions.md` files <500 words; `.reference.md` can be longer

Default target branch: `staging`. PR template: [PULL_REQUEST_TEMPLATE.md](../../PULL_REQUEST_TEMPLATE.md).
