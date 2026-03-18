"""Shared mutable state for the voice session.

Tools, processors, and the pipeline can read/write this to keep
the OpenClaw session processor aware of what's happening on screen.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field


@dataclass
class VoiceState:
    """Live state of what the user sees and hears."""

    # What's currently displayed on the Wonder Canvas
    canvas_description: str = "Nothing currently displayed on canvas."
    canvas_updated_at: float = 0.0

    # Most recent news headlines shown
    news_headlines: str = ""
    news_updated_at: float = 0.0

    # Most recent weather data shown
    weather_summary: str = ""
    weather_updated_at: float = 0.0

    # Currently playing soundtrack
    soundtrack: str = ""

    # Open apps/windows on the PearlOS desktop
    open_apps: list[str] = field(default_factory=list)

    def set_canvas(self, description: str) -> None:
        self.canvas_description = description
        self.canvas_updated_at = time.time()

    def set_news(self, headlines: str) -> None:
        self.news_headlines = headlines
        self.news_updated_at = time.time()

    def set_weather(self, summary: str) -> None:
        self.weather_summary = summary
        self.weather_updated_at = time.time()

    def summary(self) -> str:
        """Build a concise summary for injection into the system prompt."""
        parts: list[str] = []
        parts.append(f"- Screen/Canvas: {self.canvas_description}")
        if self.news_headlines:
            parts.append(f"- News displayed: {self.news_headlines[:500]}")
        if self.weather_summary:
            parts.append(f"- Weather: {self.weather_summary[:300]}")
        if self.soundtrack:
            parts.append(f"- Playing: {self.soundtrack}")
        if self.open_apps:
            parts.append(f"- Open apps: {', '.join(self.open_apps)}")
        return "\n".join(parts)


# Module-level singleton — shared across all processors/tools in one bot process
_state = VoiceState()


def get() -> VoiceState:
    """Get the shared voice state singleton."""
    return _state


def reset() -> None:
    """Reset state (e.g., on session end)."""
    global _state
    _state = VoiceState()
