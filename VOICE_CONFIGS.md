# Voice Pipeline Configuration Guide

This document provides a comprehensive guide to configuring and troubleshooting the voice pipeline across different TTS/LLM combinations.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Configuration Paths](#configuration-paths)
3. [Tested Configurations](#tested-configurations)
4. [Environment Variables](#environment-variables)
5. [Service Dependencies](#service-dependencies)
6. [Troubleshooting](#troubleshooting)
7. [Validation](#validation)

---

## Architecture Overview

The voice pipeline consists of several interconnected components:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Voice Pipeline                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐      ┌──────────────┐      ┌──────────────┐ │
│  │   Daily.co   │──────│  Bot Gateway │──────│  Bot Runner  │ │
│  │   (WebRTC)   │      │  (port 4444) │      │  (port 8080) │ │
│  └──────────────┘      └──────────────┘      └──────────────┘ │
│                                │                      │          │
│                                │                      ▼          │
│                                │            ┌──────────────────┐│
│                                │            │  Pipeline Builder││
│                                │            └──────────────────┘│
│                                │                      │          │
│                                ▼                      │          │
│                       ┌─────────────────┐            │          │
│                       │   Mesh API      │◀───────────┘          │
│                       │ (Personality DB)│                       │
│                       └─────────────────┘                       │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Service Layer                          │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │                                                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │  │
│  │  │   LLM       │  │    TTS      │  │   OpenClaw      │  │  │
│  │  │             │  │             │  │   Gateway       │  │  │
│  │  │ • Anthropic │  │ • PocketTTS │  │ (LLM routing,   │  │  │
│  │  │ • Groq      │  │ • Kokoro    │  │  tools, context)│  │  │
│  │  │ • OpenAI    │  │ • ElevenLabs│  │                 │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘  │  │
│  │                                                            │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **Bot Gateway** (`bot_gateway.py`)
   - Entry point for voice bot requests
   - Handles room creation, token generation
   - Routes requests to bot runners
   - Fetches personality configuration from Mesh API

2. **Bot Runner** (`runner_main.py`)
   - Manages bot lifecycle per session
   - Receives configuration from gateway
   - Spawns pipeline with specified personality/voice

3. **Pipeline Builder** (`pipeline/builder.py`)
   - Constructs the audio/LLM pipeline
   - Initializes TTS and LLM services
   - Sets up mode switching (multiple personalities)
   - Configures OpenClaw integration

4. **Config Listener** (`session/config_listener.py`)
   - Listens for real-time config updates via Redis
   - Handles personality/voice switching
   - Applies voice parameter updates

5. **Session Initialization** (`session/initialization.py`)
   - Loads personality from Mesh API or environment
   - Handles personality resolution (Personality vs Sprite)
   - Prepares functional prompts

---

## Configuration Paths

### 1. Environment Variables → Bot Runner

**File:** `apps/pipecat-daily-bot/.env`

Key environment variables are loaded by `runner_main.py` and `bot.py`:

```python
# In runner_main.py (startup)
personalityId = os.getenv("BOT_PERSONALITY") or ""
persona = os.getenv("BOT_PERSONA") or "Pearl"
token = os.getenv("DAILY_TOKEN")
```

These can be overridden by request body parameters from the gateway.

### 2. Gateway Request → Runner Args

**File:** `bot_gateway.py` → `runner_main.py`

The gateway constructs `DailyRunnerArguments` with:
- `room_url`
- `token`
- `personalityId`
- `persona`
- `tenantId`
- `voiceId`
- `voiceProvider`
- `voiceParameters`
- `modePersonalityVoiceConfig`
- `sessionOverride`
- `supportedFeatures`

These args flow through `bot.py` → `orchestrator.py` → `builder.py`.

### 3. Personality Resolution

**File:** `session/initialization.py`

```python
async def initialize_session_config(room_url, personality_id, tenant_id):
    # Try pre-fetched personality from env (BOT_PERSONALITY_RECORD)
    preloaded_personality_json = os.getenv("BOT_PERSONALITY_RECORD")
    
    # Fallback to DB query via personality_actions
    if not personality_record:
        personality_record = await personality_actions.get_personality_by_id(
            tenant_id, personality_id
        )
```

**Fallback chain:**
1. `BOT_PERSONALITY_RECORD` env var (JSON string, set by gateway)
2. Database query via `personality_actions.get_personality_by_id()`
3. Sprite content type via `personality_actions.get_sprite_by_id()`

### 4. TTS Service Initialization

**File:** `pipeline/builder.py`

```python
async def create_tts_service(provider, voice_id, voice_params):
    # BOT_TTS_PROVIDER() reads from core/config.py which is HARDCODED
    # This was done to prevent env var load order issues
    
    if provider == "pocket":
        pocket_url = os.getenv("POCKET_TTS_URL", "http://localhost:8766")
        return PocketTTSService(base_url=pocket_url, ...)
    
    elif provider == "kokoro":
        return KokoroTTSService(
            api_key=KOKORO_TTS_API_KEY(),
            base_url=KOKORO_TTS_BASE_URL(),
            voice_id=voice_id or KOKORO_TTS_VOICE_ID(None),
            ...
        )
```

**Important:** `core/config.py` has a HARDCODED override for `BOT_TTS_PROVIDER`:

```python
def BOT_TTS_PROVIDER() -> str:
    # HARDCODED: PocketTTS is the TTS provider. Period.
    return "pocket"
```

This was added to prevent configuration drift. To use a different TTS provider, you must **edit `core/config.py`** directly.

### 5. LLM Service Initialization

**File:** `pipeline/builder.py`

LLM routing depends on `BOT_LLM_MODE`:

```python
llm_mode = os.getenv("BOT_LLM_MODE", "anthropic_voice")

if llm_mode == "anthropic_voice":
    # Routes through OpenClaw Gateway for Anthropic
    llm_service = create_anthropic_llm_via_openclaw()
elif llm_mode == "groq":
    # Direct Groq API
    llm_service = create_groq_llm()
```

### 6. OpenClaw Context Loading

**File:** `pipeline/builder.py` → `load_workspace_context()`

Voice sessions load cross-session context from OpenClaw workspace:

```python
workspace_root = os.getenv("OPENCLAW_WORKSPACE", "/root/.openclaw/workspace")

# Loads:
# - SOUL.md (identity)
# - USER.md (user context)
# - IDENTITY.md (personal details)
# - memory/activity-log.md (recent cross-session activity)
# - memory/cross-session-state.md (shared state)
# - memory/YYYY-MM-DD.md (today's activity)
# - MEMORY.md (long-term memory, last 50 lines)
```

This gives voice Pearl the same awareness as Discord/webchat Pearl.

---

## Tested Configurations

### Configuration 1: Groq Llama + PocketTTS (Current Default)

**Azelma personality with fast inference and local TTS**

#### Environment Variables
```bash
# LLM
BOT_LLM_MODE=anthropic_voice  # Routes through OpenClaw for cross-session context
BOT_VOICE_MODEL=groq/llama-3.1-8b-instant
GROQ_API_KEY=gsk_...

# TTS
BOT_TTS_PROVIDER=pocket  # HARDCODED in core/config.py
POCKET_TTS_URL=http://localhost:8766
POCKET_TTS_SPEED=1.0

# Personality
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
BOT_PERSONALITY=azelma  # personality ID from database
BOT_PERSONA=Azelma

# OpenClaw Integration
OPENCLAW_BRIDGE_URL=http://localhost:3100
OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_KEY=c29b81e25840c89c64074b4d93a7a9b8227a0742aa5a5442
OPENCLAW_WORKSPACE=/root/.openclaw/workspace
```

#### Required Services
```bash
# 1. PocketTTS (local, CPU-only, ~200ms latency)
cd /workspace/nia-universal
npm run pocket:start

# 2. OpenClaw Gateway (LLM routing + tools)
openclaw gateway start

# 3. Mesh API (personality database)
cd /workspace/nia-universal
npm run mesh:start

# 4. Bot Gateway
cd /workspace/nia-universal/apps/pipecat-daily-bot
npm run gateway
```

#### Pros
- ✅ Fast inference (~100ms TTFT with Groq LPU)
- ✅ Local TTS (no API costs)
- ✅ Cross-session context via OpenClaw
- ✅ Tool access via OpenClaw Gateway
- ✅ Low latency end-to-end

#### Cons
- ⚠️ Llama 3.1 8B has weaker reasoning than Sonnet/Opus
- ⚠️ PocketTTS quality lower than ElevenLabs
- ⚠️ Requires 4 separate services running

---

### Configuration 2: Anthropic Sonnet + PocketTTS (Previous)

**Pearl personality with high-quality reasoning**

#### Environment Variables
```bash
# LLM
BOT_LLM_MODE=anthropic_voice
BOT_VOICE_MODEL=anthropic/claude-sonnet-4-5
ANTHROPIC_API_KEY=sk-ant-...  # OR route via OpenClaw

# TTS
BOT_TTS_PROVIDER=pocket
POCKET_TTS_URL=http://localhost:8766
POCKET_TTS_SPEED=1.0

# Personality
DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000001
BOT_PERSONALITY=pearl
BOT_PERSONA=Pearl

# OpenClaw Integration
OPENCLAW_API_URL=http://localhost:18789
OPENCLAW_API_KEY=...
OPENCLAW_WORKSPACE=/root/.openclaw/workspace
```

#### Required Services
Same as Configuration 1

#### Pros
- ✅ Best-in-class reasoning (Sonnet 4.5)
- ✅ Cross-session context via OpenClaw
- ✅ Tool access
- ✅ Local TTS (no API costs)

#### Cons
- ⚠️ Higher latency (~800ms-1.5s TTFT vs ~100ms for Groq)
- ⚠️ Higher API costs ($3/MTok input, $15/MTok output)

---

### Configuration 3: Groq Llama + Kokoro/Chorus TTS

**Fast inference with local Kokoro TTS**

#### Environment Variables
```bash
# LLM (same as Config 1)
BOT_LLM_MODE=anthropic_voice
BOT_VOICE_MODEL=groq/llama-3.1-8b-instant
GROQ_API_KEY=gsk_...

# TTS - REQUIRES EDITING core/config.py!
# Change: return "kokoro" in BOT_TTS_PROVIDER()
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8765
KOKORO_TTS_API_KEY=test-key  # Optional for local
KOKORO_TTS_VOICE_ID=af_heart
KOKORO_TTS_SAMPLE_RATE=22050

# Personality & OpenClaw (same as Config 1)
```

#### Required Services
```bash
# 1. Kokoro/Chorus TTS (instead of PocketTTS)
cd /workspace/nia-universal
npm run chorus:start

# 2-4. Same as Configuration 1 (OpenClaw, Mesh, Bot Gateway)
```

#### Pros
- ✅ Fast inference
- ✅ Local TTS with voice cloning support
- ✅ Cross-session context

#### Cons
- ⚠️ Requires code change in `core/config.py`
- ⚠️ Kokoro voices less polished than ElevenLabs

---

### Configuration 4: Anthropic Sonnet + ElevenLabs (Cloud TTS)

**Premium voice quality with top-tier reasoning**

⚠️ **DEPRECATED:** ElevenLabs has been removed from the current codebase.

If you need ElevenLabs, you would need to:
1. Restore ElevenLabs service code from git history
2. Edit `core/config.py` to allow `elevenlabs` provider
3. Set `USE_ELEVENLABS=true` and `ELEVENLABS_API_KEY`

---

## Environment Variables

### Critical Variables (Required)

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `DAILY_API_KEY` | Daily.co room token generation | *(required)* | Get from https://dashboard.daily.co |
| `DAILY_ROOM_URL` | WebRTC room URL | *(auto-created)* | Can be auto-generated by gateway |
| `MESH_API_ENDPOINT` | Personality database API | `http://localhost:2000/api` | Required for personality loading |
| `DEFAULT_TENANT_ID` | Tenant for personality queries | `00000000-0000-0000-0000-000000000001` | Must match DB tenant |
| `BOT_TTS_PROVIDER` | TTS provider selection | `pocket` | **HARDCODED in `core/config.py`** |
| `BOT_LLM_MODE` | LLM routing mode | `anthropic_voice` | Options: `anthropic_voice`, `groq`, `hybrid` |

### TTS Provider Variables

#### PocketTTS
| Variable | Purpose | Default |
|----------|---------|---------|
| `POCKET_TTS_URL` | PocketTTS HTTP endpoint | `http://localhost:8766` |
| `POCKET_TTS_SPEED` | Playback speed multiplier | `1.0` |

#### Kokoro/Chorus
| Variable | Purpose | Default |
|----------|---------|---------|
| `KOKORO_TTS_BASE_URL` | WebSocket endpoint | `ws://127.0.0.1:8765` |
| `KOKORO_TTS_API_KEY` | API key (optional for local) | `test-key` |
| `KOKORO_TTS_VOICE_ID` | Voice ID | `af_alloy` |
| `KOKORO_TTS_SAMPLE_RATE` | Output sample rate | `22050` |
| `KOKORO_TTS_ENABLE_LOGGING` | Debug logging | `true` |

### LLM Provider Variables

#### Anthropic (via OpenClaw)
| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENCLAW_API_URL` | OpenClaw Gateway URL | `http://localhost:18789` |
| `OPENCLAW_API_KEY` | Gateway auth token | *(required)* |
| `BOT_VOICE_MODEL` | Model for voice responses | `anthropic/claude-sonnet-4-5` |
| `BOT_TOOLS_MODEL` | Model for tool calls | `anthropic/claude-sonnet-4-5` |
| `BOT_THINKING_MODEL` | Model for deep reasoning | `anthropic/claude-opus-4-6` |

#### Groq
| Variable | Purpose | Default |
|----------|---------|---------|
| `GROQ_API_KEY` | Groq API key | *(required if using Groq)* |
| `BOT_VOICE_MODEL` | Model for voice | `groq/llama-3.1-8b-instant` |

### OpenClaw Integration Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `OPENCLAW_BRIDGE_URL` | Bridge server for SSE events | `http://localhost:3100` |
| `OPENCLAW_WORKSPACE` | Workspace path for context files | `/root/.openclaw/workspace` |

### Personality Variables

| Variable | Purpose | Default | Notes |
|----------|---------|---------|-------|
| `BOT_PERSONALITY` | Personality ID from database | `pearl` | Can be overridden by request |
| `BOT_PERSONA` | Display name | `Pearl` | Can be overridden by request |
| `BOT_PERSONALITY_RECORD` | Pre-fetched personality JSON | *(none)* | Gateway sets this to avoid DB queries |

---

## Service Dependencies

### Service Startup Order

1. **Mesh API** (port 2000)
   ```bash
   cd /workspace/nia-universal
   npm run mesh:start
   ```

2. **TTS Service** (PocketTTS: port 8766 OR Kokoro: port 8765)
   ```bash
   # Option A: PocketTTS
   npm run pocket:start
   
   # Option B: Kokoro/Chorus
   npm run chorus:start
   ```

3. **OpenClaw Gateway** (port 18789)
   ```bash
   openclaw gateway start
   ```

4. **Bot Gateway** (port 4444)
   ```bash
   cd /workspace/nia-universal/apps/pipecat-daily-bot
   npm run gateway
   ```

### Service Health Checks

```bash
# Mesh API
curl http://localhost:2000/graphql

# PocketTTS
curl http://localhost:8766/health

# Kokoro/Chorus
nc -zv 127.0.0.1 8765

# OpenClaw Gateway
curl http://localhost:18789/v1/models

# Bot Gateway
curl http://localhost:4444/status
```

---

## Troubleshooting

### Problem: "Personality not found"

**Symptoms:**
- Bot joins room but doesn't speak
- Logs show: `Personality {id} not found`

**Causes:**
1. `MESH_API_ENDPOINT` not set or wrong
2. `DEFAULT_TENANT_ID` doesn't match database tenant
3. Personality ID doesn't exist in database
4. Network can't reach Mesh API

**Solutions:**
```bash
# 1. Check Mesh API is running
curl http://localhost:2000/api/health

# 2. Verify tenant ID in database
psql -U postgres -d testdb -c "SELECT id, name FROM tenants;"

# 3. Check if personality exists
curl "http://localhost:2000/api/content/Personality?where={\"parent_id\":{\"eq\":\"$DEFAULT_TENANT_ID\"}}"

# 4. Check environment variables
cat /workspace/nia-universal/apps/pipecat-daily-bot/.env | grep -E "MESH|TENANT"
```

### Problem: "Failed to connect to TTS service"

**Symptoms:**
- Bot joins but audio fails
- Logs show connection errors to TTS

**Causes:**
1. TTS service not running
2. Wrong TTS provider in config
3. Port mismatch
4. HARDCODED `BOT_TTS_PROVIDER` conflicts with intention

**Solutions:**
```bash
# 1. Check TTS service is running
# For PocketTTS:
curl http://localhost:8766/health

# For Kokoro:
nc -zv 127.0.0.1 8765

# 2. Check what provider is ACTUALLY being used
# Look in core/config.py, line ~380:
# def BOT_TTS_PROVIDER() -> str:
#     return "pocket"  # ← This is HARDCODED

# 3. If you want Kokoro, EDIT core/config.py:
sed -i 's/return "pocket"/return "kokoro"/' \
  /workspace/nia-universal/apps/pipecat-daily-bot/bot/core/config.py

# 4. Restart bot gateway after changing config.py
```

### Problem: "OpenClaw context not loading"

**Symptoms:**
- Voice bot doesn't know recent Discord conversations
- Bot seems to have no memory

**Causes:**
1. `OPENCLAW_WORKSPACE` not set or wrong path
2. Workspace files don't exist
3. Permissions issue reading files

**Solutions:**
```bash
# 1. Check workspace path
echo $OPENCLAW_WORKSPACE
# Should be: /root/.openclaw/workspace

# 2. Check files exist
ls -la /root/.openclaw/workspace/
ls -la /root/.openclaw/workspace/memory/

# 3. Check activity log has content
tail /root/.openclaw/workspace/memory/activity-log.md

# 4. Check permissions
chmod -R 755 /root/.openclaw/workspace
```

### Problem: "Bot connects but doesn't respond"

**Symptoms:**
- Bot joins Daily room
- Transcription works
- No audio response

**Causes:**
1. LLM service unreachable
2. API key invalid/expired
3. OpenClaw Gateway not running
4. Context window exceeded

**Solutions:**
```bash
# 1. Check LLM mode
env | grep BOT_LLM_MODE

# 2. Test OpenClaw Gateway
curl -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  http://localhost:18789/v1/models

# 3. Check API keys are valid
# For Groq:
curl -H "Authorization: Bearer $GROQ_API_KEY" \
  https://api.groq.com/openai/v1/models

# For Anthropic (via OpenClaw):
# Check openclaw gateway logs

# 4. Check bot runner logs
tail -f /workspace/nia-universal/apps/pipecat-daily-bot/gateway.log
```

### Problem: "Voice switching doesn't work"

**Symptoms:**
- Sent config update to change voice
- Bot still using old voice

**Causes:**
1. Redis not enabled (`USE_REDIS=false`)
2. Config listener not started
3. Wrong room URL in config update
4. Service doesn't support dynamic voice switching

**Solutions:**
```bash
# 1. Check if Redis is enabled
grep USE_REDIS /workspace/nia-universal/apps/pipecat-daily-bot/.env

# 2. If USE_REDIS=false, config updates won't work
# Voice must be set at bot spawn time via modePersonalityVoiceConfig

# 3. Check config_listener is running (look for log line)
grep "Listening for config updates" gateway.log

# 4. For non-Redis mode, restart bot with new voice:
curl -X POST http://localhost:4444/join \
  -H "Content-Type: application/json" \
  -d '{
    "roomUrl": "https://pearlos.daily.co/room-name",
    "personalityId": "pearl",
    "voiceId": "af_sky",
    "voiceProvider": "pocket"
  }'
```

### Problem: "Mode switching fails"

**Symptoms:**
- Tried to switch personality mode
- Bot doesn't respond or uses wrong personality

**Causes:**
1. `modePersonalityVoiceConfig` not provided at spawn
2. Mode name mismatch
3. Service index out of range
4. Session override is locked

**Solutions:**
```bash
# Check that modePersonalityVoiceConfig was passed at spawn
# Look for log line: "Initial mode identified: 'pearl'"

# If using session override with locked=true, modes are frozen
# Check spawn request body for sessionOverride field

# Verify mode_map was built correctly:
grep "mode_map" gateway.log
```

---

## Validation

### Automated Validation Script

Run the validation script to check all configuration and services:

```bash
cd /workspace/nia-universal
./scripts/validate-voice-config.sh
```

This script checks:
- ✅ Environment files exist
- ✅ Critical environment variables are set
- ✅ Required services are running
- ✅ Personality configuration is accessible
- ✅ OpenClaw workspace files exist

### Manual Testing

#### 1. Test TTS Service

```bash
# PocketTTS
curl -X POST http://localhost:8766/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","speed":1.0}' \
  --output test.wav

# Play the audio
ffplay test.wav
```

#### 2. Test Personality Loading

```python
import asyncio
import os
os.environ["MESH_API_ENDPOINT"] = "http://localhost:2000/api"
os.environ["DEFAULT_TENANT_ID"] = "00000000-0000-0000-0000-000000000001"

from actions import personality_actions

async def test():
    personality = await personality_actions.get_personality_by_id(
        "00000000-0000-0000-0000-000000000001",
        "pearl"
    )
    print(personality)

asyncio.run(test())
```

#### 3. Test Full Pipeline

```bash
# 1. Ensure all services are running
./scripts/validate-voice-config.sh

# 2. Start a bot session
curl -X POST http://localhost:4444/join \
  -H "Content-Type: application/json" \
  -d '{
    "roomUrl": "https://pearlos.daily.co/test-room",
    "personalityId": "pearl",
    "persona": "Pearl",
    "tenantId": "00000000-0000-0000-0000-000000000001"
  }'

# 3. Join the Daily room in your browser
# 4. Speak and verify bot responds with audio
```

---

## Configuration Best Practices

### 1. Use Environment Files Consistently

- **Bot-specific config:** `/workspace/nia-universal/apps/pipecat-daily-bot/.env`
- **Main config:** `/workspace/nia-universal/.env.local`

Don't scatter environment variables across shell exports and files.

### 2. Pre-fetch Personalities at Gateway Level

The gateway can fetch personality records and pass them as `BOT_PERSONALITY_RECORD` JSON to avoid per-session DB queries:

```python
# In bot_gateway.py
personality_record = await get_personality_by_id(tenant_id, personality_id)
runner_args.body["personalityRecord"] = personality_record
os.environ["BOT_PERSONALITY_RECORD"] = json.dumps(personality_record)
```

### 3. Use Session Override for Locked Modes

If you want to prevent mode switching (e.g., for a dedicated assistant), use:

```json
{
  "sessionOverride": {
    "mode": "pearl",
    "locked": true
  }
}
```

### 4. Batch Mode Configurations

Instead of creating separate bots for each personality, use `modePersonalityVoiceConfig`:

```json
{
  "modePersonalityVoiceConfig": {
    "pearl": {
      "personalityId": "pearl-id",
      "personaName": "Pearl",
      "voice": {
        "provider": "pocket",
        "voiceId": "af_sky"
      }
    },
    "azelma": {
      "personalityId": "azelma-id",
      "personaName": "Azelma",
      "voice": {
        "provider": "pocket",
        "voiceId": "af_heart"
      }
    }
  }
}
```

Then switch modes dynamically via Redis pub/sub (if `USE_REDIS=true`).

### 5. Monitor Context Window Usage

Voice sessions with OpenClaw workspace context can accumulate large context:

```python
# In builder.py, load_workspace_context():
# - SOUL.md
# - USER.md
# - IDENTITY.md
# - activity-log.md (last 10 entries)
# - cross-session-state.md
# - today's daily memory (last 2000 chars)
# - MEMORY.md (last 50 lines)
```

If you hit context limits:
- Reduce `MEMORY.md` to last 30 lines
- Trim activity log to last 5 entries
- Skip daily memory file

---

## Known Issues & Limitations

### 1. TTS Provider is Hardcoded

**Issue:** `BOT_TTS_PROVIDER` environment variable is **ignored** due to hardcoded override in `core/config.py`.

**Why:** Previous attempts to use `os.getenv("BOT_TTS_PROVIDER")` were defeated by dotenv load order, leading spaces, and override conflicts.

**Workaround:** Edit `core/config.py` directly:
```python
def BOT_TTS_PROVIDER() -> str:
    return "pocket"  # ← Change this to "kokoro" or "elevenlabs"
```

**Long-term fix:** Refactor config loading to use a single canonical environment source.

### 2. ElevenLabs Removed from Codebase

**Issue:** ElevenLabs TTS service code exists but is effectively disabled in the builder (falls back to PocketTTS).

**Why:** Cost and latency concerns for production use.

**Workaround:** Restore from git history if needed.

### 3. Redis Required for Dynamic Config Updates

**Issue:** If `USE_REDIS=false`, voice/personality switching won't work after bot spawn.

**Why:** Config listener uses Redis pub/sub for real-time updates.

**Workaround:** Set all configuration at spawn time via `modePersonalityVoiceConfig` and don't expect dynamic updates.

### 4. Personality Loading Can Be Slow

**Issue:** If `BOT_PERSONALITY_RECORD` env var is not set, bot will query Mesh API on every spawn, adding ~200-500ms latency.

**Solution:** Gateway should pre-fetch personality and pass as JSON in environment or request body.

---

## Future Improvements

### 1. Unified Configuration Source

Move all bot configuration to a single YAML/JSON file instead of scattered environment variables:

```yaml
# bot-config.yaml
llm:
  provider: anthropic
  model: claude-sonnet-4-5
  api_key: ${ANTHROPIC_API_KEY}

tts:
  provider: pocket
  url: http://localhost:8766
  speed: 1.0

personality:
  default_id: pearl
  tenant_id: 00000000-0000-0000-0000-000000000001

openclaw:
  gateway_url: http://localhost:18789
  workspace: /root/.openclaw/workspace
```

### 2. Health Check Endpoints

Add `/health` endpoints to all services with dependency checks:

```bash
curl http://localhost:4444/health
# Returns:
# {
#   "status": "healthy",
#   "dependencies": {
#     "mesh_api": "connected",
#     "tts_service": "connected",
#     "openclaw_gateway": "connected"
#   }
# }
```

### 3. Configuration Validation at Startup

Add validation that runs before bot accepts requests:
- Check all required env vars are set
- Verify TTS service is reachable
- Test Mesh API personality query
- Verify OpenClaw workspace files exist

### 4. Graceful Degradation

Instead of failing silently when personality doesn't load, use fallback:
- Default personality JSON embedded in code
- Generic greeting if personality loading fails
- Error message spoken to user: "I'm having trouble loading my personality configuration. Give me a moment."

### 5. Configuration Audit Log

Log all configuration changes with timestamps:
```
[2026-02-23 17:30:00] Config update: voice changed from af_sky to af_heart
[2026-02-23 17:31:15] Mode switch: pearl → azelma
[2026-02-23 17:32:00] Personality reloaded from database
```

---

## Contact & Support

- **Issues:** https://github.com/PearlOrganisationApplications/Nia-universal/issues
- **Documentation:** `/workspace/nia-universal/docs/`
- **Voice Pipeline Docs:** This file (`VOICE_CONFIGS.md`)

For urgent issues, check:
1. Service logs: `tail -f /workspace/nia-universal/apps/pipecat-daily-bot/gateway.log`
2. Validation script: `./scripts/validate-voice-config.sh`
3. Mesh API logs: `npm run mesh:logs`
