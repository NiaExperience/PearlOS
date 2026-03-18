## Pipecat Daily Bot (`apps/pipecat-daily-bot`)

The Pipecat Daily Bot app implements PearlOS’s real‑time voice assistant using the Pipecat framework and Daily.co.

- **Purpose**: manage the audio pipeline (STT → LLM → tools → TTS) and coordinate with the Interface desktop over WebRTC and HTTP callbacks.
- **Structure**:
  - `bot/`: Python package containing the Pipecat pipeline, tool implementations, event bus, and runners.
  - `ui/`: Daily.co‑based React UI for joining calls and visualizing the voice session.
  - `scripts/`: Node/TS helpers for starting gateway and bot server processes.
- **Pipeline**:
  - Ingests audio via Daily.co, streams to STT (e.g. Deepgram), sends transcribed text to an LLM, executes registered tools, then synthesizes speech via PocketTTS/Kokoro.
  - Uses `@nia/events` descriptors to ensure event safety and redaction.
- **Environment**:
  - Configured via `.env` (Daily, STT, LLM, TTS, callback URLs).

