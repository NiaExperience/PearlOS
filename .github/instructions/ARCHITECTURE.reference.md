---
description: Concise architecture reference for AI assistants
applyTo: '**/*'
---

# Architecture Reference (Concise)

**Purpose**: Essential architectural concepts for AI-assisted development. Load full `ARCHITECTURE.md` only when working on cross-app integration or data layer changes.

## Platform Overview

**Web Apps** (Next.js):

- **Interface** (3000) - Main conversational UI, voice/text assistant
- **Dashboard** (4000) - Analytics, admin interface

**Voice Services** (Python):

- **Pipecat Daily Bot** (4444) - Real-time voice bot via Daily.co WebRTC

**Backend**:

- **Mesh** (2000) - Unified GraphQL API
- **PostgreSQL** - Data storage via Prism abstraction

## Layer Model

| Layer | Responsibility | Examples |
|-------|----------------|----------|
| **Experience Shell** | UI, user interaction | Interface/Dashboard apps |
| **Feature Layer** | Business logic, features | `apps/interface/src/features/*` |
| **Integration Edge** | External APIs, providers | YouTube, Gmail, Google Drive adapters |
| **Platform Core** | Data abstraction | Prism, Mesh, Storage |

## Core Concepts

**Features**: Self-contained modules in `apps/interface/src/features/FeatureName/`

- `definition.ts` - Content type schema
- `actions/` - Server actions (CRUD)
- `services/` - Stateful orchestration (timers, queues)
- `lib/` - Client-side pure helpers
- `components/` - React UI
- `__tests__/` - Focused tests

**Tools/Functions**: AI-invokable capabilities declared in `apps/interface/src/actions/getAssistant.tsx`

**Feature Flags**: Runtime toggles via `@nia/features` package (env-based, per-assistant overrides)

**Prism**: Feature-facing data API - abstracts storage, providers, content definitions

**Custom Events**: UI-local decoupled signaling (e.g., `desktopModeSwitch`, `youtube.volume.change`)

## Pipecat Bot (Voice)

**Pipeline**: Daily.co Transport → Deepgram STT → OpenAI LLM → ElevenLabs TTS

**Flow Nodes**: Boot (silent) → Conversation (beats) → Admin (prompts) → Wrapup (exit)

**Event Bus**: Pub/sub for participant lifecycle, greetings, pacing, heartbeat

**Mesh Integration**: GraphQL mutations for collaborative notes, context sync

**Key Files**:

- `apps/pipecat-daily-bot/bot/server.py` - FastAPI control endpoints
- `apps/pipecat-daily-bot/bot/bot.py` - Pipeline construction
- `apps/pipecat-daily-bot/bot/flows/` - Flow node definitions
- `apps/pipecat-daily-bot/bot/handlers.py` - Event handlers

## Boundary Rules

✅ **DO**:

- Features call Prism for data operations
- Use feature flags for optional surfaces
- Dispatch CustomEvents for UI coordination
- Encapsulate features in dedicated folders
- Test at feature boundaries

❌ **DON'T**:

- Query storage directly (use Prism)
- Hardcode API URLs (use env vars)
- Couple features via imports (use events/contracts)
- Add logic to barrel exports
- Mix stateful services with pure libs

## When to Load Full ARCHITECTURE.md

- Working on cross-app data flow
- Modifying Prism provider layer
- Adding new content type definitions
- Deep dive into query execution lifecycle
- Debugging Mesh GraphQL schema issues

## When to Load DEVELOPMENT.reference.md

- Setting up tests
- Creating pull requests
- Running CI/CD commands
- Understanding code standards
- Troubleshooting development environment
