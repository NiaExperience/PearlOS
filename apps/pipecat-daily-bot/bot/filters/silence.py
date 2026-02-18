from loguru import logger
from pipecat.utils.text.base_text_filter import BaseTextFilter

class SilenceTextFilter(BaseTextFilter):
    async def filter(self, text: str) -> str:
        if text.strip().upper() == "SILENCE":
            logger.debug("SilenceTextFilter: dropping SILENCE token before TTS")
            return ""
        return text

    async def handle_interruption(self):
        """Handle interruption event."""
        pass

    async def reset_interruption(self):
        """Reset interruption state."""
        pass
        
    async def update_settings(self, settings: dict):
        """Update filter settings."""
        pass
