# SPDX-License-Identifier: MIT
"""Locust entry point for exercising the Chorus TTS websocket streaming API.

Run via:
    locust -f loadtest/locustfile.py --headless -u 5 -r 1 -t 5m

Environment variables (optional):
    KOKORO_LOADTEST_URL_TEMPLATE  ws://host:port/v1/text-to-speech/{voice_id}/stream-input
    KOKORO_LOADTEST_API_KEY       API key sent via xi-api-key header (default: test-key)
    KOKORO_LOADTEST_VOICE_IDS     Comma-separated list of voice ids (default: af_alloy)
    KOKORO_LOADTEST_PROMPTS       Path to prompts file (default: loadtest/prompts.txt)
    KOKORO_LOADTEST_INIT_TEXT     Initial text payload (default: single blank space)
    KOKORO_LOADTEST_TIMEOUT       Stream timeout in seconds (default: 20)
    KOKORO_LOADTEST_CHUNK_MODE    sentence | comma (default: sentence)
"""

from __future__ import annotations

import os
import random
import time
from collections.abc import Iterable
from pathlib import Path

import gevent
from locust import User, between, events, task

try:
    from loadtest.client import stream_text_sync
except ImportError as exc:  # pragma: no cover - locust runtime dependency
    message = "loadtest.client must be importable for load testing."
    raise RuntimeError(message) from exc


def _load_prompts(path: Path | None) -> list[str]:
    """Return a list of prompts, falling back to inline defaults."""
    if path is None:
        return [
            "Hello there. This is a short prompt to exercise streaming.",
            (
                "Concurrency testing helps us understand how Kokoro behaves "
                "under pressure."
            ),
            (
                "The quick brown fox jumps over the lazy dog near the riverbank "
                "while the sun sets "
                "beautifully on the horizon."
            ),
        ]

    if not path.exists():
        message = f"Prompt file does not exist: {path}"
        raise FileNotFoundError(message)

    prompts = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    prompts = [prompt for prompt in prompts if prompt]
    if not prompts:
        message = f"Prompt file {path} did not contain any text."
        raise ValueError(message)
    return prompts


def _parse_voice_ids(raw: str) -> list[str]:
    voices = [voice.strip() for voice in raw.split(",") if voice.strip()]
    return voices or ["af_alloy"]


class KokoroWebsocketUser(User):
    """Locust user that exercises the Kokoro websocket streaming protocol."""

    wait_time = between(0.5, 1.5)

    def on_start(self) -> None:
        """Initialise websocket configuration from environment variables."""
        url_template = os.getenv(
            "KOKORO_LOADTEST_URL_TEMPLATE",
            "ws://127.0.0.1:8000/v1/text-to-speech/{voice_id}/stream-input",
        )
        self._url_template = url_template

        voice_env = os.getenv("KOKORO_LOADTEST_VOICE_IDS", "af_alloy")
        self._voice_ids = _parse_voice_ids(voice_env)

        prompts_path = os.getenv("KOKORO_LOADTEST_PROMPTS")
        prompts = (
            _load_prompts(Path(prompts_path))
            if prompts_path
            else _load_prompts(Path("loadtest/prompts.txt"))
        )
        self._prompts = prompts

        self._api_key = os.getenv("KOKORO_LOADTEST_API_KEY", "test-key")
        self._init_text = os.getenv("KOKORO_LOADTEST_INIT_TEXT", " ")
        self._timeout = float(os.getenv("KOKORO_LOADTEST_TIMEOUT", "20"))
        self._chunk_mode = os.getenv("KOKORO_LOADTEST_CHUNK_MODE", "sentence")

    @task
    def stream_prompt(self) -> None:
        """Execute a streaming request and record metrics."""
        voice_id = random.choice(self._voice_ids)  # noqa: S311 - test utility
        text = random.choice(self._prompts)  # noqa: S311 - test utility
        url = self._url_template.format(voice_id=voice_id)

        start_monotonic = time.perf_counter()
        try:
            result = stream_text_sync(
                url=url,
                api_key=self._api_key,
                init_text=self._init_text,
                text=text,
                timeout=self._timeout,
                chunk_mode=self._chunk_mode,
            )
        except Exception as exc:
            total_ms = (time.perf_counter() - start_monotonic) * 1000.0
            events.request.fire(
                request_type="websocket",
                name="stream",
                response_time=total_ms,
                response_length=0,
                exception=exc,
            )
            raise

        audio_bytes = result.get("audio_bytes", b"")
        chunks = result.get("chunk_count", 0)
        start_ts = result.get("start_timestamp")
        end_ts = result.get("end_timestamp")
        chunk_timestamps: Iterable[float] = result.get("chunk_timestamps", [])
        audio_duration_s = float(result.get("audio_duration_s", 0.0))

        total_ms = (
            (end_ts - start_ts) * 1000.0
            if start_ts is not None and end_ts is not None
            else (time.perf_counter() - start_monotonic) * 1000.0
        )

        chunk_times = list(chunk_timestamps)
        ttfb_ms = result.get(
            "ttfb_ms",
            total_ms if not chunk_times else (chunk_times[0] - start_ts) * 1000.0,
        )

        events.request.fire(
            request_type="websocket",
            name="stream",
            response_time=total_ms,
            response_length=len(audio_bytes),
            exception=None,
            context={
                "voice_id": voice_id,
                "chunks": chunks,
                "ttfb_ms": ttfb_ms,
                "audio_duration_s": audio_duration_s,
            },
        )

        events.request.fire(
            request_type="websocket",
            name="stream_ttfb",
            response_time=ttfb_ms,
            response_length=len(audio_bytes),
            exception=None,
            context={"voice_id": voice_id},
        )

        # Simulate playback time so users do not start a new request until audio
        # finishes.
        total_duration_s = total_ms / 1000.0
        remaining = max(audio_duration_s - total_duration_s, 0.0)
        if remaining > 0:
            gevent.sleep(remaining)
