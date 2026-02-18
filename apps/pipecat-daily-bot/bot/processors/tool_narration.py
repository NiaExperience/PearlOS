"""Tool narration processor - emits filler audio during tool execution.

When tools are executing, the LLM stops streaming text, causing dead air in
voice sessions. This processor listens for FunctionCallsStartedFrame and
emits brief narration phrases so the TTS pipeline stays fed.

Insert this processor right after the LLM in the pipeline:
    [... context_agg.user(), llm, tool_narration, tts, ...]
"""

from __future__ import annotations

import asyncio
import random
import time

from loguru import logger

from pipecat.frames.frames import (
    Frame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
    FunctionCallInProgressFrame,
    FunctionCallResultFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


# Narration phrases — short, natural, varied
_NARRATION_PHRASES = [
    "One moment...",
    "Let me check on that.",
    "Working on it.",
    "Just a sec.",
    "Looking into that.",
    "Hang on...",
    "On it.",
    "Give me a moment.",
    "Checking now.",
]

# Longer filler for tools that take >5s
_EXTENDED_PHRASES = [
    "Still working on that...",
    "Almost there.",
    "Just pulling that together.",
    "Bear with me, still loading.",
]


class ToolNarrationProcessor(FrameProcessor):
    """Emits narration text frames while tool calls are in progress.

    Tracks in-flight tool calls via FunctionCallInProgressFrame /
    FunctionCallResultFrame. When tools are running and no LLM text is
    flowing, pushes short narration phrases to keep TTS active.

    Args:
        initial_delay: Seconds to wait after tool start before first narration.
            Set >0 so the LLM's own pre-tool text (e.g. "I'll check that")
            has time to finish speaking.
        repeat_interval: Seconds between follow-up narration phrases.
        enabled: Master switch (allows runtime toggling).
    """

    def __init__(
        self,
        *,
        initial_delay: float = 2.5,
        repeat_interval: float = 4.0,
        enabled: bool = True,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._initial_delay = initial_delay
        self._repeat_interval = repeat_interval
        self._enabled = enabled

        # Track in-flight tool calls by tool_call_id
        self._in_progress: set[str] = set()
        self._narration_task: asyncio.Task | None = None
        self._last_narration_time: float = 0
        self._used_phrases: list[str] = []

    def _pick_phrase(self, extended: bool = False) -> str:
        """Pick a narration phrase, avoiding recent repeats."""
        pool = _EXTENDED_PHRASES if extended else _NARRATION_PHRASES
        available = [p for p in pool if p not in self._used_phrases[-3:]]
        if not available:
            available = pool
            self._used_phrases.clear()
        phrase = random.choice(available)
        self._used_phrases.append(phrase)
        return phrase

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, FunctionCallInProgressFrame):
            tool_id = getattr(frame, "tool_call_id", None)
            if tool_id:
                self._in_progress.add(tool_id)
                logger.debug(f"[tool-narration] Tool started: {frame.function_name} ({tool_id})")
                if self._enabled and self._narration_task is None:
                    self._narration_task = asyncio.create_task(self._narrate_loop())

        elif isinstance(frame, FunctionCallResultFrame):
            tool_id = getattr(frame, "tool_call_id", None)
            if tool_id:
                self._in_progress.discard(tool_id)
                logger.debug(f"[tool-narration] Tool finished: {frame.function_name} ({tool_id})")
                if not self._in_progress:
                    self._stop_narration()

        # Always pass the frame through
        await self.push_frame(frame, direction)

    async def _narrate_loop(self):
        """Background task that emits narration phrases while tools run."""
        try:
            # Initial delay — let the LLM's own text finish speaking
            await asyncio.sleep(self._initial_delay)
            
            iteration = 0
            while self._in_progress:
                extended = iteration > 1  # Use longer phrases after a while
                phrase = self._pick_phrase(extended=extended)

                logger.info(f"[tool-narration] Emitting: \"{phrase}\" ({len(self._in_progress)} tools running)")

                # Wrap in LLM response frames so TTS processes it
                await self.push_frame(LLMFullResponseStartFrame())
                await self.push_frame(LLMTextFrame(phrase))
                await self.push_frame(LLMFullResponseEndFrame())

                self._last_narration_time = time.monotonic()
                iteration += 1

                await asyncio.sleep(self._repeat_interval)

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[tool-narration] Error in narrate loop: {e}", exc_info=True)
        finally:
            self._narration_task = None

    def _stop_narration(self):
        """Cancel the narration loop."""
        if self._narration_task and not self._narration_task.done():
            self._narration_task.cancel()
            self._narration_task = None
        self._used_phrases.clear()

    async def cleanup(self):
        self._stop_narration()
        await super().cleanup()
