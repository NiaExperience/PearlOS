# AI Assistant Integration Guide

This document explains how Nia Universal integrates with various AI coding assistants and how to use them effectively with our project conventions.

## Overview

Our repository includes instruction files that configure AI assistants to follow our architectural patterns, testing requirements, and code quality standards. These files ensure consistent behavior across different AI tools and team members.

## Supported AI Assistants

### ✅ GitHub Copilot (VSCode)

**Status**: Fully supported (native integration)

**Configuration**: Auto-loads `.github/instructions/*.md` files

**Usage**:
1. Open project in VSCode
2. Copilot automatically loads instruction files
3. Use Copilot Chat or inline suggestions
4. For complex tasks, explicitly request plan: "Plan this feature: [description]"

**Files**:
- Core instructions automatically loaded from `.github/instructions/`
- Domain-specific patterns in `PIPECAT_BOT.instructions.md`, `FRONTEND_EVENTS.instructions.md`, `LOCALSTORAGE.instructions.md`

### ✅ Cursor IDE

**Status**: Fully supported (via `.cursorrules`)

**Configuration**: Auto-loads `.cursorrules` file in repo root

**Usage**:
1. Open project in Cursor
2. Rules automatically loaded at session start
3. Use Composer for multi-file editing
4. Reference instruction files: `@PIPECAT_BOT.instructions.md`
5. Use Agent mode with clear acceptance criteria

**Files**:
- `.cursorrules` - Main configuration file
- References all instruction files in `.github/instructions/`

**Cursor-specific tips**:
- Use `@codebase` to search for patterns
- Reference architectural docs: `@ARCHITECTURE.md`
- For implementation tasks: "Load bootstrap instructions and plan this feature: [description]"

### ✅ Aider

**Status**: Fully supported (via `.aider.conf.yml`)

**Configuration**: Auto-loads `.aider.conf.yml` config file

**Usage**:
1. Run `aider` from repo root
2. Configuration automatically loaded
3. Instruction files automatically read
4. Use `/help` to see available commands

**Files**:
- `.aider.conf.yml` - Main configuration file
- Auto-reads instruction files listed in `read:` section

**Aider-specific tips**:
- Use `/add <file>` to add files to context
- Use `/architect` mode for design discussions
- Use `/ask` for questions without code changes
- Commits are auto-formatted with conventional commit messages

### ⚠️ Claude Desktop / Claude.ai

**Status**: Manual integration required

**Configuration**: No auto-load; must provide context manually

**Usage**:
1. Upload relevant instruction files to chat
2. Or copy/paste instructions into conversation
3. Reference specific pattern files as needed

**Files to upload**:
```
.github/instructions/AI_SESSION_BOOTSTRAP.instructions.md
.github/instructions/DOMAIN_SPECIFIC.instructions.md
ARCHITECTURE.md (optional, for context)
```

### ⚠️ ChatGPT / Other LLMs

**Status**: Manual integration required

**Configuration**: No auto-load; must provide context manually

**Usage**:
1. Copy/paste instruction files into conversation
2. Reference specific domain instructions as needed
3. Provide repository context manually

## Instruction File Architecture

### Core Instructions (Load First)

1. **`AI_SESSION_BOOTSTRAP.instructions.md`** (auto-generated)
   - Entry point for AI sessions
   - References canonical protocol
   - Load order for other files
   - Non-negotiable rules

2. **`COPILOT_STARTUP.instructions.md`**
   - Session startup checklist
   - Branching and PR protocol
   - Test execution rules
   - Quality gates

3. **`copilot.instructions.md`** (auto-generated)
   - Condensed protocol summary
   - Core principles table
   - Project quickstart
   - Architectural boundaries

### Domain-Specific Instructions

4. **`DOMAIN_SPECIFIC.instructions.md`** (hub file)
   - Lists all domain-specific instruction files
   - Loading strategy for AI assistants
   - Template for new instruction files

5. **`PIPECAT_BOT.instructions.md`**
   - Pipecat voice bot patterns
   - Session state management
   - Conflict detection
   - Late joiner sync
   - Event emission patterns

6. **`FRONTEND_EVENTS.instructions.md`**
   - CustomEvent system usage
   - Event lifecycle patterns
   - Memory leak prevention
   - Cross-component coordination

7. **`LOCALSTORAGE.instructions.md`**
   - Client-side persistence patterns
   - Queue with expiration
   - Cache with TTL
   - Security best practices

8. **`codacy.instructions.md`**
   - Codacy CLI integration
   - Auto-analysis after edits
   - Dependency vulnerability scanning

### Architectural Documentation

- **`ARCHITECTURE.md`** - Platform architecture overview
- **`DEVELOPER_GUIDE.md`** - Development setup and conventions
- **`README.testing.md`** - Test execution and strategy

## Quick Start by AI Tool

### For VSCode + Copilot users:

```bash
# Just open the project - everything auto-loads!
code nia-universal
```

### For Cursor users:

```bash
# Just open the project
cursor nia-universal

# Or from within Cursor
# File > Open Folder > nia-universal
```

### For Aider users:

```bash
cd nia-universal

# Start Aider (config auto-loads)
aider

# For specific model
aider --model gpt-4

# For architect mode
aider --architect
```

### For Claude Desktop users:

