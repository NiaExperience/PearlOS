# AGENTS.md

Guidelines for AI coding assistants working on PearlOS.

## Overview

If you are an AI assistant (Copilot, Cursor, Claude Code, etc.) helping a contributor with this codebase, follow these guidelines to produce consistent, high quality contributions.

## Key Principles

1. **TypeScript first.** All new code should be TypeScript. Avoid `any` types.
2. **Functional React.** Use hooks and functional components. No class components.
3. **Mobile first layouts.** Use `flex-direction: column`, `clamp()` for responsive fonts. Never assume wide screens.
4. **No em dashes or en dashes.** This is a house style rule. Use commas, parentheses, or restructure the sentence.
5. **Conventional Commits.** All commit messages follow the `type(scope): description` format.

## Architecture Awareness

Before making changes, read [ARCHITECTURE.md](ARCHITECTURE.md) to understand:

- The monorepo structure (apps + packages)
- The event system (Daily app-messages, niaEventRouter, CustomEvents)
- The bot tool registration pattern (`@bot_tool` decorator)
- The feature flag system

## File Conventions

- Components: PascalCase filenames (`MyComponent.tsx`)
- Utilities: camelCase filenames (`formatDate.ts`)
- Types: colocated with their module or in a `types.ts` file
- Styles: Tailwind CSS preferred over CSS modules

## Testing

- Write tests for utility functions and critical business logic
- React components: prefer integration tests over unit tests for UI behavior
- Test files live next to the code they test: `myUtil.test.ts`

## When in Doubt

- Check existing code for patterns before inventing new ones
- Smaller PRs are better than large ones
- If a change touches the voice pipeline or event system, flag it for human review

## Additional Resources

- [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide
- [docs/getting-started.md](docs/getting-started.md) for development setup
