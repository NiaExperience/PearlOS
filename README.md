<div align="center">

<!-- ![PearlOS Logo](docs/screenshots/Pearllogo.png) -->
<img src="docs/screenshots/Pearllogo.png" alt="PearlOS Logo" width="400" />

**Your Intelligent Environment, In Any Browser.**

<!-- *PearlOS is always thinking. Always learning. Always here to help you.* -->

[![License: PSAL-NC](https://img.shields.io/badge/License-PSAL--NC-purple.svg)](./LICENSE)
[![Discord](https://img.shields.io/discord/placeholder?label=🌌%20PEARL%20VILLAGE&logo=discord&logoColor=white&color=5865F2)](https://discord.gg/gcba4gb6kz)

</div>

---

PearlOS is an intelligent environment that runs in your browser. The AI isn't an app you open, it IS the interface. Talk to it, tap it, let it handle things. Phone, tablet, laptop, whatever. Pearl has memory, awareness, and control of your visual and audio experience, spins up swarms of intelligence for complex tasks, and gets better the more you use it.

<div align="center">

[Website](https://pearlos.org) &nbsp;|&nbsp; [Getting Started](#quick-start) &nbsp;|&nbsp; [🌌 Pearl Village (Discord)](https://discord.gg/gcba4gb6kz) &nbsp;|&nbsp; [GitHub](https://github.com/NiaExperience/PearlOS)

</div>

---

## Features

*PearlOS brings a lot to the table. Here's what you can explore:*

### Conversation & Memory


- 🎤 **Voice Companion** - Full voice conversations via PearlOS, like talking to a friend who actually helps
- 🤝 **Conversation Etiquette** - Knows when to talk and when to shut up. Reactions over noise
- 🧠 **Persistent Memory** - Remembers across sessions. Daily logs, long-term memory, cross-session sync
- ✨ **Actual Personality** - Opinions, humor, warmth, and zero "I'd be happy to help!" energy
- 💬 **Multi-Channel Chat** - Discord, Telegram, Signal, WhatsApp, iMessage, Slack, IRC, all from one brain
- 🔄 **Cross-Session Awareness** - Discord me knows what voice me just did. One entity, many surfaces
- 🔍 **Memory Search** - Semantic search across all memory files for instant context recall


### Automation & Tools

- 🤖 **Sub-Agent Swarms** - Spawn background workers for heavy tasks, get pinged when they finish
- 🔗 **Node Control** - Camera snaps, screen recording, location, and remote commands on paired devices
- ⏰ **Cron & Reminders** - Schedule anything: one-shot reminders, recurring jobs, timed agent runs
- 🌐 **Research & Act** - Search the web, fetch content, then do something with it: build, email, summarize, deploy
- 🖥️ **Browser Automation** - Full browser control for scraping, testing, or navigating complex sites
- 💻 **Shell Access** - Run commands, manage processes, deploy services, debug live systems
- 📁 **File Operations** - Read, write, edit files across the workspace by Voice. Git commits included
- 🪄 **Frontend Design** - Build production-grade web UIs from descriptions, mockups, screenshots, or vibes
- 📺 **Real-Time Desktop Content** - Weather, news, visuals, and interactive scenes rendered live on the PearlOS desktop
- 📧 **Email** - Send emails directly, no app switching required

### Intelligence & Flexibility

- ⚙️ **Skill System** - Skills for weather, image gen, transcription, coding agents, and more. She uses them and builds new ones herself
- 🎨 **Image Generation** - Create images from prompts (e.g. via OpenAI), built into the environment
- 🖼️ **Image Analysis** - Vision model for analyzing screenshots, photos, diagrams, whatever
- 📊 **Model Flexibility** - Sonnet for quick stuff, Opus for heavy lifting, swap on the fly
- ❤️ **Proactive Heartbeats** - Checks on its own: emails, services, calendar, anything worth flagging
- 🛡️ **Service Health Monitoring** - Auto-detect downed PearlOS services and restart them

### Your Stack

- 🏠 **Runs Locally** - Full stack on your machine with your own API keys. No cloud lock-in.

---

## Screenshots

<div align="center">

<table border="0" cellspacing="0" cellpadding="0">
<tr>
<td width="33%" align="center" valign="top" style="padding: 10px; border: none;">

### Desktop Interface

![PearlOS Desktop](docs/screenshots/ss2.png)

*PearlOS desktop with application icons, chat interface, and pixel-art fantasy forest background*

</td>
<td width="33%" align="center" valign="top" style="padding: 10px; border: none;">

### Task Management

![Task Management](docs/screenshots/ss3.png)

*Real-time task tracking with job status, progress indicators, and active work monitoring*

</td>
<td width="33%" align="center" valign="top" style="padding: 10px; border: none;">

### Dashboard & Analytics

![Visualization for Data Dashboard](docs/screenshots/ss1.png)

*Interactive dashboard showing stock performance analysis with Pearl's AI-powered insights*

</td>
</tr>
</table>

<!-- ### Custom Background Generation

![Custom Background Generation](docs/screenshots/ss4.png)

*AI-powered custom background generation allowing Pearl to create personalized desktop backgrounds on demand* -->

</div>

---

## Quick Start

PearlOS ships with setup scripts that handle everything: dependencies, environment files, database seeding, and bot configuration.

### Option 1: Interactive Setup Wizard (recommended)

```bash
git clone https://github.com/NiaExperience/PearlOS.git
cd PearlOS
bash scripts/root/new-setup.sh
```

The wizard walks you through preset selection (full, minimal, or custom), installs all dependencies (Node, Python, Poetry, uv), creates `.env` files with API key placeholders, seeds the database, and configures the voice bot. It works on Linux, macOS, and Windows (via Git Bash/WSL).

You can also run it non-interactively:

```bash
bash scripts/root/new-setup.sh --preset full --non-interactive
```

### Option 2: Classic Setup Script

```bash
git clone https://github.com/NiaExperience/PearlOS.git
cd PearlOS
bash scripts/root/setup.sh
```

This runs the full setup in one shot. After it finishes, add your API keys to `.env.local` and run:

```bash
npm run start:all
```

### Option 3: Manual Setup

If you prefer doing things by hand, PearlOS is a monorepo. You will need Node.js 18+, Python 3.11+, and `pnpm`.

```bash
git clone https://github.com/NiaExperience/PearlOS.git
cd PearlOS
pnpm install

# Set up environment variables
cp apps/interface/.env.example apps/interface/.env.local
cp apps/pipecat-daily-bot/.env.example apps/pipecat-daily-bot/.env
cp apps/mesh/.env.example apps/mesh/.env

# Set up the Python voice bot
cd apps/pipecat-daily-bot
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ../..

pnpm dev
```

Once running, open `http://localhost:3000`. Click the microphone icon (or just start talking) and say hello to Pearl.

> **Note:** You will need API keys for Deepgram, Daily.co, an LLM provider, and PocketTTS before the voice pipeline will work. See [Configuration](#configuration).

---

## Architecture Overview

PearlOS is three cooperating services. The browser UI talks to the voice bot via Daily.co WebRTC, and both talk to the GraphQL mesh for shared state.

```
                        ┌──────────────────────────────────────┐
                        │           Browser (User)             │
                        │                                      │
                        │  ┌─────────────────────────────────┐ │
                        │  │  apps/interface  (Next.js :3000)│ │
                        │  │                                  │ │
                        │  │  Desktop Shell  Wonder Canvas   │ │
                        │  │  Notes  YouTube  Soundtrack     │ │
                        │  │  Sprites  Feature Flags         │ │
                        │  └────────────┬────────────────────┘ │
                        └───────────────┼──────────────────────┘
                                        │
                          WebRTC (Daily.co)    GraphQL (HTTP)
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
   ┌──────────▼──────────┐   ┌──────────▼──────────┐             │
   │  apps/pipecat-daily │   │     apps/mesh        │             │
   │  -bot  (Python :4444│   │  (GraphQL  :2000)   │             │
   │                     │   │                      │             │
   │  Deepgram STT       │   │  Shared state        │             │
   │  Pipecat pipeline   │   │  Feature flags       │             │
   │  LLM (OpenAI/etc)   │   │  Session data        │             │
   │  PocketTTS (Azelma) │   │  App config          │             │
   │  50+ bot tools      │   │                      │             │
   └─────────────────────┘   └──────────────────────┘             │
                                                                   │
   External APIs: Deepgram, Daily.co, OpenAI / Anthropic, YouTube │
   ─────────────────────────────────────────────────────────────── ┘
```

---

## Port Map

| Service | Directory | Port | Description |
|---|---|---|---|
| Interface | `apps/interface` | 3000 | Next.js desktop UI |
| Voice Bot | `apps/pipecat-daily-bot` | 4444 | Pipecat + Daily.co voice pipeline |
| Mesh | `apps/mesh` | 2000 | GraphQL API / shared state |

---

## Voice Pipeline

Pearl's voice pipeline is the core of the real-time conversation experience. Here is how audio flows from your mouth to Pearl's response and back:

```
  Your mic
     |
     v
  Deepgram STT          (speech-to-text, streaming)
     |
     v
  Pipecat pipeline      (orchestration, turn detection, tool calling)
     |
     v
  LLM                   (OpenAI, Anthropic, or compatible provider)
     |
     v
  Tool execution        (50+ tools act on the desktop interface)
     |
     v
  PocketTTS             (text-to-speech, voice: Azelma)
     |
     v
  Daily.co WebRTC       (low-latency audio delivery to browser)
     |
     v
  Your speakers
```

Pipecat handles the conversation orchestration layer: VAD (voice activity detection), turn management, interrupt handling, and routing tool calls back to the interface over a shared channel. The result is a conversation that feels immediate and natural, not request-response.

---

## Desktop Apps

PearlOS ships with a set of built-in apps that Pearl can open, control, and interact with on your behalf:

<div align="center">

![Desktop Apps](docs/screenshots/desktop-apps.png)

</div>

| App | Description |
|---|---|
| Wonder Canvas | AI-generated visual content, images, and rich displays |
| Notes | Markdown notes with full Pearl read/write access |
| YouTube | Embedded YouTube player with voice control |
| Soundtrack | Ambient and contextual music player |
| Sprite Overlay | Animated character system with expressive poses |
| Settings | Feature flags, preferences, and system config |
| Task Manager | Running processes and tool execution status |

Apps are rendered as draggable, resizable windows within the desktop shell. Pearl can open any app, bring it to focus, resize it, or close it using the tool system.

---

## Tools

Pearl has access to 50+ tools organized into functional categories. These tools are what give Pearl genuine agency over the desktop environment rather than just answering questions.

### Categories

- **🖥️ Desktop and Window Management**
Open, close, focus, resize, and arrange app windows. Control the taskbar and desktop layout.
- **🪄 Wonder Canvas**
Generate and display visual content. Set canvas modes, push images, control transitions.
- **📝 Notes**
Create notes, read notes, edit content, search across notes, delete notes.
- **📺 YouTube**
Search YouTube, queue videos, play, pause, skip, seek, control volume.
- **🎵 Soundtrack**
Select ambient tracks, adjust volume, fade in/out, pause, resume playback.
- **🎭 Sprite System**
Set sprite poses, expressions, and animations. Show or hide the overlay character.
- **🚩 Feature Flags**
Enable or disable feature flags at runtime without redeployment.
- **⚡ System and UI**
Send notifications, update status displays, navigate between views, trigger UI events.
- **💬 Conversation and Memory**
Read session context, set reminders, recall prior topics, manage conversation state.
- **🌐 External Integrations**
Fetch web content, query external APIs, retrieve structured data.

---

## Configuration

Each service uses its own `.env` file. Copy the examples and fill in your keys.

### `apps/interface/.env.local`

```env
# API endpoint for the voice bot
NEXT_PUBLIC_BOT_URL=http://localhost:4444

# GraphQL mesh endpoint
NEXT_PUBLIC_MESH_URL=http://localhost:2000/graphql

# Optional: YouTube Data API key for search
YOUTUBE_API_KEY=your_youtube_api_key

# Optional: feature flag defaults
FEATURE_WONDER_CANVAS=true
FEATURE_SPRITES=true
FEATURE_SOUNDTRACK=true
```

### `apps/pipecat-daily-bot/.env`

```env
# Daily.co (WebRTC rooms)
DAILY_API_KEY=your_daily_api_key

# Deepgram (speech-to-text)
DEEPGRAM_API_KEY=your_deepgram_api_key

# LLM provider (choose one or configure multiple)
OPENAI_API_KEY=your_openai_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key

# PocketTTS (text-to-speech, voice: Azelma)
POCKET_TTS_URL=http://your-pockettts-server:port
POCKET_TTS_VOICE=Azelma

# Interface callback URL (for tool results)
INTERFACE_URL=http://localhost:3000
```

### `apps/mesh/.env`

```env
# Database connection
DATABASE_URL=postgresql://user:password@localhost:5432/pearos

# JWT secret for session validation
JWT_SECRET=your_jwt_secret

# Port (default 2000)
PORT=2000
```

---

## Project Structure

```
PearlOS/
├── apps/
│   ├── interface/              # Next.js desktop UI (port 3000)
│   │   ├── app/                # App router pages
│   │   ├── components/         # Desktop shell, windows, apps
│   │   │   ├── desktop/        # Taskbar, window manager
│   │   │   ├── apps/           # Notes, YouTube, Canvas, etc.
│   │   │   └── sprites/        # Animated overlay system
│   │   ├── lib/                # Shared utilities, hooks
│   │   ├── public/             # Static assets
│   │   └── .env.local.example
│   │
│   ├── pipecat-daily-bot/      # Voice pipeline (port 4444)
│   │   ├── bot.py              # Main bot entrypoint
│   │   ├── tools/              # 50+ Pearl tool definitions
│   │   ├── pipeline/           # Pipecat pipeline config
│   │   ├── tts/                # PocketTTS integration
│   │   ├── requirements.txt
│   │   └── .env.example
│   │
│   └── mesh/                   # GraphQL API (port 2000)
│       ├── schema/             # GraphQL schema definitions
│       ├── resolvers/          # Query and mutation resolvers
│       ├── prisma/             # Database schema and migrations
│       └── .env.example
│
├── packages/                   # Shared packages (types, utils)
├── pnpm-workspace.yaml
├── package.json
├── .github/CONTRIBUTING.md
└── README.md
```

---

## Community

PearlOS is open source and built in the open. Contributions, issues, and ideas are welcome.

- **Contributing:** Read [CONTRIBUTING.md](./.github/CONTRIBUTING.md) before opening a PR.
- **Issues:** Use GitHub Issues for bugs and feature requests.
- **Discussion:** Join the community on [Discord](https://discord.gg/gcba4gb6kz).

Built by Nia Holdings and the PearlOS community.

---

## A Quick Note from the Dev Team

PearlOS is a self-evolving operating system. You talk to Pearl in PearlOS, she builds, creates, informs, learns, evolves. This is an open source browser-based, voice and touch desktop environment powered by an intelligent learning companion named Pearl. Pearl has full awareness and control of your visual and audio experience inside PearlOS in real time, so you can think out loud, ask for anything, and watch your desktop respond. She is not an assistant embedded in a UI. She is the UI. Over time she improves understanding how you work and adapts.

We're a small team (NiaXP) and this is a very early access. We want you to help us grow Pearl together. She still has rough edges everywhere. But she is full of possibility. Plus something we believe is a first: Whenever you encounter a bug in our OS, you tell her what you wanted her to do instead. Immediately Pearl dispatches the swarm intelligence to investigate, improve, and evolve the OS code to adapt to you. Our hope is that by making it incredibly easy to build on this open source experience, anyone and everyone can become contributors to a code base run by people all over the world.

Our stack is fully open source: Next.js frontend, OpenClaw agent framework, Pipecat voice pipeline (Deepgram STT, PocketTTS running locally), Daily.co WebRTC. 70+ tools. Everything runs local first with your own keys. The reason this matters: we're at a moment where AI is already being used against the public to benefit a small group of powerful individuals. PearlOS is a complete reimagining of how the same technology which can be used to exploit humanity can instead be used to liberate us. This isn't a product demo or a research paper; it's a working canvas for people all over the world to build just by using their voice.

The goal isn't just transparency. We intend to grow a community of developers, designers, creators, scientists, artists, and innovators who take this foundation and make the power of good intelligence accessible to all.

More info: https://pearlos.org/hello

---

## License

PearlOS is released under the [PearlOS Source-Available License (PSAL-NC)](./LICENSE).

Copyright © 2026 Nia Holdings, Inc. All rights reserved.

**You can:** Use it, modify it, fork it, evolve it, experiment with it, research with it, build with it, learn from it, create culture with it.

**You cannot** monetize it, sell it, host it commercially, package it into products, build SaaS on it, or extract value from it commercially — **without a commercial license.**

PearlOS is distributed under a dual-license model:
- **Non-Commercial License** (PSAL-NC) — free for personal, research, and non-commercial use
- **Commercial License** — separate contract required for commercial use

See [LICENSE](./LICENSE) for full terms.
