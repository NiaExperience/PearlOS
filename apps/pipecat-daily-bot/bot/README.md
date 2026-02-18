# Bot

A PipeCat AI bot for Daily.co integration that provides real-time voice interaction in video calls.

## Overview

This bot joins Daily.co video calls as an AI participant and provides intelligent voice responses using:
- **Speech-to-Text**: Daily's built-in transcription service
- **Text-to-Speech**: ElevenLabs for natural voice synthesis  
- **AI Processing**: OpenAI GPT-4 for intelligent responses
- **Voice Activity Detection**: Silero VAD for efficient audio processing
- **Authentication**: Daily API key for token generation

## Setup

### Prerequisites
- Python 3.10+
- Poetry (for Python dependency management)
- API keys for OpenAI, ElevenLabs, and Daily
- Daily.co room URL (required - must be an existing room)

#### Installing Poetry

If you don't have Poetry installed, you can install it using one of these methods:

**macOS / Linux:**
```bash
curl -sSL https://install.python-poetry.org | python3 -
```

**Windows (PowerShell):**
```powershell
(Invoke-WebRequest -Uri https://install.python-poetry.org -UseBasicParsing).Content | python -
```

**Using pip:**
```bash
pip install poetry
```

After installation, you may need to add Poetry to your PATH. See the [official Poetry installation guide](https://python-poetry.org/docs/#installation) for more details.

### Installation

**Option 1: From root directory (recommended)**
```bash
npm run install:all
```

**Option 2: From bot directory**
```bash
cd bot
poetry install
```

### Environment Configuration

Copy the environment template and configure your API keys:
```bash
cp ../env.example .env
```

Required environment variables:
```env
DAILY_API_KEY=your_daily_api_key_here
DAILY_ROOM_URL=https://your-domain.daily.co/your-room-name  # Required: existing room to connect to
OPENAI_API_KEY=your_openai_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
ELEVENLABS_VOICE_ID=your_voice_id_here  # Optional: specific voice ID
BOT_PERSONALITY=pearl  # Optional: personality name (default: pearl)
```

### Running the Bot

The bot is designed to be run as part of the larger Nia Universal platform using Tilt and Kubernetes.

Please refer to the root `README.md` for instructions on how to start the development environment.

### Personality System

The bot supports multiple personalities that can be easily switched:

**Available Personalities:**
- **Pearl** (default): Rebellious, direct, and opinionated AI companion with strong social justice views
- **Atlas**: Professional, efficient, and business-minded AI focused on productivity and results

**Switching Personalities:**

Set the personality using environment variable:
```bash
# Set in your .env file
BOT_PERSONALITY=pearl

# Or set as environment variable
export BOT_PERSONALITY=pearl
```

## Features

- **Real-time Voice Interaction**: Join Daily.co video calls as an AI participant
- **Speech-to-Text**: Powered by Deepgram for accurate transcription
- **Text-to-Speech**: Powered by ElevenLabs for natural voice synthesis
- **AI Processing**: OpenAI GPT-4 integration for intelligent responses
- **Voice Activity Detection**: Silero VAD for efficient audio processing
- **Automatic Transcription**: Daily.co built-in transcription support
- **Conversational AI**: Context-aware responses with conversation memory
- **Multiple Personalities**: Easily switch between different AI personalities (Pearl, Atlas)
- **Structured Event Bus**: Emits versioned envelopes for call state, participant joins/leaves, session end, and heartbeat
- **Streaming Telemetry**: Real-time SSE (`/events`) and WebSocket (`/ws/events`) streams for external dashboards

## Architecture

The bot uses PipeCat AI framework with the following pipeline:

1. **Daily Transport**: Audio input/output from video call
2. **Deepgram STT**: Speech-to-text conversion
3. **OpenAI LLM**: Natural language processing and response generation
4. **ElevenLabs TTS**: Text-to-speech conversion
5. **Context Aggregation**: Maintains conversation context

## Control Server & Streaming Endpoints

The companion FastAPI control server (started via `npm run start:daily:server`) exposes:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness + active session count |
| `POST /join` | Spawn or reuse a bot process (canonical URL reuse guarded by lock) |
| `GET /sessions` | Enumerate active bot processes |
| `POST /sessions/{pid}/leave` | Graceful leave (SIGINT→SIGTERM→SIGKILL) + `[session.end]` log + `bot.session.end` event |
| `DELETE /sessions/{pid}` | Immediate terminate (SIGTERM) |
| `GET /events` | Server-Sent Events stream of all bus envelopes |
| `GET /ws/events` | WebSocket JSON stream of the same envelopes |

### Event Bus Envelope

Every published event has structure:

```jsonc
{
	"id": "<uuid>",
	"ts": "2025-09-04T12:34:56.789Z",
	"type": "bot.session.end",
	"version": "1",
	"data": { /* event-specific payload */ }
}
```

Current event types:

- `daily.call.state`
- `daily.participant.join`
- `daily.participant.leave`
- `bot.session.end` (mirrors `[session.end]` log line – includes reason, graceful/forced flags)
- `daily.bot.heartbeat`
- (Planned) `daily.participants.change` – snapshot diff emission

### Session End Observability

When a bot process ends (graceful leave, escalation, reap) two signals are emitted:

1. Log line beginning with `[session.end]` (grep friendly)
2. Event bus envelope `bot.session.end` (streaming consumers)

This dual path ensures backwards-compatible log ingestion while enabling real-time UI dashboards.

## Development

### Local Development

```bash
cd bot
poetry install
poetry run python bot.py
```

### Tests

Run all tests:

```bash
poetry run pytest -q
```

Run only the app-message forwarder test:

```bash
poetry run pytest -q tests/test_app_message_forwarder.py
```

### Logging

The bot uses Loguru for logging. Logs are displayed in the terminal where the bot is running.

### Configuration

- Bot display name: "Pipecat Bot"
- Model: GPT-4o-mini (configurable in bot.py)
- VAD: Silero voice activity detection
- Audio: Enabled for both input and output

## Troubleshooting

### Common Issues

1. **Connection errors**: Verify DAILY_ROOM_URL is correct and accessible
2. **API key errors**: Check all required API keys are set in .env
3. **Audio issues**: Ensure the bot has proper audio permissions
4. **Model errors**: Verify OpenAI API key and model availability

### Logs

Bot logs are displayed in the terminal. Set log level in bot.py if needed:

```python
logger.add(sys.stderr, level="INFO")  # or "DEBUG" for more verbose logging
```

## Learn More

- [PipeCat AI Documentation](https://docs.pipecat.ai)
- [Daily.co Documentation](https://docs.daily.co)
- [OpenAI API Documentation](https://platform.openai.com/docs)
- [Deepgram Documentation](https://developers.deepgram.com)
- [ElevenLabs Documentation](https://docs.elevenlabs.io)

