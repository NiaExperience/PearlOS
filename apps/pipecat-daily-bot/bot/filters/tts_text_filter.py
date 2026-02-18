"""Text filter that strips markdown and special characters before TTS synthesis.

This prevents the TTS engine from trying to vocalize markdown formatting
(e.g., **bold**, *italic*, # headings, ```code```) which causes garbled
or distorted audio output.
"""

import re
from pipecat.utils.text.base_text_filter import BaseTextFilter


class MarkdownStripFilter(BaseTextFilter):
    """Strips markdown formatting from text before TTS synthesis."""

    # Patterns ordered from most specific to least specific
    _PATTERNS = [
        # Code blocks (fenced)
        (re.compile(r"```[\s\S]*?```", re.MULTILINE), ""),
        # Inline code
        (re.compile(r"`([^`]+)`"), r"\1"),
        # Bold+italic (***text*** or ___text___)
        (re.compile(r"\*{3}(.+?)\*{3}"), r"\1"),
        (re.compile(r"_{3}(.+?)_{3}"), r"\1"),
        # Bold (**text** or __text__)
        (re.compile(r"\*{2}(.+?)\*{2}"), r"\1"),
        (re.compile(r"_{2}(.+?)_{2}"), r"\1"),
        # Italic (*text* or _text_) — avoid matching mid-word underscores
        (re.compile(r"(?<!\w)\*(.+?)\*(?!\w)"), r"\1"),
        (re.compile(r"(?<!\w)_(.+?)_(?!\w)"), r"\1"),
        # Strikethrough (~~text~~)
        (re.compile(r"~~(.+?)~~"), r"\1"),
        # Headers (# text)
        (re.compile(r"^#{1,6}\s+", re.MULTILINE), ""),
        # Blockquotes (> text)
        (re.compile(r"^>\s+", re.MULTILINE), ""),
        # Unordered list markers (- or * at line start)
        (re.compile(r"^[\-\*]\s+", re.MULTILINE), ""),
        # Ordered list markers (1. 2. etc.)
        (re.compile(r"^\d+\.\s+", re.MULTILINE), ""),
        # Links [text](url) → text
        (re.compile(r"\[([^\]]+)\]\([^\)]+\)"), r"\1"),
        # Bare URLs
        (re.compile(r"https?://\S+"), ""),
        # HTML tags
        (re.compile(r"<[^>]+>"), ""),
        # Horizontal rules
        (re.compile(r"^[-*_]{3,}\s*$", re.MULTILINE), ""),
        # Multiple newlines → single space
        (re.compile(r"\n{2,}"), " "),
        # Remaining newlines → space
        (re.compile(r"\n"), " "),
        # Collapse multiple spaces
        (re.compile(r" {2,}"), " "),
    ]

    # Characters that TTS engines commonly stumble on
    _CHAR_REPLACEMENTS = {
        "—": ", ",      # em dash → pause
        "–": ", ",      # en dash → pause
        "…": "...",     # ellipsis (some TTS handle ... better)
        "•": "",        # bullet
        "→": "to",
        "←": "from",
        "≥": "greater than or equal to",
        "≤": "less than or equal to",
        "≠": "not equal to",
        "±": "plus or minus",
        "&": "and",
        "#": "number ",
        "@": "at ",
    }

    async def filter(self, text: str) -> str:
        if not text:
            return text

        # Regex patterns first (strips markdown structure)
        for pattern, replacement in self._PATTERNS:
            text = pattern.sub(replacement, text)

        # Character replacements after (handles remaining special chars)
        for char, replacement in self._CHAR_REPLACEMENTS.items():
            text = text.replace(char, replacement)

        return text.strip()

    async def handle_interruption(self):
        pass

    async def update_settings(self, settings):
        pass
