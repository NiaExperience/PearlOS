# Domain-Specific AI Instructions

This file is **manually maintained** and lists specialized instruction files for different areas of the codebase.
It is referenced by AI_SESSION_BOOTSTRAP (auto-generated) and serves as a hub for domain expertise.

## Purpose

When working on specific areas of the codebase, AI assistants should load these targeted instruction files
to gain domain-specific patterns, anti-patterns, and best practices that go beyond the general protocol.

## Domain-Specific Instruction Files

### Backend Development

#### **PIPECAT_BOT.instructions.md**
- **When to load**: Working on `apps/pipecat-daily-bot/`
- **Covers**: 
  - Session state management patterns
  - Conflict detection with 409 responses
  - Late joiner synchronization via query endpoints
  - Event emission through Daily.co
  - Field naming conventions (camelCase JSON, snake_case Python)
  - Integration with Mesh API
  - Common pitfalls (e.g., using Daily participant ID vs database User.id)
- **Key patterns**: Session-scoped state, check-then-set conflicts, query endpoints for late joiners

### Frontend Development

#### **FRONTEND_EVENTS.instructions.md**
- **When to load**: Adding cross-component communication via CustomEvent
- **Covers**:
  - When to use events vs props/context
  - Event definition with TypeScript interfaces
  - Event emission patterns (emit after success, not before)
  - Event listening with cleanup (memory leak prevention)
  - Multiple listeners coordination
  - Event namespacing conventions
  - Testing approaches (unit + E2E)
  - Integration with backend events (snake_case conversion)
- **Key patterns**: CustomEvent with typed detail, useEffect cleanup, event catalog documentation

#### **LOCALSTORAGE.instructions.md**
- **When to load**: Persisting client-side state (queues, preferences, cache)
- **Covers**:
  - Queue with expiration pattern
  - User preferences storage
  - Cache with TTL
  - Draft auto-save
  - Error handling (try-catch JSON.parse)
  - Namespaced keys
  - Schema versioning
  - Security (never store tokens/PII)
  - Cleanup strategies
- **Key patterns**: Expiration checking, graceful error handling, versioned schemas

### Code Quality

#### **codacy.instructions.md**
- **When to load**: Always (loaded by default)
- **Covers**:
  - Running Codacy CLI after file edits
  - Security checks after dependency changes (Trivy)
  - Repository setup workflow
  - Handling analysis errors
- **Key patterns**: Immediate analysis after edits, dependency vulnerability scanning

## Loading Strategy for AI Assistants

### Automatic Loading (Recommended)
AI assistants should automatically load domain-specific instructions based on file paths:

```
File path contains:              → Load instruction file:
─────────────────────────────────────────────────────────
apps/pipecat-daily-bot/          → PIPECAT_BOT.instructions.md
CustomEvent usage detected       → FRONTEND_EVENTS.instructions.md
localStorage usage detected      → LOCALSTORAGE.instructions.md
Any file edit                    → codacy.instructions.md (default)
```

### Manual Loading (Fallback)
If automatic detection isn't available, users can request:
- "Follow the Pipecat bot patterns"
- "Use the event system instructions"
- "Apply localStorage best practices"

## Adding New Domain-Specific Instructions

When adding new instruction files:

1. **Create the file**: `.github/instructions/[DOMAIN].instructions.md`
2. **Update this file**: Add entry to "Domain-Specific Instruction Files" section
3. **Update load strategy**: Add file path pattern for automatic loading
4. **Document in README**: Note in project documentation
5. **PR review**: Have team validate patterns are accurate and complete

### Instruction File Template

```markdown
# [Domain] Instructions

## Purpose
Brief description of what this instruction file covers.

## When to Use
Specific scenarios or file paths that trigger loading this file.

## [Pattern 1 Name]

**Use case**: When you need to...

**Pattern**: 
\`\`\`[language]
// Code example
\`\`\`

**When to use**:
- Scenario 1
- Scenario 2

**Anti-pattern**: What NOT to do

### [Pattern 2 Name]
...

## Common Pitfalls
1. **Issue description**
   - ❌ Wrong: Example
   - ✅ Correct: Example

## Quality Checklist
- [ ] Requirement 1
- [ ] Requirement 2

## Related Documentation
- Link to architecture docs
- Link to feature examples
```

## Maintenance

- **Owner**: Engineering team (collective)
- **Review cadence**: Update when new patterns emerge or existing patterns evolve
- **Drift detection**: No automated sync (manually maintained for flexibility)
- **Version control**: Track changes in PR reviews; patterns should reflect current best practices

## Integration with AI Assistants

### GitHub Copilot (VSCode)
- Auto-loads `.github/instructions/*.md` files
- This file should be referenced in responses when domain-specific guidance needed

### Cursor IDE
- Supports `.cursorrules` file in repo root
- See `.cursorrules` for Cursor-specific integration

### Aider
- Supports `.aider.conf.yml` for configuration
- Can reference instruction files in prompts
- See `.aider.conf.yml` for Aider-specific integration

### Claude Desktop / Other IDEs
- May support custom system prompts or context files
- Provide direct paths to instruction files in initial prompt
- Example: "Load instructions from .github/instructions/PIPECAT_BOT.instructions.md"
