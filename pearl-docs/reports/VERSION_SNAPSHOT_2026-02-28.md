# Version Snapshot — 2026-02-28 (Galaxy Demo Build)

## Commit
- **Hash:** `be9a19fd` (full: `be9a19fd179880228f8d136c8e3ca2121e8bbd37`)
- **Branch:** `pearl/next-gen-ui`
- **Message:** "Improved working Wonder Canvas"
- **Previous gold:** `84cd3b28` (2026-02-25, "best build ever")

## Services (All Green ✅)
| Service | Port | Status |
|---------|------|--------|
| Next.js (PearlOS UI) | 3000 | 200 ✅ |
| Bot Gateway (Pipecat) | 4444 | 200 ✅ |
| OpenClaw Gateway | 18789 | 200 ✅ |
| PocketTTS (Azelma) | 8766 | 200 ✅ |

## Architecture

### Voice Pipeline
- **STT:** Deepgram
- **TTS:** PocketTTS (voice: Azelma) — `BOT_TTS_PROVIDER=pocket`, `USE_ELEVENLABS=false`
- **Voice LLM (Phase 1 fast):** `openrouter/anthropic/claude-haiku-4.5` via OpenRouter
- **Phase 2 (tools/reasoning):** OpenClaw → Anthropic Sonnet/Opus
- **Router:** NonBlockingRouter with two-phase architecture
  - Phase 1: Fast voice response via direct API (bypasses OpenClaw)
  - Phase 2: Background OpenClaw call for tool execution

### Known Issues
- **OpenRouter API key expired** (`sk-or-v1-90db...` returns "User not found") — fast voice model won't work until key is refreshed or Anthropic direct API adapter is built
- **OpenClaw gateway chat/completions endpoint hangs** when used for fast voice (it spawns a full agent session, too slow for voice TTFB)
- Anthropic doesn't expose `/v1/chat/completions` (only `/v1/messages`), so direct Anthropic API requires a code adapter in the resolver

### Avatar System
- **GIF-only** — No Rive, ever (Blair directive 2026-02-24)
- Idle GIFs, talking GIF, wakeup/sleep GIFs, inactive PNG
- TileGifAvatar component (formerly TileRiveAvatar)

### OpenClaw Configuration
- **Discord agent:** Opus (`anthropic/claude-opus-4-6`)
- **Telegram agent:** Opus
- **Webchat agent:** Sonnet (`anthropic/claude-sonnet-4-5`)
- **Voice agent:** Sonnet
- **Haiku agent:** Available for sub-agent spawns
- **Gateway auth:** Token mode
- **Chat completions endpoint:** Enabled

### Key .env Settings (Bot)
```
BOT_FAST_MODEL=openrouter/anthropic/claude-haiku-4.5
BOT_TTS_PROVIDER=pocket
OPENCLAW_API_URL=http://localhost:18789/v1
```

## 🌌 Galaxy Demo Session (the incredible one)
- **When:** 2026-02-28 ~00:30 UTC
- **What happened:** Blair asked Pearl to show off Wonder Canvas capabilities. Pearl pulled up a 3D galaxy simulator (100,000 stars, interactive rotation/zoom). Blair recorded it for video.
- **How it worked:** `bot_wonder_canvas_scene` or `bot_wonder_canvas_template` tool call via Phase 2 (OpenClaw → Sonnet). The galaxy viz was a pre-built template in the Wonder Canvas system.
- **Voice worked for:** Initial greeting ("Hi"), but subsequent voice responses were silent (fast model couldn't reach API). The visual canvas worked perfectly though.
- **Git state at time:** `be9a19fd` (or effectively `b84e9d3a` — only a feedback file changed between them)

## What's Working
- **Wonder Canvas scenes/templates** (galaxy, weather, news, photos, etc.) ← THE STAR OF THE SHOW
- NonBlockingRouter two-phase voice architecture
- Phase 2 tool execution via OpenClaw (this powered the galaxy demo)
- GIF avatar system with speaking/idle states
- PocketTTS voice synthesis (greeting works)
- OpenClaw tool delegation from voice sessions
- Cross-session coordination (activity log, sync protocol)
- Discord + Telegram channels
- PearlOS tools via `pearlos-tool` CLI (71 tools)

## What's Not Working (at time of galaxy demo)
- Fast voice responses were broken (OpenRouter key expired, OpenClaw gateway too slow for direct fast LLM)
- Greeting "Hi" speaks, but conversational responses were silent
- **Fixed post-demo:** Built direct Anthropic Messages API adapter (`8ee6cdd4`) — Haiku 4.5 now hits api.anthropic.com directly

## Emergency Revert
```bash
cd /workspace/nia-universal
git checkout be9a19fd  # This version
# Previous gold: git checkout 84cd3b28
```

## Restart Commands
```bash
# PocketTTS
nohup pocket-tts serve --voice azelma --port 8766 --host 0.0.0.0 > /tmp/pocket_tts.log 2>&1 &

# Bot gateway
cd /workspace/nia-universal/apps/pipecat-daily-bot/bot && USE_ELEVENLABS=false BOT_TTS_PROVIDER=pocket nohup uvicorn bot_gateway:app --host 0.0.0.0 --port 4444 > /tmp/bot_gateway.log 2>&1 &

# Next.js
cd /workspace/nia-universal/apps/interface && nohup npx next dev -p 3000 > /tmp/nextjs.log 2>&1 &
```
