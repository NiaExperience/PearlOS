# Kokoro TTS Local Setup Guide

> **Complete guide to get Kokoro (Chorus TTS) working locally for Pearl's voice**

---

## Current Status Check

The submodule is **not initialized** and the directory is empty. Here's how to fix it:

---

## Step 1: Initialize the Chorus TTS Submodule

The Chorus TTS server code lives in a git submodule. Initialize it:

```bash
# Initialize and clone the submodule
git submodule update --init --recursive apps/chorus-tts

# Verify it's initialized (should show a commit hash, not a minus sign)
git submodule status apps/chorus-tts
```

**Expected output after initialization:**
```
 58c477dfec17015d653b1b463fc1bd9d696ff3f1 apps/chorus-tts (v1.0.0)
```

**If you see a minus sign (`-`), it's still not initialized.**

---

## Step 2: Install `uv` (Python Package Manager)

Chorus TTS uses `uv` for Python dependency management. Install it:

```bash
# On Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# Or using pip
pip install uv

# Or using homebrew (macOS)
brew install uv

# Verify installation
uv --version
```

**Required:** `uv` version ≥0.1.0

---

## Step 3: Download Kokoro Model Files

The model files are **not** in the git submodule - they're downloaded separately (~550MB total):

```bash
# Download the model files
npm run chorus:download-assets
```

This downloads:
- `apps/chorus-tts/kokoro-v1.0.onnx` (~500MB) - Neural TTS model
- `apps/chorus-tts/voices-v1.0.bin` (~50MB) - Voice embeddings

**Download URLs:**
- https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
- https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin

**Verify files exist:**
```bash
ls -lh apps/chorus-tts/kokoro-v1.0.onnx
ls -lh apps/chorus-tts/voices-v1.0.bin
```

Both files should exist and be ~500MB and ~50MB respectively.

---

## Step 4: Sync Python Dependencies

Set up the Python environment for Chorus TTS:

```bash
# This runs 'uv sync' in the chorus-tts directory
npm run chorus:uv-sync
```

**What this does:**
- Installs Python dependencies (FastAPI, ONNX Runtime, etc.)
- Creates a virtual environment managed by `uv`
- Sets up the Chorus TTS server environment

**Expected time:** 1-2 minutes

---

## Step 5: Start Chorus TTS Server

Start the Chorus TTS server:

```bash
# Start the server (runs on ws://127.0.0.1:8000)
npm run chorus:start
```

**Expected output:**
```
🚀 Starting Chorus TTS
   Host: 127.0.0.1
   Port: 8000
   Model: /path/to/apps/chorus-tts/kokoro-v1.0.onnx
   Voices: /path/to/apps/chorus-tts/voices-v1.0.bin
INFO:     Started server process
INFO:     Uvicorn running on http://127.0.0.1:8000
```

**Keep this terminal open** - the server needs to stay running.

---

## Step 6: Verify It's Working

Test the Chorus TTS server:

```bash
# In a new terminal, test the health endpoint
curl http://127.0.0.1:8000/health

# Or test with a simple WebSocket connection
# (requires websocat or similar tool)
```

**Expected:** Server responds with health status.

---

## Step 7: Configure Bot to Use Kokoro

Ensure your `.env.local` has Kokoro settings (Kokoro is now the default, but you can set explicitly):

```bash
# Kokoro is the default, but you can set explicitly:
BOT_TTS_PROVIDER=kokoro
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000
KOKORO_TTS_API_KEY=test-key  # Can be any string for local
KOKORO_TTS_VOICE_ID=am_fenrir  # Voice selection
```

**Note:** If you don't set `USE_ELEVENLABS=true`, Kokoro is used by default.

---

## Complete Setup Checklist

- [ ] Submodule initialized: `git submodule status apps/chorus-tts` shows commit hash (not `-`)
- [ ] `uv` installed: `uv --version` works
- [ ] Model files downloaded: `ls apps/chorus-tts/*.onnx apps/chorus-tts/*.bin` shows both files
- [ ] Python deps synced: `npm run chorus:uv-sync` completed successfully
- [ ] Server starts: `npm run chorus:start` shows server running on port 8000
- [ ] Health check works: `curl http://127.0.0.1:8000/health` responds
- [ ] Bot configured: `.env.local` has Kokoro settings (or uses default)

---

## Troubleshooting

### "Submodule not initialized"

```bash
# Initialize it
git submodule update --init --recursive apps/chorus-tts

# If that doesn't work, try:
git submodule init apps/chorus-tts
git submodule update apps/chorus-tts
```

### "uv not found"

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Add to PATH (if needed)
export PATH="$HOME/.cargo/bin:$PATH"

# Or use pip
pip install uv
```

### "Model files missing"

```bash
# Re-download
npm run chorus:download-assets

# Or manually download:
cd apps/chorus-tts
curl -L -o kokoro-v1.0.onnx \
  https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx
curl -L -o voices-v1.0.bin \
  https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin
```

### "Port 8000 already in use"

```bash
# Find what's using it
lsof -i :8000

# Kill it or change port
export SERVER_PORT=8001
npm run chorus:start
```

### "uv sync fails"

```bash
# Try manual sync
cd apps/chorus-tts
uv sync

# Check Python version (needs ≥3.10)
python3 --version

# If issues persist, check the pyproject.toml in apps/chorus-tts/
```

### "Server starts but bot can't connect"

```bash
# Check server is actually running
curl http://127.0.0.1:8000/health

# Check WebSocket URL in .env.local
KOKORO_TTS_BASE_URL=ws://127.0.0.1:8000  # Note: ws:// not http://

# Check bot logs for connection errors
```

---

## Quick Setup Script

Here's a one-liner to set everything up (if you have `uv` installed):

```bash
# Initialize submodule, download models, sync deps
git submodule update --init --recursive apps/chorus-tts && \
npm run chorus:download-assets && \
npm run chorus:uv-sync && \
echo "✅ Setup complete! Run 'npm run chorus:start' to start the server"
```

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│              Kokoro TTS Local Setup                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. Git Submodule (apps/chorus-tts/)                    │
│     └─ Python FastAPI server code                      │
│                                                         │
│  2. Model Files (downloaded separately)                │
│     ├─ kokoro-v1.0.onnx (~500MB)                       │
│     └─ voices-v1.0.bin (~50MB)                         │
│                                                         │
│  3. Python Environment (managed by uv)                  │
│     └─ Dependencies: FastAPI, ONNX Runtime, etc.        │
│                                                         │
│  4. Chorus Server (ws://127.0.0.1:8000)                │
│     └─ WebSocket API compatible with ElevenLabs         │
│                                                         │
│  5. Bot Connection                                      │
│     └─ KokoroTTSService connects via WebSocket          │
└─────────────────────────────────────────────────────────┘
```

---

## Next Steps

Once Chorus TTS is running:

1. **Start the bot**: `npm run start:all`
2. **Test voice**: Make a voice call in the interface
3. **Check logs**: Verify bot connects to `ws://127.0.0.1:8000`

---

**You're all set!** Pearl will now use Kokoro (local, free) for voice synthesis. 🎉

