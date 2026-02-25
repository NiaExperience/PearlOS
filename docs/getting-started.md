# Getting Started with PearlOS

Welcome! This guide will get you from zero to a running PearlOS instance.

## Prerequisites

- **Node.js** 20+ (we recommend using [nvm](https://github.com/nvm-sh/nvm))
- **pnpm** (or npm/yarn, but pnpm is preferred)
- **Python 3.10+** (for the voice pipeline)
- **Docker** (optional, for containerized deployment)

## Quick Start

### Option A: Setup Wizard (recommended)

```bash
git clone https://github.com/AIMindOrg/PearlOS.git
cd PearlOS
bash new-setup.sh
```

The interactive wizard handles everything: Node, Python, dependencies, `.env` files, database seeding, and bot configuration. Works on Linux, macOS, and Windows (Git Bash/WSL).

For a non-interactive full setup:

```bash
bash new-setup.sh --preset full --non-interactive
# or simply:
bash setup.sh
```

After setup, add your API keys to `.env.local` and run `npm run start:all`.

### Option B: Manual Setup

#### 1. Clone the repo

```bash
git clone https://github.com/AIMindOrg/PearlOS.git
cd PearlOS
```

#### 2. Install dependencies

```bash
pnpm install
```

#### 3. Set up environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the required values. At minimum you will need:

- An LLM API key (Anthropic, OpenAI, or OpenRouter)
- A [Daily.co](https://daily.co) API key (for voice/WebRTC)
- A [Deepgram](https://deepgram.com) API key (for speech to text)

#### 4. Start the development server

```bash
# Start the Next.js frontend
pnpm --filter interface dev

# In a separate terminal, start the bot gateway
cd apps/pipecat-daily-bot/bot
uvicorn bot_gateway:app --host 0.0.0.0 --port 4444
```

#### 5. Open PearlOS

Visit `http://localhost:3000` in your browser. You should see the PearlOS desktop.

## Architecture Overview

PearlOS is a monorepo with several interconnected services:

| Service | Port | Description |
|---------|------|-------------|
| Next.js Frontend | 3000 | The desktop UI and app framework |
| Bot Gateway | 4444 | Voice pipeline orchestration via Pipecat |
| Mesh | 2000 | GraphQL API for data and state |
| PocketTTS | 8766 | Text to speech engine |

For the full architecture breakdown, see [ARCHITECTURE.md](../ARCHITECTURE.md).

## What's Next?

- Explore the desktop: try Notes, YouTube, Calculator, and Wonder Canvas
- Check out the [CONTRIBUTING.md](../CONTRIBUTING.md) guide if you want to contribute
- Read [ARCHITECTURE.md](../ARCHITECTURE.md) to understand how the pieces fit together
- Join the community and say hello!

## Troubleshooting

**Port already in use?** Check if another process is using ports 3000, 4444, 2000, or 8766.

**Voice not working?** Make sure your Daily.co and Deepgram API keys are set correctly in `.env.local`. The voice pipeline requires both services.

**Missing dependencies?** Run `pnpm install` again from the repo root. If Python dependencies are missing, check `apps/pipecat-daily-bot/requirements.txt`.
