# PearlOS + OpenClaw Integration Setup

**Version:** 1.0  
**Last Updated:** 2026-02-16  
**Status:** Production-ready

---

## Overview

This integration connects PearlOS (Nia Universal platform) with OpenClaw to create a unified AI assistant experience across:
- **Voice** (PearlOS visual desktop)
- **Discord** (group chat / DMs)
- **Telegram** (mobile messaging)
- **Webchat** (browser interface)

**Key Features:**
- **Shared memory** across all channels (activity log, user preferences)
- **Transparent escalation** from fast model (Deepseek/GPT) to deep reasoning (Opus)
- **71+ PearlOS tools** available to OpenClaw (notes, YouTube, window mgmt, etc.)
- **Cross-session awareness** (voice Pearl knows what Discord Pearl discussed)

---

## Prerequisites

### Required
- **Node.js** >= 22.22.0
- **Python** >= 3.11
- **Redis** (optional but recommended for shared state)
- **PostgreSQL** (for Mesh API / Notes storage)

### API Keys
At minimum, you need ONE of:
- **Anthropic API Key** (for Claude models)
- **OpenAI API Key** (for GPT models)
- **Deepseek API Key** (for Deepseek V3 - recommended for voice)

### Optional API Keys
- **OpenRouter API Key** (for uncensored models like Hermes/Dolphin)
- **Groq API Key** (for Llama 4 Scout - ultra-fast inference)
- **MiniMax API Key** (for M2.5 - near-Opus quality at 8x speed)
- **ElevenLabs API Key** (premium TTS - PocketTTS works great too)

---

## Installation

### 1. Clone and Install Dependencies

```bash
git clone https://github.com/yourusername/nia-universal.git
cd nia-universal
npm install
```

### 2. Install OpenClaw

```bash
npm install -g openclaw
openclaw wizard
```

Follow the wizard to:
- Set up authentication (Anthropic/OpenAI/Deepseek)
- Configure workspace directory (default: `~/.openclaw/workspace`)
- Enable channels (Discord, Telegram optional)

### 3. Configure PearlOS Bot

```bash
cd apps/pipecat-daily-bot
cp .env.example .env
```

Edit `.env` and set:

```bash
# === REQUIRED ===
DAILY_API_KEY=your_daily_co_api_key
DAILY_ROOM_URL=https://yourcompany.daily.co/yourroom
OPENAI_API_KEY=your_openai_key  # OR Deepseek/Anthropic
MESH_API_ENDPOINT=http://localhost:2000/api

# === OPENCLAW INTEGRATION ===
OPENCLAW_API_URL=http://localhost:18789/v1
OPENCLAW_API_KEY=your_openclaw_gateway_token  # From openclaw wizard
OPENCLAW_WORKSPACE=/root/.openclaw/workspace  # Or your custom path

# === MODEL SELECTION ===
# Primary model for voice conversations (fast, cheap)
BOT_MODEL_SELECTION=deepseek-chat  # Options: deepseek-chat, gpt-4o-mini, minimax-m2.5

# Escalation model for complex tasks (slow, smart)
BOT_ESCALATION_MODEL=anthropic/claude-opus-4-6  # Options: opus, sonnet, deepseek-chat

# === TTS PROVIDER ===
BOT_TTS_PROVIDER=pocket  # Options: pocket, elevenlabs, kokoro
POCKET_TTS_URL=http://localhost:8766  # If using PocketTTS

# === API KEYS (based on chosen models) ===
DEEPSEEK_API_KEY=your_deepseek_key  # If using Deepseek
ANTHROPIC_API_KEY=your_anthropic_key  # If using Claude
GROQ_API_KEY=your_groq_key  # Optional - for Llama 4 Scout
MINIMAX_API_KEY=your_minimax_key  # Optional - for M2.5
```

### 4. Install PocketTTS (Recommended for Voice)

```bash
pip install pocket-tts
pocket-tts serve --voice azelma --port 8766 --host 0.0.0.0
```

Leave this running in the background.

### 5. Start Services

**Terminal 1: Mesh API (Notes/DB)**
```bash
cd apps/mesh
npm run dev  # Runs on port 2000
```

**Terminal 2: PearlOS Interface**
```bash
cd apps/interface
npm run dev  # Runs on port 3000
```

**Terminal 3: Bot Gateway**
```bash
cd apps/pipecat-daily-bot
uvicorn bot.bot_gateway:app --host 0.0.0.0 --port 4444
```

