# Text-to-Speech Architecture: How Pearl Speaks

> **How Kokoro/Chorus TTS generates Pearl's voice in real-time conversations**

---

## Overview

Pearl (the voice bot) uses **two TTS options** for speech synthesis:

| Provider | Type | Cost | Latency | Setup |
|----------|------|------|---------|-------|
| **Kokoro (Chorus)** | Local/self-hosted | Free | Low (local) | Requires model download |
| **ElevenLabs** | Cloud API | Pay-per-use | Medium (network) | API key only |

**Default:** Kokoro (local, free) - requires model download and Chorus server  
**Alternative:** ElevenLabs (cloud, paid) - set `USE_ELEVENLABS=true` to use

---

## Architecture Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Pearl Voice Generation Flow                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User speaks → Deepgram (STT) → LLM (OpenAI) → Text Response  │
│                                                                 │
│  Text Response → TTS Provider Selection                        │
│                    │                                            │
│                    ├─→ ElevenLabs (Cloud) ────────────┐        │
│                    │                                    │        │
│                    └─→ Kokoro (Chorus Local) ──────────┤        │
│                                                         │        │
│  ┌─────────────────────────────────────────────────────▼──┐    │
│  │         Pipecat Bot Pipeline                          │    │
│  │  ┌──────────────────────────────────────────────┐    │    │
│  │  │  KokoroTTSService / ElevenLabsTTSService     │    │    │
│  │  │  - Connects via WebSocket                     │    │    │
│  │  │  - Streams audio chunks in real-time          │    │    │
│  │  │  - Sends to Daily.co room                      │    │    │
│  │  └──────────────────────────────────────────────┘    │    │
│  └───────────────────────────────────────────────────────┘    │
│                                                                 │
│  Daily.co Room → User hears Pearl's voice                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Option 1: Kokoro (Chorus) - Local TTS

### What is Chorus TTS?

**Chorus TTS** is a **self-hosted WebSocket server** that runs the **Kokoro v1.0** neural TTS model locally on your machine. It's completely free and runs offline.

### Components

1. **Chorus TTS Server** (`apps/chorus-tts/`)
   - Python FastAPI server (git submodule)
   - Runs Kokoro v1.0 ONNX model
   - WebSocket API compatible with ElevenLabs protocol
   - Default: `ws://127.0.0.1:8000`

2. **Kokoro Model Files** (downloaded separately)
   - `kokoro-v1.0.onnx` (~500MB) - Neural TTS model
   - `voices-v1.0.bin` (~50MB) - Voice embeddings

3. **Bot Integration** (`apps/pipecat-daily-bot/bot/providers/kokoro.py`)
   - WebSocket client connecting to Chorus server
   - Streams text → receives PCM audio chunks
   - Sanitizes text (removes emojis, markdown)
   - Forwards audio to Daily.co room

### Setup Steps

```bash
# 1. Initialize git submodule
git submodule update --init --recursive

# 2. Download Kokoro model files (~550MB total)
npm run chorus:download-assets

# 3. Start Chorus TTS server
npm run chorus:start
# Server runs on ws://127.0.0.1:8000

# 4. Configure bot to use Kokoro
# In .env.local:
BOT_TTS_PROVIDER=kokoro
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_API_KEY=test-key  # Can be any string for local
KOKORO_TTS_VOICE_ID=am_fenrir  # Voice selection
```

### How It Works

