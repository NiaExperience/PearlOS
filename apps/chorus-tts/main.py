"""Command-line entry point for running the Chorus TTS server."""

from __future__ import annotations

import uvicorn
from chorus_tts import Settings, VoiceRegistry, load_settings
from chorus_tts.app import create_app
from chorus_tts.kokoro_engine import KokoroEngine


def build_app(settings: Settings | None = None):
    """Create the ASGI app with resolved dependencies."""
    settings = settings or load_settings()
    registry = VoiceRegistry(default_voice_id=settings.default_voice_id)
    engine = KokoroEngine(settings, registry)
    return create_app(settings, voice_registry=registry, engine=engine)


def main() -> None:
    """Resolve settings and start the Uvicorn server."""
    settings = load_settings()
    app = build_app(settings)
    uvicorn.run(
        app,
        host=settings.server_host,
        port=settings.server_port,
        log_level=settings.log_level,
    )


if __name__ == "__main__":
    main()