**Terminal 4: OpenClaw Gateway**
```bash
openclaw gateway start  # Runs on port 18789
```

---

## Verification

### Check Services

```bash
# OpenClaw
curl http://localhost:18789/v1/models

# Bot Gateway
curl http://localhost:4444/health

# Mesh API
curl http://localhost:2000/api/health

# PocketTTS (if using)
curl http://localhost:8766/health
```

### Test Integration

```bash
# Run OpenClaw integration test
cd /workspace/nia-universal
./scripts/test-openclaw-pearlos.sh
```

Expected output:
```
✓ Bot gateway is healthy
✓ pearlos-tool CLI installed
✓ 71 tools discoverable
✓ PearlOS skill installed in OpenClaw
```

---

## Usage

### Voice Session (PearlOS)

1. Open browser to `http://localhost:3000`
2. Join the Daily.co room
3. Say "Hey Pearl, what can you do?"

**Simple tasks** (handled by primary model, ~2-3s):
- "Open notes"
- "Play a YouTube video about space"
- "Set soundtrack volume to 70%"

**Complex tasks** (escalated to Opus, ~5-10s):
- "Research the latest AI developments and create a summary note"
- "Explain quantum entanglement and its applications"
- "Send a Discord message to Friend saying hello"

Pearl will automatically escalate when she needs deeper thinking. You'll hear a brief pause ("Let me think about that...") while Opus processes.

### Discord/Telegram

OpenClaw runs in the background. Mention `@Pearl` in Discord or message the bot directly in Telegram.

**Cross-session awareness:**
- If you had a voice conversation about topic X
- Then message Pearl on Discord asking "What were we talking about?"
- She'll know because the voice session wrote to `memory/activity-log.md`

---

## Configuration

### Model Selection Strategy

**Recommended setup for production:**
- **Primary:** `deepseek-chat` or `gpt-4o-mini` (fast, cheap, good enough for 90% of tasks)
- **Escalation:** `anthropic/claude-opus-4-6` (slow, expensive, brilliant for complex work)

**Budget-conscious:**
- **Primary:** `gpt-4o-mini` ($0.15/M tokens)
- **Escalation:** `anthropic/claude-sonnet-4-5` ($3/M tokens, not as smart as Opus but cheaper)

**Maximum intelligence:**
- **Primary:** `minimax-m2.5` (near-Opus quality, sub-second tool calls)
- **Escalation:** `anthropic/claude-opus-4-6`

### Escalation Timeout

If Opus calls are timing out, increase:
```bash
BOT_ESCALATION_TIMEOUT=60  # Default: 45 seconds
```

### Memory System

**Workspace files** (read by all sessions):
- `SOUL.md` - Pearl's personality and identity
- `IDENTITY.md` - Personal details (name, emoji, etc.)
- `USER.md` - Information about the user
- `AGENTS.md` - Operational instructions
- `TOOLS.md` - Notes about environment (camera names, SSH hosts, etc.)
- `memory/activity-log.md` - Cross-session activity log
- `memory/YYYY-MM-DD.md` - Daily notes

**Voice sessions now WRITE to activity log** when they end. This enables cross-session awareness.

---

## Troubleshooting

### "OpenClaw bridge unavailable" in voice

**Cause:** Bot can't reach OpenClaw Gateway  
**Fix:**
```bash
# Check OpenClaw is running
openclaw status

# Verify port
curl http://localhost:18789/v1/models

# Check .env has correct OPENCLAW_API_URL
grep OPENCLAW_API_URL apps/pipecat-daily-bot/.env
```

### "Insufficient API credits" error

**Cause:** Deepseek/Anthropic/OpenAI account has no credits  
**Fix:** Top up at:
- Deepseek: https://platform.deepseek.com/usage
- Anthropic: https://console.anthropic.com/settings/billing
- OpenAI: https://platform.openai.com/account/billing

### Voice session hangs on "thinking"

**Cause:** Opus escalation timing out  
**Fix:**
```bash
# Increase timeout in .env
BOT_ESCALATION_TIMEOUT=60

# Or switch escalation model to Sonnet (faster)
BOT_ESCALATION_MODEL=anthropic/claude-sonnet-4-5
```

### Activity log not updating

**Cause:** Workspace path mismatch  
**Fix:**
```bash
# Check OpenClaw workspace path
openclaw config get | grep workspace

# Update bot .env to match
OPENCLAW_WORKSPACE=/path/from/above
```

