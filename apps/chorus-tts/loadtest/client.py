# SPDX-License-Identifier: MIT
"""Synchronous websocket client helpers for load testing."""

from __future__ import annotations

import base64
import json
import time
from typing import Any

from websockets.sync.client import connect

try:
    from scripts.ws_e2e_client import _split_text
except ImportError as exc:  # pragma: no cover - load testing runtime dependency
    message = "scripts.ws_e2e_client must be importable for load testing."
    raise RuntimeError(message) from exc


def stream_text_sync(
    *,
    url: str,
    api_key: str,
    init_text: str,
    text: str,
    timeout: float,
    chunk_mode: str,
) -> dict[str, Any]:
    """Execute a synchronous websocket streaming session and collect metrics."""
    sentences = _split_text(text, chunk_mode)
    if not sentences:
        message = "Prompt resulted in no text after chunking."
        raise ValueError(message)

    headers = {"xi-api-key": api_key}
    with connect(
        url,
        additional_headers=headers,
        open_timeout=timeout,
        close_timeout=timeout,
    ) as ws:
        connected = _perform_handshake(ws, timeout)
        start_ts, final_payload, audio_buffer, chunk_timestamps, sample_rate = (
            _stream_payloads(ws, sentences, init_text, timeout)
        )

    end_ts = time.perf_counter()

    if final_payload is None:
        message = "Stream closed without finalOutput event."
        raise RuntimeError(message)

    chunk_count = len(chunk_timestamps)
    ttfb = (
        (chunk_timestamps[0] - start_ts) * 1000.0
        if chunk_timestamps
        else (end_ts - start_ts) * 1000.0
    )
    if sample_rate is None:
        sample_rate = (
            int(final_payload.get("sample_rate", 22050)) if final_payload else 22050
        )
    audio_duration = len(audio_buffer) / 2 / float(sample_rate) if sample_rate else 0.0
    final_duration_ms = final_payload.get("duration_ms") if final_payload else None
    if final_duration_ms and final_duration_ms > 0:
        # Trust server-reported duration if available
        audio_duration = final_duration_ms / 1000.0

    return {
        "connected": connected,
        "final": final_payload,
        "audio_bytes": bytes(audio_buffer),
        "chunk_count": chunk_count,
        "chunk_timestamps": chunk_timestamps,
        "start_timestamp": start_ts,
        "end_timestamp": end_ts,
        "ttfb_ms": ttfb,
        "sample_rate": sample_rate,
        "audio_duration_s": audio_duration,
    }


def _perform_handshake(ws, timeout: float) -> dict[str, Any]:
    raw = ws.recv(timeout=timeout)
    connected = json.loads(raw)
    if connected.get("event") != "connected":
        message = f"Unexpected first event: {connected}"
        raise RuntimeError(message)
    return connected


def _stream_payloads(
    ws,
    sentences: list[str],
    init_text: str,
    timeout: float,
) -> tuple[
    float,
    dict[str, Any] | None,
    bytearray,
    list[float],
    int | None,
]:
    ws.send(json.dumps({"text": init_text}))
    for sentence in sentences:
        ws.send(json.dumps({"text": sentence + " ", "flush": True}))
    ws.send(json.dumps({"text": ""}))

    start_ts = time.perf_counter()
    audio_buffer = bytearray()
    chunk_timestamps: list[float] = []
    sample_rate: int | None = None
    final_payload: dict[str, Any] | None = None

    while True:
        message = ws.recv(timeout=timeout)
        data = json.loads(message)
        event = data.get("event")
        if event == "audioOutput":
            chunk_timestamps.append(time.perf_counter())
            decoded = base64.b64decode(data["audio"])
            audio_buffer.extend(decoded)
            sample_rate = data.get("sample_rate", sample_rate)
        elif event == "finalOutput":
            final_payload = data
            break
        elif event == "error":
            message = f"Server error: {data}"
            raise RuntimeError(message)

    return start_ts, final_payload, audio_buffer, chunk_timestamps, sample_rate
