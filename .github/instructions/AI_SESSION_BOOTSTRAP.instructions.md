# AI Session Bootstrap

This short file primes AI context. Full rules live in `pearl-docs/internal/ai-assistant-protocol.md`.

Source SHA256: 9c9cd70e19b90e7e56f071110033679536f0b90bec201fbe6f32ee8566bc3d36

## Load Order

1. "QUICK_REFERENCE.md" (essential quick reference)
2. ".github/instructions/copilot.instructions.md" (auto-generated summary)
3. "pearl-docs/internal/ai-assistant-protocol.md" (canonical full spec)

**On-demand references** (load only when needed):

- `ARCHITECTURE.reference.md` - Platform architecture concepts
- `DEVELOPMENT.reference.md` - Testing, PRs, CI/CD workflows
- `PIPECAT_BOT.reference.md` - Voice bot development patterns
- `FRONTEND_EVENTS.reference.md` - CustomEvent system
- `LOCALSTORAGE.reference.md` - Client storage patterns

## Focus Docs

To be aware of focused feature context, read the titles (not the content) of markdown docs in

1. the root "./docs" folder
2. "./apps/<various>" folders
3. "./packages/<various>" folders

## Non-Negotiables

- Plan first (objective, scope, test strategy) before code.
- Explicit checklist of requirements.
- No event emits without descriptor & redaction paths.
- Add tests for new behavior (happy + edge).
- Do not reformat unrelated code.
- Avoid cross-feature deep imports.
- No secrets or PII in logs.
- If scope changes: respond with FOCUS and restated scope.

## Drift Detection

Run `npm run sync:ai-protocol` after modifying the canonical file.
CI will fail if summaries are stale.
