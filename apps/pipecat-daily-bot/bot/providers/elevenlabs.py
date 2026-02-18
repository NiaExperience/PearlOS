"""Pipecat-compatible ElevenLabs TTS client with hot-swapping support.

This service extends the standard ElevenLabsTTSService to add support for
updating the voice ID dynamically without replacing the service instance.
"""

from __future__ import annotations

import os
from typing import Callable, Optional, Awaitable
from loguru import logger as base_logger
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService as BaseElevenLabsTTSService

class ElevenLabsTTSService(BaseElevenLabsTTSService):
    """Extended ElevenLabs client with set_voice support and error handling."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._error_handler: Optional[Callable[[Exception], Awaitable[None]]] = None

    def _log(self):
        return base_logger.bind(
            sessionId=os.getenv("BOT_SESSION_ID"),
            userId=os.getenv("BOT_SESSION_USER_ID"),
            userName=os.getenv("BOT_SESSION_USER_NAME"),
        )

    def set_error_handler(self, handler: Callable[[Exception], Awaitable[None]]):
        """Set a callback to be invoked when a critical error occurs."""
        self._error_handler = handler

    async def _connect_websocket(self):
        """Override connection to catch 403 errors."""
        try:
            await super()._connect_websocket()
        except Exception as e:
            # Check for 403 Forbidden which indicates expired/invalid key
            if "403" in str(e):
                self._log().error(f"ElevenLabs 403 Forbidden detected: {e}")
                if self._error_handler:
                    self._log().warning("Triggering error handler for failover...")
                    await self._error_handler(e)
            # Re-raise to ensure standard behavior is preserved
            raise e

    async def set_voice(self, voice_id: str):
        """Update the voice ID and reconnect if necessary."""
        if self._voice_id == voice_id:
            return
        self._log().info(f"ElevenLabsTTSService: switching voice from {self._voice_id} to {voice_id}")
        self._voice_id = voice_id
        # Force reconnection on next usage
        await self._disconnect()
