"""Unit tests for the voice registry helpers."""

from __future__ import annotations

import pytest
from chorus_tts.voices import SUPPORTED_VOICES, VoiceRegistry


def test_supported_voice_catalog() -> None:
    """Ensure the supported voice list covers expected locales."""
    # ensure catalog contains expected languages
    languages = {info.language_code for info in SUPPORTED_VOICES.values()}
    assert {"en-us", "en-gb", "fr-fr", "it", "ja", "cmn"} <= languages


def test_registry_defaults_to_alloy() -> None:
    """Default registry lookup should return af_alloy."""
    registry = VoiceRegistry()
    voice_id, info = registry.resolve(None)
    assert voice_id == "af_alloy"
    assert info.voice_id == "af_alloy"


def test_registry_accepts_known_voice() -> None:
    """Voices resolve when identifiers are known."""
    registry = VoiceRegistry()
    voice_id, info = registry.resolve("am_adam")
    assert voice_id == "am_adam"
    assert info.language_code == "en-us"


def test_registry_rejects_unknown_voice() -> None:
    """Unknown voice identifiers should raise KeyError."""
    registry = VoiceRegistry()
    with pytest.raises(KeyError):
        registry.resolve("unknown_voice")


def test_registry_filters_by_language() -> None:
    """Filter voices by language code."""
    registry = VoiceRegistry()
    ja_voices = registry.list(language="ja")
    assert all(info.language_code == "ja" for info in ja_voices)