### Tools not appearing in voice session

**Cause:** Feature flag not enabled  
**Fix:** Ensure `openclawBridge` is in `supportedFeatures` array when starting session.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    UNIFIED PEARL                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Voice (PearlOS)          Discord           Telegram        │
│       ↓                      ↓                  ↓           │
│  ┌──────────────┐    ┌──────────────────────────────┐      │
│  │ Pipecat Bot  │    │ OpenClaw Gateway (:18789)     │      │
│  │ + Deepseek   │    │ + Deepseek/Sonnet (primary)   │      │
│  └──────┬───────┘    └────────────┬─────────────────┘      │
│         │                         │                         │
│         │ (complex task)          │ (complex task)          │
│         └────────────┬────────────┘                         │
│                      ↓                                      │
│         ┌────────────────────────┐                          │
│         │ bot_think_deeply       │                          │
│         │ → OpenClaw Gateway     │                          │
│         │ → Opus (transparent)   │                          │
│         └────────────────────────┘                          │
│                      ↓                                      │
│         ┌────────────────────────┐                          │
│         │ Shared Workspace       │                          │
│         │ memory/activity-log.md │                          │
│         │ SOUL.md, USER.md, etc  │                          │
│         └────────────────────────┘                          │
└─────────────────────────────────────────────────────────────┘
```

**Key Points:**
1. **Primary model** handles conversation and simple tools (fast)
2. **bot_think_deeply** escalates to Opus for complex reasoning (transparent)
3. **Shared workspace** keeps all sessions in sync
4. **Activity log** writes enable cross-session memory

---

## Advanced: Custom Models

### Add a new provider

Edit `apps/pipecat-daily-bot/bot/pipeline/builder.py`:

```python
# In model selection logic
if selection == "my-custom-model":
    from custom_llm_service import CustomLLMService
    llm = CustomLLMService(api_key=os.getenv("CUSTOM_API_KEY"))
```

Then update `.env`:
```bash
BOT_MODEL_SELECTION=my-custom-model
CUSTOM_API_KEY=your_key
```

### Add Opus to OpenClaw (for Discord/Telegram)

Edit `~/.openclaw/openclaw.json`:
```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "deepseek/deepseek-chat"
      },
      "models": {
        "deepseek/deepseek-chat": {"alias": "deepseek"},
        "anthropic/claude-opus-4-6": {"alias": "opus"},
        "anthropic/claude-sonnet-4-5": {"alias": "sonnet"}
      }
    }
  },
  "auth": {
    "profiles": {
      "deepseek:default": {
        "provider": "deepseek",
        "mode": "token",
        "apiKey": "your_deepseek_key"
      },
      "anthropic:default": {
        "provider": "anthropic",
        "mode": "token"
      }
    }
  }
}
```

Restart OpenClaw:
```bash
openclaw gateway restart
```

---

## Production Deployment

### Environment Variables (Minimal)

For a production deployment, set:
```bash
# Core
DAILY_API_KEY=...
OPENAI_API_KEY=...  # Or DEEPSEEK_API_KEY
MESH_API_ENDPOINT=https://mesh.yourcompany.com/api

# OpenClaw
OPENCLAW_API_URL=https://gateway.yourcompany.com/v1
OPENCLAW_API_KEY=...
OPENCLAW_WORKSPACE=/app/workspace

# Models
BOT_MODEL_SELECTION=deepseek-chat
BOT_ESCALATION_MODEL=anthropic/claude-opus-4-6

# TTS
BOT_TTS_PROVIDER=pocket
POCKET_TTS_URL=http://tts-service:8766
```

### Docker Compose

See `docker-compose.yml` (coming soon).

### Security

- **NEVER commit API keys** to git
- Use environment variables or secret management (Vault, AWS Secrets Manager)
- Restrict OpenClaw Gateway to loopback (`bind: "loopback"` in config) unless you're running distributed
- Use HTTPS/TLS for production Daily.co rooms

---

## Support

- **Docs:** https://docs.openclaw.ai
- **Discord:** https://discord.com/invite/clawd
- **Issues:** https://github.com/openclaw/openclaw/issues

---

## Changelog

### v1.0 (2026-02-16)
- Initial production release
- `bot_think_deeply` tool for synchronous Opus escalation
- Voice session → activity log integration
- Cross-session memory awareness
- 71 PearlOS tools available to OpenClaw
- Production-grade error handling and configuration
