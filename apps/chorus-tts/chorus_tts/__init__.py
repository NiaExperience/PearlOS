# SPDX-License-Identifier: MIT
"""Top level package for chorus_tts.

Provides convenience re-exports for configuration helpers so application
entry points can simply import `load_settings` to bootstrap environment.
"""

from .config import Settings, load_settings
from .voices import SUPPORTED_VOICES, VoiceInfo, VoiceRegistry

__all__ = [
    "SUPPORTED_VOICES",
    "Settings",
    "VoiceInfo",
    "VoiceRegistry",
    "load_settings",
]