1. Open Claude Desktop
2. Start new conversation
3. Upload these files:
   - `.github/instructions/AI_SESSION_BOOTSTRAP.instructions.md`
   - `.github/instructions/DOMAIN_SPECIFIC.instructions.md`
4. Say: "I'm working on Nia Universal. Please load the bootstrap instructions and tell me what you understand about the project."

## Common AI Assistant Workflows

### Feature Development

**All tools**:
1. Start with: "Plan a feature to [description]"
2. Review plan and approve
3. Implement with quality checks
4. Run tests: `npm test`
5. Create PR: `gh pr create --base staging`

### Bug Fixes

**All tools**:
1. Describe bug clearly with reproduction steps
2. AI should investigate (read files, search code)
3. Propose fix with explanation
4. Implement and test
5. Verify fix resolves issue

### Refactoring

**All tools**:
1. State goal: "Refactor X to improve Y"
2. Request plan with phases (moves first, then edits)
3. Review impact analysis
4. Execute with test verification at each phase

### Code Review

**Cursor/Aider**:
- Use AI to review diffs before committing
- Ask: "Review my changes for potential issues"

**Copilot**:
- Use Copilot Chat: "Review the changes in my working directory"

## Team Guidelines

### When to Use AI Assistants

✅ **Good use cases**:
- Feature scaffolding and boilerplate
- Following established patterns
- Test generation
- Documentation updates
- Refactoring with tests
- Code review assistance

❌ **Poor use cases**:
- Security-critical code without review
- Database migrations (require careful review)
- Complex architectural decisions (human discussion needed)
- Changing core protocols (requires team consensus)

### Review Standards

**All AI-generated code requires**:
1. Human review before commit
2. Test coverage (manual or automated)
3. Follows project conventions
4. Passes quality gates (build, types, lint, tests)
5. PR description explains changes

### Quality Checklist

Before committing AI-generated code:

- [ ] Code follows project style guidelines
- [ ] No secrets or PII in logs
- [ ] Tests added/updated and passing
- [ ] No new lint/type errors
- [ ] Documentation updated if needed
- [ ] PR template filled out completely
- [ ] Conventional commit message format

## Troubleshooting

### AI not following instructions

**Copilot**:
- Restart VSCode
- Clear Copilot cache: Command Palette > "Copilot: Clear Chat History"
- Check instruction files are present in `.github/instructions/`

**Cursor**:
- Check `.cursorrules` file exists
- Restart Cursor
- Try explicit reference: `@.cursorrules`

**Aider**:
- Check `.aider.conf.yml` file exists
- Run `aider --check` to validate config
- View loaded config: `aider --show-model-config`

### AI makes unwanted changes

**All tools**:
- Be more specific in prompts
- Use constraints: "Only modify X, don't touch Y"
- Review diffs before accepting
- Reference specific instruction files

### AI performance issues

**All tools**:
- Reduce context size (close unnecessary files)
- Use targeted prompts
- Reference specific instruction files instead of loading all docs
- For Aider: use `/clear` to reset context

## Maintaining Instructions

### Adding New Patterns

When a successful pattern emerges:

1. Document in appropriate instruction file
2. Update `DOMAIN_SPECIFIC.instructions.md`
3. Update AI tool configs (`.cursorrules`, `.aider.conf.yml`)
4. Create PR with documentation updates
5. Team review and approval

### Updating Existing Patterns

1. Edit instruction file
2. Update examples with real code
3. Test with AI assistant
4. Create PR for review
5. Announce changes to team

### Auto-Generated Files

⚠️ **DO NOT EDIT DIRECTLY**:
- `AI_SESSION_BOOTSTRAP.instructions.md`
- `copilot.instructions.md`

These are auto-generated from `pearl-docs/internal/ai-assistant-protocol.md`.

To update:
1. Edit `pearl-docs/internal/ai-assistant-protocol.md`
2. Run `npm run sync:ai-protocol`
3. Commit both files

## FAQ

**Q: Which AI assistant should I use?**
A: Use whichever you're most comfortable with. All are fully supported with our instruction files.

**Q: Can I use multiple AI assistants?**
A: Yes! Instructions are consistent across tools. Use VSCode + Copilot for daily work, Cursor for complex refactors, Aider for command-line workflows.

**Q: Do I need to load instructions every session?**
A: No. Copilot, Cursor, and Aider auto-load instructions. Only Claude/ChatGPT require manual context.

**Q: Can I customize instructions for my workflow?**
A: Instructions are project-wide. For personal preferences, use AI assistant settings (not instruction files).

**Q: How do I propose new instruction patterns?**
A: Create PR with updates to relevant instruction file. Include examples and rationale.

**Q: What if AI suggestions violate instructions?**
A: Reject the suggestion and reference the specific instruction. Report persistent issues to team.

## Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Cursor IDE Documentation](https://cursor.sh/docs)
- [Aider Documentation](https://aider.chat/docs/)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [Project ARCHITECTURE.md](../ARCHITECTURE.md)
- [Project DEVELOPER_GUIDE.md](../DEVELOPER_GUIDE.md)

## Support

For questions or issues:
1. Check this guide first
2. Review relevant instruction files
3. Ask in team chat
4. Create issue if pattern/instruction needs update
