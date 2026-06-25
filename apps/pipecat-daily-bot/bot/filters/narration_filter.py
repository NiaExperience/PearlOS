"""Strip Pearl tool-narration phrases from outgoing text.

Belt-and-suspenders backup to the prompt rules in
`pearl/context_loader.py` and `/root/.openclaw/agents/main/system-prompt.md`.
Use anywhere we emit assistant text to a human surface (web chat SSE,
Discord, TTS).

Behaviour
---------
- Splits text into sentences on `.`/`!`/`?` boundaries (newline-aware).
- Drops each sentence whose opener matches the `_NARRATION_RE` regex.
- If every sentence is stripped: returns an empty string by default. Replacing
  removed narration with another canned ack is the same failure in softer shoes.
"""

from __future__ import annotations

import logging
import re
from typing import List, Tuple

logger = logging.getLogger(__name__)

# Sentence segmentation: keep delimiters so we can re-join faithfully.
_SENTENCE_SPLIT_RE = re.compile(r'([.!?]+["\')\]]*\s+|\n+)')

# Anchored at sentence-start; tolerates a connective prefix
# ("So, ", "Now, ", "Okay, ", "Well, ", etc.).
_NARRATION_RE = re.compile(
    r"""
    ^\s*
    (?:(?:and|but|so|now|ok|okay|alright|well)[,\s]+)?
    (?:
        let\s+me\s+(?!know\b)\w+
      | let\s+us\b
      | let'?s\b
      | i\s*[''']?\s*ll\s+
            (?:check|look|see|grab|pull|verify|find|fetch|fire|run|try|
               start|begin|kick|spin|head|hop|dive|peek|investigate|dig|search|
               take\s+a\s+(?:look|peek))\b
      | i\s+will\s+
            (?:check|look|see|grab|pull|verify|find|fetch|run|try|start|
               begin|investigate|dig|search)\b
      | i\s*[''']?\s*m\s+(?:going\s+to|about\s+to|gonna)\b
      | i\s*[''']?\s*m\s+(?:checking|looking|fetching|grabbing|pulling|searching|
            investigating|digging|verifying|finding|loading|running|trying)\b
      | i\s+am\s+(?:going\s+to|about\s+to)\b
      | (?:i\s*(?:[''']?\s*m|\s+am)\s+)?on\s+it\b
      | (?:checking|looking|fetching|grabbing|pulling|searching|investigating|
            digging|verifying|finding|loading|firing|running|trying|starting|
            beginning)
            (?:\s+(?:on\s+(?:it|that)|that|this|now|into\s+(?:that|this|it)))?\b
      | hold\s+on\b
      | hang\s+on\b
      | one\s+(?:moment|sec(?:ond)?)\b
      | just\s+a\s+(?:sec|moment)\b
      | give\s+me\s+a\s+(?:sec|moment|second)\b
      | bear\s+with\s+me\b
      | stand\s+by\b
      | (?:first|next|then|after\s+that)\s*,?\s+
            i\s*(?:[''']?\s*ll|\s+will|\s+am\s+going\s+to)\b
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Empty by default: if a reply was only narration, suppress it.
_FALLBACK_ACK = ""


def _segment_sentences(text: str) -> List[Tuple[str, str]]:
    """Split into (sentence, trailing-delimiter) pairs."""
    pieces = _SENTENCE_SPLIT_RE.split(text)
    out: List[Tuple[str, str]] = []
    i = 0
    while i < len(pieces):
        sent = pieces[i]
        delim = pieces[i + 1] if i + 1 < len(pieces) else ""
        if sent or delim:
            out.append((sent, delim))
        i += 2
    return out


def strip_narration(
    text: str,
    *,
    fallback: str = _FALLBACK_ACK,
    log_label: str = "narration-filter",
) -> str:
    """Drop tool-narration sentences from `text`.

    Parameters
    ----------
    text:
        Input assistant text.
    fallback:
        Returned when every sentence was stripped *and* the original was
        non-empty. The default suppresses entirely.
    log_label:
        Tag used in warn/info log lines so callers (web/Discord/TTS) can
        be distinguished in the runner log.
    """
    if not text or not text.strip():
        return text

    segments = _segment_sentences(text)
    kept: List[str] = []
    dropped: List[str] = []
    for sent, delim in segments:
        if sent and _NARRATION_RE.match(sent):
            dropped.append(sent.strip())
            continue
        kept.append(sent + delim)

    if not dropped:
        return text  # no-op fast path

    cleaned = "".join(kept).strip()

    if cleaned:
        logger.info(
            "[%s] dropped %d narration sentence(s): %r",
            log_label, len(dropped), dropped[:3],
        )
        return cleaned

    if fallback:
        logger.warning(
            "[%s] entire reply was narration; replacing with fallback. "
            "original=%r", log_label, text,
        )
        return fallback

    logger.info(
        "[%s] entire reply was narration; suppressing. original=%r",
        log_label, text,
    )
    return ""


# Pipecat BaseTextFilter wrapper for TTS pipeline use.
try:
    from pipecat.utils.text.base_text_filter import BaseTextFilter

    class NarrationStripFilter(BaseTextFilter):
        """Pipecat text filter that strips narration before TTS synthesis."""

        async def filter(self, text: str) -> str:
            return strip_narration(text, log_label="narration-filter:tts")

        async def update_settings(self, settings):  # pragma: no cover
            pass
except ImportError:  # Pipecat not available (test envs)
    NarrationStripFilter = None  # type: ignore[misc,assignment]
