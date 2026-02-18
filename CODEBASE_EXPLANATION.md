# Nia Universal - Complete Codebase Explanation

## Table of Contents

1. [Why Poetry is Needed](#why-poetry-is-needed)
2. [Can We Deprecate Poetry?](#can-we-deprecate-poetry)
3. [Complete Architecture Overview](#complete-architecture-overview)
4. [Application Layer Breakdown](#application-layer-breakdown)
5. [Package Layer Breakdown](#package-layer-breakdown)
6. [Data Flow & Communication](#data-flow--communication)
7. [Voice Bot System Deep Dive](#voice-bot-system-deep-dive)
8. [Feature System](#feature-system)
9. [Development Workflow](#development-workflow)

---

## Why Poetry is Needed

### Current Usage

Poetry is **only used for the Python voice bot** (`apps/pipecat-daily-bot/bot/`). It manages:

1. **Python Dependencies** - The bot requires ~30 Python packages:
   - `pipecat-ai` (voice pipeline framework)
   - `fastapi` + `uvicorn` (API server)
   - `daily-python` (Daily.co WebRTC SDK)
   - `openai` (via pipecat-ai extras)
   - `redis` (optional, for queue mode)
   - `aiohttp`, `websockets` (async networking)
   - `onnxruntime` (for Silero VAD)
   - And many more...

2. **Monorepo Path Dependencies** - Poetry handles local editable installs:
   ```toml
   nia-events = { path = "../../../packages/events/python", develop = true }
   nia-content-definitions = {path = "../../../packages/features/python"}
   nia-library-templates = {path = "../../../packages/features/python/nia_library_templates", develop = true}
   ```
   These are Python packages generated from TypeScript codegen that the bot needs to import.

3. **Virtual Environment Management** - Poetry creates isolated Python environments

4. **Dependency Resolution** - Poetry's solver handles complex dependency conflicts

### Why Not Just `pip`?

- **Path dependencies**: `pip install -e` works, but Poetry handles monorepo paths better
- **Lock file**: `poetry.lock` ensures reproducible installs across environments
- **Extras handling**: `pipecat-ai[extras]` syntax is cleaner in Poetry
- **Virtual env isolation**: Poetry manages `.venv` automatically

### The Python 3.11 Requirement

The `pyproject.toml` specifies:
```toml
python = ">=3.11,<3.14"
```

This is because:
- **Pipecat-ai** requires Python 3.11+ for modern async features
- **Type hints** use Python 3.11 syntax (`X | Y` instead of `Union[X, Y]`)
- **Performance**: Python 3.11 has significant async improvements

**This is NOT a Poetry requirement** - it's a requirement of the Python packages themselves.

---

## Can We Deprecate Poetry?

### Short Answer: **Yes, but with trade-offs**

### Option 1: Replace with `pip` + `requirements.txt`

**Pros:**
- ✅ Simpler - no Poetry installation needed
- ✅ Works on all Python versions (if packages support it)
- ✅ Standard Python tooling

**Cons:**
- ❌ Manual virtual environment management
- ❌ No lock file (less reproducible)
- ❌ Path dependencies need `pip install -e` for each package
- ❌ More complex setup script

**Implementation:**
```bash
# Create requirements.txt from pyproject.toml
# Install with:
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
pip install -e ../../../packages/events/python
pip install -e ../../../packages/features/python
```

### Option 2: Replace with `uv` (Modern Python Package Manager)

**Pros:**
- ✅ **Much faster** than Poetry (written in Rust)
- ✅ **Simpler** - single binary, no installation complexity
- ✅ **Better Windows support** - no PATH issues
- ✅ **Compatible with Poetry projects** - can read `pyproject.toml`
- ✅ **Handles path dependencies** well

**Cons:**
- ❌ Newer tool (less ecosystem maturity)
- ❌ Team needs to learn new tool

**Implementation:**
```bash
# uv can read pyproject.toml directly!
uv pip install -e .
# Or convert:
uv pip compile pyproject.toml -o requirements.txt
```

### Option 3: Keep Poetry but Fix Windows Issues

**Pros:**
- ✅ No code changes needed
- ✅ Existing lock file works
- ✅ Team already knows it

**Cons:**
- ❌ Still need to fix PATH issues
- ❌ Still requires Python 3.11+

**Fixes needed:**
- Better PATH detection in setup scripts
- Use full path to `poetry.exe` as fallback
- Create function wrappers in PowerShell

### Recommendation: **Use `uv`**

`uv` is the best middle ground:
- Fast and simple (like pip)
- Handles Poetry projects (can read `pyproject.toml`)
- Better Windows experience
- Already in your setup scripts!

**Migration path:**
1. Keep `pyproject.toml` (uv can read it)
2. Replace `poetry install` with `uv pip install -e .`
3. Update setup scripts to use `uv` instead of Poetry
4. Remove Poetry from prerequisites

---

## Complete Architecture Overview

### High-Level System

```
┌─────────────────────────────────────────────────────────────┐
│                    Nia Universal Platform                    │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Interface   │  │  Dashboard  │  │  Mesh GraphQL│      │
│  │  (Next.js)   │  │  (Next.js)  │  │  (Express)   │      │
│  │  Port: 3000  │  │  Port: 4000 │  │  Port: 2000  │      │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         └─────────────────┼─────────────────┘               │
│                           │                                 │
│                    ┌──────▼───────┐                        │
│                    │  Prism Client │                        │
│                    │  (Data Layer) │                        │
│                    └──────┬────────┘                        │
│                           │                                 │
│  ┌────────────────────────▼──────────────────────────┐     │
│  │         PostgreSQL Database (testdb)              │     │
│  │  - Content (NotionModel)                          │     │
│  │  - Users, Tenants, Assistants                     │     │
│  │  - Platform Definitions                           │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
│  ┌───────────────────────────────────────────────────┐     │
│  │         Voice Bot System (Python)                │     │
│  │  ┌──────────────┐  ┌──────────────┐             │     │
│  │  │ Bot Gateway  │  │ Bot Runner   │             │     │
│  │  │ (FastAPI)    │  │ (Pipecat)    │             │     │
│  │  │ Port: 4444   │  │              │             │     │
│  │  └──────┬───────┘  └──────┬───────┘             │     │
│  │         │                 │                       │     │
│  │         └────────┬────────┘                       │     │
│  │                  │                                │     │
│  │         ┌────────▼────────┐                       │     │
│  │         │  Daily.co       │                       │     │
│  │         │  (WebRTC)       │                       │     │
│  │         └─────────────────┘                       │     │
│  └───────────────────────────────────────────────────┘     │
│                                                             │
│  ┌───────────────────────────────────────────────────┐     │
│  │         Chorus TTS (Python)                      │     │
│  │         Port: 8000 (WebSocket)                   │     │
│  └───────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Feature-First Architecture**
   - Core is minimal (auth, data, content model)
   - Everything optional is a "feature" (isolated folder)
   - Features can be enabled/disabled via flags

2. **Multi-Tenant**
   - Each tenant has isolated data
   - Assistants belong to tenants
   - Users can belong to multiple tenants

3. **Unified Data Layer (Prism)**
   - Single API for all data access
   - Abstracts storage (PostgreSQL + future providers)
   - GraphQL interface via Mesh

4. **Voice-First**
   - Primary interaction is voice (Daily.co WebRTC)
   - Text is secondary
   - Bot handles real-time conversation

---

## Application Layer Breakdown

### 1. Interface (`apps/interface/`)

**Purpose:** Main user-facing conversational interface

**Tech Stack:**
- Next.js 15 (React)
- TypeScript
- Tailwind CSS
- Prism client (data access)

**Key Features:**
- Voice conversation UI
- Feature surfaces (Notes, HTML Generation, YouTube, etc.)
- Avatar (Rive animations)
- Desktop mode (window management)
- Real-time updates

**Structure:**
```
apps/interface/src/
├── app/                    # Next.js app router
│   ├── [assistantId]/      # Dynamic assistant routes
│   ├── api/                # API routes (server actions)
│   └── ...
├── features/               # Feature modules (isolated)
│   ├── Notes/
│   ├── HtmlGeneration/
│   ├── YouTube/
│   └── ...
├── components/             # Shared UI components
├── hooks/                  # React hooks
├── lib/                    # Utilities
└── actions/                # Server actions
```

**How It Works:**
1. User visits `/pearl` (or any assistant subdomain)
2. Page loads assistant config from Prism
3. Voice session starts (connects to Daily.co)
4. Bot joins the call
5. User speaks → Bot responds
6. Tools are invoked (create note, search YouTube, etc.)
7. UI updates reactively

### 2. Dashboard (`apps/dashboard/`)

**Purpose:** Administrative interface for managing the platform

**Tech Stack:**
- Next.js 15 (React)
- TypeScript
- Tailwind CSS
- Prism client

**Key Features:**
- Assistant management
- Tenant management
- User management
- Content definitions editor
- Analytics

**Structure:**
```
apps/dashboard/src/
├── app/                    # Next.js routes
│   ├── dashboard/          # Main dashboard
│   ├── assistants/         # Assistant management
│   └── ...
├── components/            # UI components
└── lib/                   # Utilities
```

### 3. Mesh (`apps/mesh/`)

**Purpose:** GraphQL API server that provides unified data access

**Tech Stack:**
- Express.js
- GraphQL Mesh
- Sequelize (PostgreSQL ORM)
- TypeScript

**Key Responsibilities:**
- GraphQL schema definition
- Query/mutation resolvers
- Database connection management
- Caching layer
- Provider abstraction

**Structure:**
```
apps/mesh/src/
├── resolvers/             # GraphQL resolvers
│   ├── db.ts              # Database connection
│   ├── content.ts         # Content queries
│   └── ...
├── config/                # GraphQL Mesh config
├── middleware/            # Express middleware
└── server.ts              # Entry point
```

**How It Works:**
1. Client (Interface/Dashboard) sends GraphQL query
2. Mesh resolves query using Sequelize
3. Data fetched from PostgreSQL
4. Response sent back to client
5. Caching layer stores frequent queries

### 4. Pipecat Daily Bot (`apps/pipecat-daily-bot/`)

**Purpose:** Real-time voice conversation bot

**Tech Stack:**
- Python 3.11+
- FastAPI (gateway)
- Pipecat-ai (voice pipeline)
- Daily.co (WebRTC)

**Architecture:**
```
┌─────────────────────────────────────────┐
│         Bot Gateway (FastAPI)            │
│         Port: 4444                       │
│  - Accepts /join requests                │
│  - Validates auth                        │
│  - Launches bot sessions                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Bot Runner (Pipecat)            │
│  - Connects to Daily.co room             │
│  - Processes audio (STT → LLM → TTS)     │
│  - Handles conversation flow             │
│  - Invokes tools (notes, search, etc.)   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│         Daily.co (WebRTC)                 │
│  - Real-time audio/video                 │
│  - Room management                       │
└─────────────────────────────────────────┘
```

**Key Components:**
- `bot_gateway.py` - API server
- `runner_main.py` - Bot entry point
- `bot.py` - Session lifecycle
- `pipeline/builder.py` - Builds Pipecat pipeline
- `flows/` - Conversation flow management
- `tools/` - Bot tools (notes, HTML, YouTube, etc.)
- `handlers.py` - Event handlers

**Pipeline Flow:**
```
User Speech
    ↓
Daily.co (WebRTC)
    ↓
Deepgram STT (Speech-to-Text)
    ↓
OpenAI LLM (GPT-4)
    ↓
Tool Invocation (if needed)
    ↓
TTS Provider (Kokoro/ElevenLabs)
    ↓
Daily.co (WebRTC)
    ↓
User Hears Response
```

### 5. Chorus TTS (`apps/chorus-tts/`)

**Purpose:** Local text-to-speech server (Kokoro model)

**Tech Stack:**
- Python 3.11+
- FastAPI
- WebSocket
- ONNX Runtime (for Kokoro model)

**How It Works:**
1. Bot sends text via WebSocket
2. Chorus loads Kokoro TTS model
3. Generates audio (WAV/MP3)
4. Streams audio back via WebSocket
5. Bot plays audio in Daily.co call

**Why Separate?**
- Resource-intensive (needs GPU for best performance)
- Can be scaled independently
- Optional (can use ElevenLabs instead)

---

## Package Layer Breakdown

### 1. Prism (`packages/prism/`)

**Purpose:** Unified data access abstraction layer

**Key Concepts:**
- **Providers**: Data sources (PostgreSQL, future: REST APIs, etc.)
- **Content Model**: Single table with JSON content
- **Indexer**: Optimized JSON for queries
- **Queries**: Type-safe query builder

**Structure:**
```
packages/prism/src/
├── core/                   # Core Prism logic
│   ├── provider/           # Provider abstraction
│   ├── query/              # Query builder
│   ├── content/            # Content model
│   └── ...
├── data-bridge/           # Bridge to Mesh GraphQL
└── index.ts               # Public API
```

**Usage:**
```typescript
// In a feature
import { prism } from '@nia/prism';

// Query content
const notes = await prism.content.findMany({
  type: 'Note',
  tenantId: currentTenant.id
});

// Create content
await prism.content.create({
  type: 'Note',
  content: { title: 'My Note', body: '...' },
  tenantId: currentTenant.id
});
```

### 2. Features (`packages/features/`)

**Purpose:** Feature flag system and content definitions

**Key Concepts:**
- **Feature Flags**: Runtime gating (`NEXT_PUBLIC_FEATURE_*`)
- **Content Definitions**: Type definitions for dynamic content
- **Library Templates**: Reusable content templates

**Structure:**
```
packages/features/
├── src/
│   ├── feature-flags.ts   # Flag evaluation
│   ├── definitions/        # Content type definitions
│   └── templates/         # Library templates
├── python/                 # Python codegen (for bot)
└── descriptors/           # JSON definitions
```

**Usage:**
```typescript
import { isFeatureEnabled } from '@nia/features';

if (isFeatureEnabled('notes', assistant.supportedFeatures)) {
  // Show notes feature
}
```

### 3. Events (`packages/events/`)

**Purpose:** Event system for cross-component communication

**Key Concepts:**
- **Event Descriptors**: JSON definitions of events
- **Type Safety**: Generated TypeScript types
- **PII Redaction**: Automatic sensitive data removal

**Structure:**
```
packages/events/
├── descriptors/            # JSON event definitions
├── src/
│   └── generated/         # Generated TypeScript
└── python/                 # Python codegen (for bot)
```

**Usage:**
```typescript
import { emitEvent } from '@nia/events';

emitEvent('voice.session.started', {
  sessionId: '...',
  assistantId: '...'
});
```

### 4. Redis (`packages/redis/`)

**Purpose:** Redis client wrapper (optional, for caching/queues)

**Key Concepts:**
- **Pub/Sub**: Event broadcasting
- **Caching**: Query result caching
- **Messaging**: Queue management

**Usage:**
```typescript
import { redis } from '@nia/redis';

// Publish event
await redis.publish('channel', { data: '...' });

// Cache query
await redis.set('key', value, { ttl: 3600 });
```

---

## Data Flow & Communication

### Request Flow (Voice Conversation)

```
1. User speaks in browser
   ↓
2. Daily.co captures audio
   ↓
3. Bot Gateway receives /join request
   ↓
4. Bot Runner starts (Pipecat pipeline)
   ↓
5. Deepgram STT converts speech → text
   ↓
6. OpenAI LLM processes text
   ↓
7. LLM decides to invoke tool (e.g., "create a note")
   ↓
8. Bot calls Mesh GraphQL API
   ↓
9. Mesh queries PostgreSQL
   ↓
10. Response sent back to bot
   ↓
11. Bot generates response text
   ↓
12. TTS converts text → audio
   ↓
13. Audio sent to Daily.co
   ↓
14. User hears response
```

### Data Access Flow

```
Interface/Dashboard
   ↓ (Prism Client)
Mesh GraphQL API
   ↓ (Sequelize ORM)
PostgreSQL Database
   ↓
Content Table (NotionModel)
   - type: 'Note' | 'Assistant' | ...
   - content: JSON
   - indexer: JSON (GIN indexed)
   - tenant_id: UUID
```

### Feature Communication

```
Feature A (Notes)
   ↓ (CustomEvent)
Browser Window Manager
   ↓ (State Update)
Feature B (UI Update)
```

Features don't directly import each other - they communicate via:
- **Events**: CustomEvent for UI coordination
- **Prism**: Shared data access
- **Context**: React context for shared state

---

## Voice Bot System Deep Dive

### Bot Gateway (`bot_gateway.py`)

**Responsibilities:**
- Accept HTTP POST `/join` requests
- Validate authentication
- Launch bot sessions
- Handle direct mode (no Redis) or queue mode (with Redis)

**Key Endpoints:**
- `POST /join` - Start a bot session
- `POST /admin` - Send admin commands to running bot

**Modes:**
1. **Direct Mode** (`USE_REDIS=false`):
   - Gateway directly launches bot runner
   - Simpler, good for local dev
   - No queue, no scaling

2. **Queue Mode** (`USE_REDIS=true`):
   - Gateway pushes job to Redis queue
   - Operator watches queue and spawns runners
   - Scalable, production-ready

### Bot Runner (`runner_main.py`)

**Responsibilities:**
- Initialize Pipecat pipeline
- Connect to Daily.co room
- Process audio frames
- Handle conversation flow
- Invoke tools

**Pipeline Components:**
- **DailyTransport**: WebRTC connection
- **DeepgramSTT**: Speech-to-text
- **OpenAILLM**: Language model
- **TTS Provider**: Text-to-speech (Kokoro/ElevenLabs)
- **SileroVAD**: Voice activity detection

### Conversation Flow (`flows/`)

**Flow Nodes:**
- **Boot**: Initialization, greeting
- **Conversation**: Main chat loop
- **Admin**: Admin command handling
- **Wrapup**: Session cleanup

**Flow Manager:**
- Manages state transitions
- Handles events
- Coordinates tool invocations

### Tools (`tools/`)

**Available Tools:**
- `create_note` - Create a note
- `search_notes` - Search existing notes
- `create_html_content` - Generate HTML mini-app
- `search_youtube` - Search YouTube videos
- `open_window` - Desktop mode window management
- And more...

**Tool Invocation:**
1. LLM decides to call tool
2. Bot executes tool function
3. Tool may call Mesh API
4. Result sent back to LLM
5. LLM generates response

---

## Feature System

### What is a Feature?

A feature is an **optional, isolated capability** that:
- Lives in `apps/interface/src/features/<Name>/`
- Can be enabled/disabled via feature flag
- Doesn't depend on other features
- Exports a public API via `index.ts`

### Feature Structure

```
features/Notes/
├── definition.ts          # Content type definition
├── actions/              # Server actions
│   └── notes-actions.ts
├── components/           # React UI
│   └── NotesView.tsx
├── lib/                  # Utilities
│   └── note-utils.ts
├── routes/               # API routes
│   └── route.ts
├── __tests__/            # Tests
└── index.ts              # Barrel exports
```

### Adding a Feature

1. Create folder: `apps/interface/src/features/MyFeature/`
2. Add components, actions, etc.
3. Export public API in `index.ts`
4. Add feature flag in `packages/features/`
5. Gate UI with `isFeatureEnabled()`

### Feature Flags

**Environment Variables:**
```bash
NEXT_PUBLIC_FEATURE_NOTES=true
NEXT_PUBLIC_FEATURE_YOUTUBE=false
```

**Per-Assistant:**
```typescript
assistant.supportedFeatures = ['notes', 'youtube']
```

**Evaluation:**
- Feature enabled if:
  1. In `assistant.supportedFeatures` AND
  2. Environment flag is enabled

---

## Development Workflow

### Starting Development

```bash
# 1. Install dependencies
npm install

# 2. Run setup (creates .env files, seeds DB)
./setup.sh  # or setup.ps1 on Windows

# 3. Start everything
npm run start:all
```

### Adding a New Feature

1. Create feature folder
2. Add components/actions
3. Export in `index.ts`
4. Add feature flag
5. Write tests
6. Use in Interface

### Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Type checking
npm run type-check

# Linting
npm run lint
```

### Database Changes

1. Update Sequelize models in `apps/mesh/src/`
2. Create migration (if needed)
3. Update Prism types
4. Test queries

---

## Summary

### Why Poetry?
- **Only for Python bot** - manages ~30 dependencies
- **Handles monorepo paths** - local editable installs
- **Lock file** - reproducible installs
- **Virtual envs** - isolation

### Can We Remove It?
- **Yes** - replace with `uv` (recommended) or `pip`
- **Trade-off**: Simpler setup vs. less mature tooling
- **Python 3.11 requirement** is from packages, not Poetry

### Architecture
- **Feature-first**: Core is minimal, features are isolated
- **Multi-tenant**: Data isolation per tenant
- **Voice-first**: Primary interaction is voice
- **Unified data**: Prism abstracts all data access

### Key Components
- **Interface**: Main UI (Next.js)
- **Dashboard**: Admin UI (Next.js)
- **Mesh**: GraphQL API (Express)
- **Bot**: Voice conversation (Python)
- **Chorus**: TTS server (Python)
- **Prism**: Data abstraction (TypeScript)
- **Features**: Feature system (TypeScript)

This architecture allows rapid feature development while keeping the core stable and maintainable.

