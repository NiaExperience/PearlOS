# SPDX-License-Identifier: MIT
"""Static registry of supported Kokoro voices.

Kokoro ships with a fixed set of speakers (largely overlapping with the original
ElevenLabs names). Each entry maps directly to a model voice key, so no extra
mapping file is required. We keep a simple registry abstraction to encapsulate
validation and expose helper utilities used by the websocket layer.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class VoiceInfo:
    """Metadata describing an individual Kokoro voice."""

    voice_id: str
    language_code: str
    category: str


# Canonical list derived from Kokoro documentation.
_VOICE_DATA: tuple[tuple[str, str, str], ...] = (
    # US female
    ("af_alloy", "en-us", "US female"),
    ("af_aoede", "en-us", "US female"),
    ("af_bella", "en-us", "US female"),
    ("af_heart", "en-us", "US female"),
    ("af_jessica", "en-us", "US female"),
    ("af_kore", "en-us", "US female"),
    ("af_nicole", "en-us", "US female"),
    ("af_nova", "en-us", "US female"),
    ("af_river", "en-us", "US female"),
    ("af_sarah", "en-us", "US female"),
    ("af_sky", "en-us", "US female"),
    # US male
    ("am_adam", "en-us", "US male"),
    ("am_echo", "en-us", "US male"),
    ("am_eric", "en-us", "US male"),
    ("am_fenrir", "en-us", "US male"),
    ("am_liam", "en-us", "US male"),
    ("am_michael", "en-us", "US male"),
    ("am_onyx", "en-us", "US male"),
    ("am_puck", "en-us", "US male"),
    # UK voices
    ("bf_alice", "en-gb", "UK female"),
    ("bf_emma", "en-gb", "UK female"),
    ("bf_isabella", "en-gb", "UK female"),
    ("bf_lily", "en-gb", "UK female"),
    ("bm_daniel", "en-gb", "UK male"),
    ("bm_fable", "en-gb", "UK male"),
    ("bm_george", "en-gb", "UK male"),
    ("bm_lewis", "en-gb", "UK male"),
    # French
    ("ff_siwis", "fr-fr", "French"),
    # Italian
    ("if_sara", "it", "Italian"),
    ("im_nicola", "it", "Italian"),
    # Japanese
    ("jf_alpha", "ja", "Japanese"),
    ("jf_gongitsune", "ja", "Japanese"),
    ("jf_nezumi", "ja", "Japanese"),
    ("jf_tebukuro", "ja", "Japanese"),
    ("jm_kumo", "ja", "Japanese"),
    # Mandarin
    ("zf_xiaobei", "cmn", "Mandarin"),
    ("zf_xiaoni", "cmn", "Mandarin"),
    ("zf_xiaoxiao", "cmn", "Mandarin"),
    ("zf_xiaoyi", "cmn", "Mandarin"),
    ("zm_yunjian", "cmn", "Mandarin"),
    ("zm_yunxi", "cmn", "Mandarin"),
    ("zm_yunxia", "cmn", "Mandarin"),
    ("zm_yunyang", "cmn", "Mandarin"),
)


SUPPORTED_VOICES: Mapping[str, VoiceInfo] = {
    voice_id: VoiceInfo(voice_id=voice_id, language_code=lang, category=category)
    for voice_id, lang, category in _VOICE_DATA
}


class VoiceRegistry:
    """Validate requested voice ids against the known Kokoro set."""

    def __init__(self, default_voice_id: str = "af_alloy") -> None:
        """Store the default voice id and validate it against the registry."""
        if default_voice_id not in SUPPORTED_VOICES:
            message = f"Unknown default voice id {default_voice_id!r}."
            raise ValueError(message)
        self._default_voice_id = default_voice_id

    @property
    def default_voice_id(self) -> str:
        """Return the voice id used when callers do not request a specific voice."""
        return self._default_voice_id

    def resolve(self, voice_id: str | None) -> tuple[str, VoiceInfo]:
        """Return the best voice for the request, falling back to the default.

        Raises:
            KeyError: when a voice id is provided but not supported and no
                fallback is allowed.

        """
        if voice_id is None:
            return self._default_voice_id, SUPPORTED_VOICES[self._default_voice_id]

        if voice_id in SUPPORTED_VOICES:
            return voice_id, SUPPORTED_VOICES[voice_id]

        # If an explicit id was supplied but is unknown, surface an error so
        # callers can respond.
        message = f"Unknown voice id: {voice_id}"
        raise KeyError(message)

    def list(self, *, language: str | None = None) -> list[VoiceInfo]:
        """List voices, optionally filtered by language code."""
        voices = list(SUPPORTED_VOICES.values())
        if language:
            voices = [info for info in voices if info.language_code == language]
        return sorted(voices, key=lambda info: info.voice_id)
