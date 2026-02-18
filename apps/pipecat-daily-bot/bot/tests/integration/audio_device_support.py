"""Runtime helpers for verifying virtual audio device availability during tests."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from dataclasses import dataclass
from typing import Iterable, Optional

_AUDIO_DOC_PATH = "apps/pipecat-daily-bot/bot/tests/integration/README.audio-devices.md"
_AUDIO_HINT_ENV = "PIPECAT_AUDIO_DEVICE_HINT"


@dataclass(slots=True)
class AudioDeviceCheckResult:
    ok: bool
    message: str = ""
    details: str = ""


def check_audio_device_support() -> AudioDeviceCheckResult:
    """Inspect the host OS for loopback/virtual microphone support."""

    system = platform.system()
    if system == "Darwin":
        return _check_macos_devices()
    if system == "Linux":
        return _check_linux_devices()
    return AudioDeviceCheckResult(
        ok=False,
        message=(
            f"Unsupported OS '{system}' for audio device detection. "
            f"Refer to {_AUDIO_DOC_PATH} to configure a compatible loopback device."
        ),
    )


def _check_macos_devices() -> AudioDeviceCheckResult:
    keywords = _mac_keyword_candidates()
    outputs = _collect_command_outputs(
        ["SwitchAudioSource", "-a"],
        ["system_profiler", "SPAudioDataType"],
    )
    if not outputs:
        return AudioDeviceCheckResult(
            ok=False,
            message=(
                "Unable to inspect CoreAudio devices (missing SwitchAudioSource/system_profiler). "
                f"See {_AUDIO_DOC_PATH} to install a virtual device."
            ),
        )
    if _output_contains_keywords(outputs, keywords):
        return AudioDeviceCheckResult(ok=True)
    return AudioDeviceCheckResult(
        ok=False,
        message=(
            "No Loopback or BlackHole devices detected in CoreAudio. "
            f"Install one following {_AUDIO_DOC_PATH} or export PIPECAT_SKIP_AUDIO_DEVICE_CHECK=1 to bypass."
        ),
    )


def _check_linux_devices() -> AudioDeviceCheckResult:
    keywords = ("loopback", "monitor", "alsa", "pulse")
    outputs = _collect_command_outputs(
        ["pactl", "list", "short", "sources"],
        ["pacmd", "list-sources"],
        ["arecord", "-l"],
        ["aplay", "-l"],
    )
    if not outputs:
        return AudioDeviceCheckResult(
            ok=False,
            message=(
                "PulseAudio/ALSA utilities were not found on PATH. "
                f"Install pactl or alsa-utils as described in {_AUDIO_DOC_PATH}."
            ),
        )
    haystack = "\n".join(outputs).lower()
    if any(keyword in haystack for keyword in keywords):
        return AudioDeviceCheckResult(ok=True)
    return AudioDeviceCheckResult(
        ok=False,
        message=(
            "PulseAudio/ALSA is available but no loopback/monitor sources were reported. "
            f"Provision a null sink or ALSA loopback per {_AUDIO_DOC_PATH}."
        ),
    )


def _collect_command_outputs(*commands: Iterable[str]) -> list[str]:
    results: list[str] = []
    for command in commands:
        text = _run_command(command)
        if text:
            results.append(text)
    return results


def _output_contains_keywords(outputs: list[str], keywords: tuple[str, ...]) -> bool:
    if not keywords:
        return False
    for output in outputs:
        for token in _extract_device_tokens(output):
            text = token.lower()
            if any(keyword in text for keyword in keywords):
                return True
    return False


def _run_command(command: Iterable[str]) -> Optional[str]:
    command_list = list(command)
    if not command_list or shutil.which(command_list[0]) is None:
        return None
    try:
        completed = subprocess.run(
            command_list,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except Exception:
        return None
    output = "".join(filter(None, [completed.stdout, completed.stderr]))
    return output.strip() or None


def _extract_device_tokens(output: str) -> list[str]:
    tokens: list[str] = []
    allowed_keys = {
        "device name",
        "input device",
        "output device",
        "default input device",
        "default output device",
    }
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ":" in line:
            key, value = line.split(":", 1)
            if key.strip().lower() in allowed_keys:
                cleaned = value.strip()
                if cleaned:
                    tokens.append(cleaned)
            else:
                cleaned_key = key.strip()
                cleaned_value = value.strip()
                if cleaned_value:
                    tokens.append(cleaned_value)
                elif cleaned_key:
                    tokens.append(cleaned_key)
            continue
        tokens.append(line)
    return tokens


def _mac_keyword_candidates() -> tuple[str, ...]:
    hint = os.getenv(_AUDIO_HINT_ENV)
    base = ["loopback", "blackhole", "black hole", "loopback audio", "rogue amoeba"]
    if hint:
        base.insert(0, hint.strip().lower())
    return tuple(base)