1. **Text Input**: Bot receives LLM response text
2. **Sanitization**: Removes emojis, markdown, special chars (Kokoro can't pronounce them well)
3. **WebSocket Connection**: Connects to `ws://127.0.0.1:8000/v1/text-to-speech/{voice_id}/stream-input`
4. **Streaming**: Sends text chunks, receives PCM audio chunks in real-time
5. **Audio Output**: Forwards PCM frames to Daily.co room → user hears Pearl

### Voice Parameters

Kokoro supports these voice tuning parameters:

```python
{
  "speed": 0.5-2.0,           # Speech speed
  "stability": 0.0-1.0,       # Voice consistency
  "similarity_boost": 0.0-1.0, # Voice similarity to original
  "style": 0.0-1.0            # Style variation
}
```

### Available Voices

Kokoro comes with multiple voice IDs. Common ones:
- `am_fenrir` - Default Pearl voice
- `af_alloy` - Alternative voice
- `af_shimmer` - Female voice option

See `packages/prism/src/core/constants/kokoro-voices.ts` for full list.

---

## Option 2: ElevenLabs - Cloud TTS

### What is ElevenLabs?

**ElevenLabs** is a cloud-based TTS API with high-quality voices. To use it, set `USE_ELEVENLABS=true`.

### Setup

```bash
# In .env.local:
USE_ELEVENLABS=true
ELEVENLABS_API_KEY=your-api-key
ELEVENLABS_VOICE_ID=kdmDKE6EkgrWrrykO9Qt  # Default Pearl voice
```

### How It Works

1. **Text Input**: Bot receives LLM response text
2. **WebSocket Connection**: Connects to `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream`
3. **Streaming**: Sends text, receives audio chunks
4. **Audio Output**: Forwards to Daily.co room

### Cost

- Pay-per-character pricing
- ~$0.30 per 1000 characters
- Typical conversation: ~$0.10-0.50 per hour

---

## Provider Selection Logic

The bot chooses the TTS provider based on `BOT_TTS_PROVIDER` environment variable:

```python
# From apps/pipecat-daily-bot/bot/core/config.py
def BOT_TTS_PROVIDER() -> str:
    value = os.getenv("BOT_TTS_PROVIDER", "elevenlabs")  # Default
    return value.strip().lower()
```

**Priority:**
1. Check `BOT_TTS_PROVIDER` env var
2. If `"kokoro"` → Use Chorus TTS (requires `KOKORO_TTS_API_KEY` and server running)
3. If `"elevenlabs"` or default → Use ElevenLabs (requires `ELEVENLABS_API_KEY`)
4. If provider unavailable → Bot fails to start (logs warning)

---

## Text Sanitization (Kokoro Only)

Kokoro TTS has trouble with special characters, so the bot sanitizes text before sending:

### What Gets Removed

- **Emojis**: 😀 🎉 ✅ → removed entirely
- **Markdown**: `#`, `*`, `_`, `` ` ``, `~`, `[]`, `<>` → removed
- **Special symbols**: `•`, `→`, `★`, `✓`, box-drawing chars → removed
- **Bullet points**: Converted to spaces

### Example

```
Original: "Hello! 😊 Here's a **note**: • Item 1 → Item 2"
Sanitized: "Hello! Here's a note: Item 1 Item 2"
```

**Note:** Transcripts retain the original text - only the audio synthesis uses sanitized text.

---

## Voice Switching

Pearl can switch voices dynamically during a conversation:

```typescript
// From interface (DailyCall feature)
await updateBotConfig({
  voiceId: "am_fenrir",  // New Kokoro voice
  voiceProvider: "kokoro"
});
```

The bot reconnects to TTS service with new voice ID.

---

## Performance Comparison

| Metric | Kokoro (Local) | ElevenLabs (Cloud) |
|--------|----------------|-------------------|
| **Latency** | ~50-100ms (local) | ~200-500ms (network) |
| **Cost** | Free | ~$0.30/1k chars |
| **Quality** | Good | Excellent |
| **Setup** | Model download required | API key only |
| **Offline** | ✅ Yes | ❌ No |
| **GPU** | Optional (faster) | N/A |

---

## Troubleshooting

### Kokoro Not Working

```bash
# Check if Chorus server is running
curl http://127.0.0.1:8000/health

# Check logs
npm run chorus:start  # Should show "Starting Chorus TTS"

# Verify model files exist
ls -lh apps/chorus-tts/kokoro-v1.0.onnx
ls -lh apps/chorus-tts/voices-v1.0.bin

# Re-download if missing
npm run chorus:download-assets
```

### ElevenLabs Not Working

```bash
# Check API key
echo $ELEVENLABS_API_KEY

# Test API key
curl https://api.elevenlabs.io/v1/voices \
  -H "xi-api-key: $ELEVENLABS_API_KEY"
```

### Bot Falls Back

If the selected provider fails, the bot logs a warning but **does not automatically fallback**. You must:
1. Fix the provider configuration, OR
2. Switch to the other provider via `BOT_TTS_PROVIDER`

---

## Configuration Reference

### Environment Variables

```bash
# Provider Selection (default: Kokoro)
# To use ElevenLabs instead:
USE_ELEVENLABS=true

# Or explicitly set provider:
BOT_TTS_PROVIDER=kokoro  # or "elevenlabs"

# Kokoro/Chorus Settings
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_API_KEY=test-key
KOKORO_TTS_VOICE_ID=am_fenrir
KOKORO_TTS_SAMPLE_RATE=24000

# ElevenLabs Settings
ELEVENLABS_API_KEY=your-key
ELEVENLABS_VOICE_ID=kdmDKE6EkgrWrrykO9Qt
```

### Voice Parameters (per-personality)

Voice parameters can be set per personality in the database:

```typescript
{
  speed: 1.0,
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0.3
}
```

These are passed to the TTS service when creating the pipeline.

---

## Summary

**For Pearl's voice:**

1. **Default (easiest)**: Use ElevenLabs - just add API key
2. **Free/local**: Use Kokoro via Chorus TTS - requires model download + server
3. **Both work the same way**: WebSocket streaming → Daily.co → User hears voice

The bot code abstracts the provider differences - you just set `BOT_TTS_PROVIDER` and the appropriate credentials.

---

*See also:*
- `apps/pipecat-daily-bot/bot/providers/kokoro.py` - Kokoro implementation
- `scripts/start-chorus-tts.sh` - Chorus server startup
- `apps/dashboard/src/app/api/tts/preview/route.ts` - TTS preview endpoint

