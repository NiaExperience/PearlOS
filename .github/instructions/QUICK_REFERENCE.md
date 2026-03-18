# AI Quick Reference - Nia Universal

**Load this first. Load detailed guides only when needed.**

## Repository Rules (Non-Negotiable)

- ✅ Plan first for multi-step tasks
- ✅ Run tests after changes: `npm test`
- ❌ NEVER use `--workspaces` with Jest
- ❌ NO secrets/PII in logs
- ❌ NO `apps/*` imports in `packages/*`

## Common Patterns

### Pipecat Bot (apps/pipecat-daily-bot/)
**When**: Adding bot endpoints, session state, conflict handling
**Load**: `PIPECAT_BOT.reference.md` (only if working on bot)
**Quick tips**: Use module-level state, return 409 for conflicts, query endpoints for late joiners

### Frontend Events (CustomEvent)
**When**: Cross-component communication (DailyCall ↔ NotesView)
**Load**: `FRONTEND_EVENTS.reference.md` (only if using events)
**Quick tips**: Emit after success, cleanup in useEffect, typed detail interfaces

### Client Storage (localStorage)
**When**: Persistence, queues, preferences, cache
**Load**: `LOCALSTORAGE.reference.md` (only if using localStorage)
**Quick tips**: Try-catch JSON.parse, check expiration, namespace keys

## Quality Gates (Must Pass)

Preferred: IDE test runner (VS Code test API) for single or batch runs; CLI fallback when IDE runner is unavailable.

```bash
npm run build        # Build all apps
npm run build:types  # TypeScript check
npm run lint         # Lint check
npm test             # Unit tests (or targeted via npm run test:js -- --runTestsByPath)
```

## File Structure

```
apps/interface/src/features/<Name>/  # Feature code
packages/prism/                      # Data access (use this)
packages/events/                     # Event descriptors
```

## PR Workflow

1. Branch from `staging`
2. Follow `PULL_REQUEST_TEMPLATE.md`
3. Test: IDE runner preferred; CLI fallback `npm test`
4. Submit: `gh pr create --base staging`

## When to Load Detailed References

| Workflow | What to load |
|--------------|---------------------|
| Planning / Architecture | ARCHITECTURE.reference.md |
| Implementation patterns | DEVELOPMENT.reference.md (structure, commands) |
| Testing / Debugging | DEVELOPMENT.reference.md (test matrix, CLI fallbacks) |
| Cross-service integrations | FRONTEND_EVENTS.reference.md (events), PIPECAT_BOT.reference.md (bot), LOCALSTORAGE.reference.md (client storage) |
| Instruction maintenance | DOMAIN_SPECIFIC.reference.md |

## Common Anti-Patterns

❌ Daily.co participant ID as user ID (use database User.id)  
❌ Event listeners without cleanup (memory leaks)  
❌ Storing tokens in localStorage  
❌ Emitting events before action completes  
❌ Deep cross-feature imports  

**Token budget**: ~300 words. Load `.reference.md` files only when needed!

Full docs available in workspace root (load on-demand):

- `pearl-docs/architecture/ARCHITECTURE.md` - Complete platform architecture
- `pearl-docs/development/DEVELOPER_GUIDE.md` - Comprehensive development guide
- `pearl-docs/development/README.testing.md` - Full testing documentation
- `pearl-docs/internal/ai-assistant-protocol.md` - Complete AI assistant protocol
