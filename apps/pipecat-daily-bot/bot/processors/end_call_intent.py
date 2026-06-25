"""Deterministic end-call intent guard for voice sessions."""

from __future__ import annotations

import asyncio
import re

from loguru import logger
from pipecat.frames.frames import Frame, TranscriptionFrame
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from tools import events


_END_CALL_PATTERNS = [
    re.compile(r"\b(?:end|close|stop)\s+(?:the\s+)?(?:call|voice|voice\s+session|session)\b", re.I),
    re.compile(r"\b(?:hang\s*up|disconnect|leave\s+the\s+call)\b", re.I),
    re.compile(r"^(?:ok(?:ay)?|alright|all right|thanks|thank you|well)?\s*(?:goodbye|good bye|bye bye|bye pearl|goodbye pearl)\b", re.I),
    re.compile(r"^(?:bye|see ya|see you(?: later)?|later|talk soon|talk to you later)[.!?]?$", re.I),
    re.compile(r"\b(?:that'?s all|i'?m done|we'?re done|that will be all)\b", re.I),
]


def is_end_call_intent(text: str) -> bool:
    normalized = re.sub(r"\s+", " ", str(text or "").strip())
    if not normalized:
        return False
    return any(pattern.search(normalized) for pattern in _END_CALL_PATTERNS)


class EndCallIntentProcessor(FrameProcessor):
    """Emits bot.session.end after explicit farewell or hangup transcripts."""

    def __init__(
        self,
        forwarder_ref: dict,
        *,
        delay_seconds: float = 3.0,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self._forwarder_ref = forwarder_ref
        self._delay_seconds = delay_seconds
        self._end_requested = False
        self._emit_task: asyncio.Task | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if (
            isinstance(frame, TranscriptionFrame)
            and direction == FrameDirection.DOWNSTREAM
            and not self._end_requested
        ):
            text = frame.text.strip() if frame.text else ""
            if is_end_call_intent(text):
                self._end_requested = True
                self._emit_task = asyncio.create_task(self._emit_end_after_delay(text))

        await self.push_frame(frame, direction)

    async def _emit_end_after_delay(self, text: str) -> None:
        try:
            await asyncio.sleep(max(0.0, self._delay_seconds))
            forwarder = self._forwarder_ref.get("instance")
            if not forwarder:
                logger.warning("[end-call-intent] Unable to emit session end: missing forwarder")
                return
            await forwarder.emit_tool_event(
                events.BOT_SESSION_END,
                {
                    "reason": "user_requested",
                    "initiator": "assistant",
                    "source": "transcript_end_call_intent",
                    "graceful": True,
                    "trigger": text[:120],
                },
            )
            logger.info("[end-call-intent] Emitted bot.session.end after explicit farewell")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[end-call-intent] Failed to emit session end")
        finally:
            self._emit_task = None

    async def cleanup(self):
        if self._emit_task and not self._emit_task.done():
            self._emit_task.cancel()
        self._emit_task = None
        await super().cleanup()
