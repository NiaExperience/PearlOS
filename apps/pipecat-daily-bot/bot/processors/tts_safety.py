"""Defense-in-depth safety processor for the TTS path.

Pipecat's TTSService already handles InterruptionFrame by calling
text_aggregator.handle_interruption() and flushes on LLMFullResponseEndFrame.
This processor adds an extra reset on BotStoppedSpeakingFrame so any stale
buffered text from a prior utterance is cleared before the next one begins.
It also logs aggregator state at key transitions so leaks become visible
in the runner log.

The TTS pipeline uses pipecat's ServiceSwitcher with several backing
services (each with its own text_aggregator), so this processor accepts
a list of aggregators and resets them all.
"""

from __future__ import annotations

from typing import Iterable, List

from loguru import logger

from pipecat.frames.frames import (
    BotStoppedSpeakingFrame,
    Frame,
    StartInterruptionFrame,
    TTSStoppedFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor


class TTSSafetyProcessor(FrameProcessor):
    """Resets bound TTS text aggregators between utterances."""

    def __init__(self, aggregators: Iterable, *, tag: str = "tts"):
        super().__init__()
        self._aggregators: List = [a for a in aggregators if a is not None]
        self._tag = tag

    async def _drain(self, reason: str) -> None:
        for agg in self._aggregators:
            stale = getattr(agg, "_text", "")
            if stale:
                logger.info(
                    f"[tts-safety:{self._tag}] {reason} with "
                    f"{len(stale)} stale chars; resetting: {stale!r}"
                )
                reset = getattr(agg, "reset", None)
                if reset is not None:
                    await reset()

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, StartInterruptionFrame):
            await self._drain("StartInterruption")
        elif isinstance(frame, (BotStoppedSpeakingFrame, TTSStoppedFrame)):
            await self._drain(type(frame).__name__)

        await self.push_frame(frame, direction)
