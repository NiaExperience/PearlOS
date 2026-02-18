"""Clause-level text aggregator for faster TTS response.

Splits on commas, semicolons, colons, and em-dashes in addition to sentence
boundaries. This gets the first audio chunk to the user faster because PocketTTS
can start synthesizing a clause while the LLM is still generating the rest.

Trade-off: slightly more TTS HTTP requests, but each is smaller and the first
one fires sooner.
"""

from typing import AsyncIterator, Optional

from pipecat.utils.text.base_text_aggregator import Aggregation, AggregationType, BaseTextAggregator

# Characters that indicate a natural speech pause (clause boundary)
CLAUSE_BREAKS = set(",;:—–")
SENTENCE_ENDINGS = set(".!?")
MIN_CLAUSE_LENGTH = 40  # Larger chunks = fewer HTTP requests = fewer inter-segment gaps (crackling fix)


class ClauseTextAggregator(BaseTextAggregator):
    """Aggregates text and yields at clause boundaries for faster TTS onset."""

    def __init__(self, min_clause_length: int = MIN_CLAUSE_LENGTH):
        self._text = ""
        self._min_length = min_clause_length

    @property
    def text(self) -> Aggregation:
        return Aggregation(text=self._text.strip(), type=AggregationType.SENTENCE)

    async def aggregate(self, text: str) -> AsyncIterator[Aggregation]:
        for char in text:
            self._text += char

            # Check for sentence endings (always yield)
            if char in SENTENCE_ENDINGS and len(self._text.strip()) >= 3:
                result = self._text.strip()
                self._text = ""
                if result:
                    yield Aggregation(text=result, type=AggregationType.SENTENCE)
                continue

            # Check for clause breaks (yield if we have enough text)
            if char in CLAUSE_BREAKS and len(self._text.strip()) >= self._min_length:
                result = self._text.strip()
                self._text = ""
                if result:
                    yield Aggregation(text=result, type=AggregationType.SENTENCE)

    async def flush(self) -> Optional[Aggregation]:
        if self._text.strip():
            result = self._text.strip()
            self._text = ""
            return Aggregation(text=result, type=AggregationType.SENTENCE)
        return None

    async def handle_interruption(self):
        self._text = ""

    async def reset(self):
        self._text = ""
