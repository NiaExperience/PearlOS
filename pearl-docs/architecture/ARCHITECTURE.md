# PearlOS Architecture

## System Overview

PearlOS is an AI native personal operating system: a voice first, agentic desktop environment where an AI companion (Pearl) has full awareness and control of the user's visual and audio experience.

The system is a monorepo with several interconnected services that together deliver a complete AI desktop.

```
┌─────────────────────────────────────────────────────┐
│                    User (Browser)                     │
│                                                       │
│  ┌─────────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Desktop UI  │  │  Voice   │  │ Wonder Canvas  │  │
│  │  (Next.js)   │  │ (WebRTC) │  │  (Rich Views)  │  │
│  └──────┬───────┘  └────┬─────┘  └───────┬────────┘  │
└─────────┼───────────────┼────────────────┼────────────┘
          │               │                │
     Port 3000       Daily.co         Event Bus
          │               │                │
┌─────────▼───────────────▼────────────────▼────────────┐
│                   Backend Services                     │
│                                                        │
│  ┌──────────────┐  ┌────────────┐  ┌──────────────┐  │
│  │  Bot Gateway  │  │    Mesh    │  │  PocketTTS   │  │
│  │  (Pipecat)    │  │  (GraphQL) │  │  (Azelma)    │  │
│  │  :4444        │  │  :2000     │  │  :8766       │  │
│  └──────────────┘  └────────────┘  └──────────────┘  │
└───────────────────────────────────────────────────────┘
```

## Port Map

| Port | Service | Description |
|------|---------|-------------|
| 3000 | Next.js | Frontend desktop environment |
| 4444 | Bot Gateway | Voice pipeline orchestration (Pipecat + Daily.co) |
| 2000 | Mesh | GraphQL API for data, state, and inter-service communication |
| 8766 | PocketTTS | Text to speech engine (voice: Azelma) |

## Monorepo Structure

```
PearlOS/
├── apps/
│   ├── interface/          # Next.js frontend (the desktop)
│   ├── pipecat-daily-bot/  # Voice pipeline (Pipecat + bot logic)
│   ├── mesh/               # GraphQL API layer
│   └── dashboard/          # Admin dashboard
├── packages/               # Shared libraries and utilities
├── docs/                   # Documentation
└── .github/                # CI, issue templates, workflows
```

## Voice Pipeline

The voice system is a core differentiator. Here is the full path from user speech to AI response:

```
User speaks
    │
    ▼
Daily.co WebRTC (browser to server)
    │
    ▼
Deepgram STT (speech to text)
    │
    ▼
Pipecat Orchestration (bot gateway :4444)
    │
    ▼
LLM (Anthropic Claude / configurable)
    │
    ▼
PocketTTS :8766 (text to speech, voice: Azelma)
    │
    ▼
Daily.co WebRTC (server to browser)
    │
    ▼
User hears Pearl respond
```

**Key components:**
- **Deepgram** provides real time speech to text with low latency
- **Pipecat** orchestrates the full pipeline: VAD, STT, LLM, TTS, transport
- **PocketTTS** generates speech output using the Azelma voice model
- **Daily.co** handles WebRTC transport for both input and output audio

## Desktop Environment

The frontend (`apps/interface`) implements a windowed desktop with:

- **Window Manager:** Draggable, resizable windows with z-index management
- **Built in Apps:** Notes, YouTube, Calculator, Browser
- **Wonder Canvas:** Rich visual content renderer for AI generated displays
- **Sprite System:** Animated overlays with bot framework for interactive elements
- **Soundtrack:** Ambient music system with persistent playback across desktop modes
- **Desktop Modes:** HOME and WORK modes with different layouts and behaviors

### Window Types

Each app runs in a managed window with standard controls (close, minimize, resize). Windows are registered through a central window manager that handles focus, positioning, and lifecycle.

## Event System

PearlOS uses a layered event architecture for communication between the voice pipeline, backend services, and frontend:

```
Bot Gateway (tool call)
    │
    ▼
Daily.co app-message
    │
    ▼
AppMessageForwarder (frontend)
    │
    ▼
niaEventRouter (dispatcher)
    │
    ▼
React CustomEvents (component handlers)
```

**Flow:** When the AI decides to perform an action (open a note, play music, show a canvas), the bot gateway sends it as a Daily app-message. The frontend's `AppMessageForwarder` picks it up, routes it through `niaEventRouter`, and dispatches the appropriate CustomEvent for React components to handle.

## Bot Tools

Pearl has access to 71+ tools organized into categories:

| Category | Count | Examples |
|----------|-------|---------|
| View / App Management | 19 | Open/close/focus windows, switch desktop modes |
| Notes CRUD | 13 | Create, read, update, delete, search notes |
| HTML / Applet Creation | 6 | Generate and display interactive HTML content |
| YouTube | 4 | Search, play, pause, queue management |
| Window Management | 6 | Resize, move, arrange, snap windows |
| Sharing | 5 | Screenshot, export, share content |
| Soundtrack | 5 | Play, pause, skip, volume, queue |
| Profile | 2 | User preferences and settings |
| Misc | 6 | Calculator, timer, system info |

### Tool Registration

Tools are registered using the `@bot_tool` decorator and discovered automatically by `BotToolDiscovery`:

```python
@bot_tool(
    name="create_note",
    description="Create a new note with the given title and content",
    parameters={...}
)
async def create_note(self, title: str, content: str):
    ...
```

## Feature Flags

PearlOS uses a feature flag system (`@nia/features`) to progressively enable capabilities:

- Flags are defined in the `supportedFeatures` list
- Each feature can be toggled independently
- The bot gateway checks flags before exposing tools
- Example: `openclawBridge` gates the OpenClaw integration tools

## Data Layer

**Mesh** (`:2000`) provides a GraphQL API for:

- Notes storage and retrieval
- User preferences
- Session state
- Inter-service data sharing

Components query Mesh directly for data operations, keeping the frontend decoupled from specific storage backends.

## Key Design Decisions

1. **Voice first:** Every feature should work via voice. Visual UI is complementary, not primary.
2. **Mobile first layouts:** All UI uses vertical stacking (`flex-direction: column`), `clamp()` for responsive sizing. No side by side layouts that break on small screens.
3. **Event driven updates:** The frontend reacts to events rather than polling. This keeps the UI responsive during voice interactions.
4. **Tool based AI:** Pearl interacts with the system through explicit, typed tools rather than free form code execution. This provides safety and auditability.
5. **Monorepo:** All services live together for easy cross-cutting changes and shared types.
