"""Canvas Prefetch Processor — instant canvas display before LLM responds.

Sits before the LLM in the pipeline. Intercepts user transcription frames,
uses fast keyword/regex matching to detect intent, and immediately emits
a Wonder Canvas event with a pre-rendered template. The LLM still processes
the same frame and may replace the canvas with richer content later.

This eliminates the 5-10s wait for canvas by decoupling display from LLM.
"""

from __future__ import annotations

import asyncio
import json
import re
from urllib.parse import quote
from urllib.request import urlopen

from loguru import logger

from pipecat.frames.frames import Frame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from tools import events
from tools.wonder_canvas_templates import render_template


# ---------------------------------------------------------------------------
# Intent patterns — order matters, first match wins
# ---------------------------------------------------------------------------

_WEATHER_RE = re.compile(
    r"\b(?:weather|temperature|forecast|how (?:hot|cold|warm)|is it (?:raining|snowing|sunny))\b",
    re.IGNORECASE,
)
_WEATHER_CITY_RE = re.compile(
    r"weather (?:in|for|at) ([a-zA-Z\s]+)",
    re.IGNORECASE,
)

_DEFINE_RE = re.compile(
    r"(?:define|what does|what do) ([a-zA-Z\s\-']+?)(?:\s+mean|\?|$)",
    re.IGNORECASE,
)

_ABOUT_RE = re.compile(
    r"(?:tell me about|what (?:is|are|was|were)|who (?:is|was|are)|explain) (.+?)(?:\?|$)",
    re.IGNORECASE,
)

_NEWS_RE = re.compile(
    r"\b(?:news|what'?s happening|headlines|current events)\b",
    re.IGNORECASE,
)

_COUNTDOWN_RE = re.compile(
    r"countdown (?:to|until|for) (.+?)(?:\?|$)",
    re.IGNORECASE,
)


class CanvasPrefetchProcessor(FrameProcessor):
    """Inspects transcription frames and pre-renders canvas templates."""

    def __init__(self, forwarder_ref: dict, **kwargs):
        super().__init__(**kwargs)
        self._forwarder_ref = forwarder_ref

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        # Only intercept user transcription frames going downstream
        if isinstance(frame, TranscriptionFrame) and direction == FrameDirection.DOWNSTREAM:
            text = frame.text.strip() if frame.text else ""
            if text and len(text) > 3:
                # Fire-and-forget — don't block the pipeline
                asyncio.create_task(self._try_prefetch(text))

        # Always pass frame through unchanged
        await self.push_frame(frame, direction)

    async def _try_prefetch(self, text: str):
        """Attempt to match intent and emit a canvas event."""
        try:
            forwarder = self._forwarder_ref.get("instance")
            if not forwarder:
                return

            html = await self._match_and_render(text)
            if html:
                await forwarder.emit_tool_event(events.WONDER_CANVAS_SCENE, {
                    "html": html,
                    "css": "",
                    "transition": "fade",
                    "layer": "main",
                })
                logger.info(f"[canvas-prefetch] Pre-rendered canvas for: {text[:50]}")
        except Exception as e:
            logger.debug(f"[canvas-prefetch] Prefetch failed (non-fatal): {e}")

    async def _match_and_render(self, text: str) -> str | None:
        """Match user text to a template and render it. Returns HTML or None."""

        # Weather
        m = _WEATHER_RE.search(text)
        if m:
            city_m = _WEATHER_CITY_RE.search(text)
            city = city_m.group(1).strip() if city_m else "auto"
            return await self._render_weather(city)

        # Definition
        m = _DEFINE_RE.search(text)
        if m:
            word = m.group(1).strip()
            return render_template("definition_card", word=word, definition="Loading...", part_of_speech="")

        # News
        if _NEWS_RE.search(text):
            return render_template("news_headline", headline="Latest Headlines", source="Loading", summary="Fetching the latest news...")

        # Countdown
        m = _COUNTDOWN_RE.search(text)
        if m:
            event = m.group(1).strip()
            return render_template("countdown_timer", event_name=event, countdown_display="...")

        # "Tell me about X" / "What is X" / "Who is X" — use editorial_split or fact_card
        m = _ABOUT_RE.search(text)
        if m:
            topic = m.group(1).strip().rstrip("?. ")
            if len(topic) > 2:
                return render_template("fact_card",
                    title=topic.title(),
                    fact_text="Loading...",
                    category="Exploring",
                    icon="",
                )

        return None

    async def _render_weather(self, city: str) -> str:
        """Fetch weather from wttr.in and render weather_card."""
        try:
            url = f"https://wttr.in/{quote(city)}?format=j1" if city != "auto" else "https://wttr.in/?format=j1"
            loop = asyncio.get_event_loop()
            resp = await asyncio.wait_for(
                loop.run_in_executor(None, lambda: urlopen(url, timeout=3).read()),
                timeout=4.0,
            )
            data = json.loads(resp)
            current = data.get("current_condition", [{}])[0]
            area = data.get("nearest_area", [{}])[0]
            location = area.get("areaName", [{}])[0].get("value", city)
            temp_f = current.get("temp_F", "--")
            condition = current.get("weatherDesc", [{}])[0].get("value", "Unknown")
            humidity = current.get("humidity", "--")
            wind = current.get("windspeedMiles", "--")

            # Map condition to icon
            cond_lower = condition.lower()
            if "sun" in cond_lower or "clear" in cond_lower:
                icon = "☀️"
            elif "cloud" in cond_lower or "overcast" in cond_lower:
                icon = "☁️"
            elif "rain" in cond_lower or "drizzle" in cond_lower:
                icon = "🌧️"
            elif "snow" in cond_lower:
                icon = "❄️"
            elif "thunder" in cond_lower or "storm" in cond_lower:
                icon = "⛈️"
            elif "fog" in cond_lower or "mist" in cond_lower:
                icon = "🌫️"
            else:
                icon = "🌤️"

            details = (
                f'<div class="weather-detail"><div class="weather-detail-val">{humidity}%</div>'
                f'<div class="weather-detail-label">Humidity</div></div>'
                f'<div class="weather-detail"><div class="weather-detail-val">{wind} mph</div>'
                f'<div class="weather-detail-label">Wind</div></div>'
            )

            return render_template("weather_card",
                location=location,
                temperature=f"{temp_f}°F",
                condition=condition,
                icon=icon,
                forecast_bars=details,
            )
        except Exception as e:
            logger.debug(f"[canvas-prefetch] Weather fetch failed: {e}")
            # Render a placeholder weather card
            return render_template("weather_card",
                location=city if city != "auto" else "Your Location",
                temperature="--°F",
                condition="Loading...",
                icon="🌤️",
            )
