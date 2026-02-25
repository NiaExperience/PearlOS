"""Simple async websocket client for exercising the Chorus TTS streaming server.

Usage:
    uv run python scripts/ws_e2e_client.py \
        --url ws://127.0.0.1:8000/v1/text-to-speech/af_alloy/stream-input \
        --api-key test-key \
        --text "Hello from Chorus TTS streaming test" \
        --wav out.wav

Ensure the server is running with matching `KOKORO_MODEL_PATH`, `KOKORO_VOICES_PATH`,
and API key configuration before invoking this script.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import websockets
from chorus_tts.logging_config import configure_logging
from structlog.stdlib import BoundLogger, get_logger

try:
    import sounddevice as sd  # type: ignore
except (ImportError, OSError):  # pragma: no cover - optional dependency
    sd = None

try:
    import spacy
except ImportError:  # pragma: no cover - optional dependency
    spacy = None  # type: ignore[assignment]

if spacy is not None:
    _NLP_SENTENCE = spacy.blank("en")
    _NLP_SENTENCE.add_pipe("sentencizer")

    _NLP_COMMA = spacy.blank("en")
    sentencizer = _NLP_COMMA.add_pipe("sentencizer")
    sentencizer.punct_chars |= {","}
else:  # pragma: no cover - optional dependency
    _NLP_SENTENCE = None
    _NLP_COMMA = None


def _start_playback_stream():
    if sd is None:
        return None
    stream = sd.OutputStream(samplerate=22050, channels=1, dtype="int16")
    stream.start()
    return stream


async def _receive_connected(ws) -> dict[str, Any]:
    connected = json.loads(await ws.recv())
    if connected.get("event") != "connected":
        message = f"Unexpected first event: {connected}"
        raise RuntimeError(message)
    return connected


async def _send_initial_payloads(ws, init_text: str, sentences: list[str]) -> None:
    await ws.send(json.dumps({"text": init_text}))
    for sentence in sentences:
        payload = {"text": sentence + " ", "flush": True}
        await ws.send(json.dumps(payload))
    await ws.send(json.dumps({"text": ""}))


async def _collect_stream(
    ws,
    *,
    timeout: float,
    playback_stream,
    logger: BoundLogger,
) -> tuple[float, float, dict[str, Any]]:
    audio_buffer = bytearray()
    chunk_count = 0
    chunk_timestamps: list[float] = []
    final_payload: dict[str, Any] | None = None

    t_start = time.perf_counter()

    while True:
        message = await asyncio.wait_for(ws.recv(), timeout=timeout)
        data = json.loads(message)
        event = data.get("event")
        if event == "audioOutput":
            now = time.perf_counter()
            chunk_timestamps.append(now)

            decoded = base64.b64decode(data["audio"])
            audio_buffer.extend(decoded)
            chunk_count += 1
            if playback_stream is not None:
                playback_stream.write(np.frombuffer(decoded, dtype="<i2"))
        elif event == "finalOutput":
            final_payload = data
            break
        elif event == "error":
            message = f"Server error: {data}"
            raise RuntimeError(message)
        else:
            logger.debug("unexpected_event", event=data)

    end_time = time.perf_counter()

    return (
        t_start,
        end_time,
        {
            "audio_bytes": bytes(audio_buffer),
            "final": final_payload,
            "chunk_count": chunk_count,
            "chunk_timestamps": chunk_timestamps,
        },
    )


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments for the websocket client."""
    parser = argparse.ArgumentParser(description="Kokoro websocket streaming client")
    parser.add_argument(
        "--url",
        default="ws://127.0.0.1:8000/v1/text-to-speech/af_alloy/stream-input",
        help="Websocket endpoint including voice id",
    )
    parser.add_argument(
        "--api-key",
        required=True,
        help="API key passed via xi-api-key header",
    )
    parser.add_argument(
        "--text",
        default="Hello from Kokoro!",
        help="Text to synthesize (a trailing space will be appended automatically)",
    )
    parser.add_argument(
        "--voice-init",
        default=" ",
        help="Initial message sent after connect (default: single blank space)",
    )
    parser.add_argument(
        "--wav",
        type=Path,
        help="Optional path to write the received PCM audio as a WAV file",
    )
    parser.add_argument(
        "--playback",
        action="store_true",
        help="Play the streamed audio through local speakers",
    )
    parser.add_argument(
        "--metrics",
        action="store_true",
        help="Print latency stats (TTFB, chunk gaps)",
    )
    parser.add_argument(
        "--chunk-mode",
        choices=["sentence", "comma"],
        default="sentence",
        help="Strategy for splitting text into chunks before streaming",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="Maximum seconds to wait for streaming to complete",
    )
    return parser.parse_args()


def _split_text(text: str, mode: str) -> list[str]:
    stripped = text.strip()
    if not stripped:
        return []
    if mode == "comma":
        if _NLP_COMMA is not None:
            doc = _NLP_COMMA(stripped)
            parts = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
            return parts or [stripped]
        parts = [part.strip() for part in stripped.replace("\n", " ").split(",")]
        return [part for part in parts if part]
    if _NLP_SENTENCE is None:
        return [stripped]
    doc = _NLP_SENTENCE(stripped)
    sentences = [sent.text.strip() for sent in doc.sents if sent.text.strip()]
    return sentences or [stripped]


async def stream_text(
    url: str,
    api_key: str,
    init_text: str,
    text: str,
    timeout: float,
    *,
    playback: bool,
    metrics: bool,
    chunk_mode: str,
    logger: BoundLogger | None = None,
) -> dict[str, Any]:
    """Stream text over websocket and collect playback metrics."""
    sentences = _split_text(text, chunk_mode)
    if not sentences:
        message = "No text provided after sentence splitting"
        raise ValueError(message)

    if playback and sd is None:
        message = "Playback requested but sounddevice is not installed"
        raise RuntimeError(message)

    playback_stream = _start_playback_stream() if playback and sd is not None else None

    log = logger or get_logger("ws_e2e_client")

    async with websockets.connect(
        url,
        additional_headers={"xi-api-key": api_key},
    ) as ws:
        connected = await _receive_connected(ws)
        await _send_initial_payloads(ws, init_text, sentences)
        t_start, end_time, result = await _collect_stream(
            ws,
            timeout=timeout,
            playback_stream=playback_stream,
            logger=log,
        )

    if playback_stream is not None:
        playback_stream.stop()
        playback_stream.close()

    if result["final"] is None:
        message = "Stream closed without finalOutput event"
        raise RuntimeError(message)

    result.update(
        {
            "connected": connected,
            "sentences": sentences,
            "start_timestamp": t_start,
            "end_timestamp": end_time,
        },
    )
    if not metrics:
        result["chunk_timestamps"] = []
    return result


def save_wav(path: Path, pcm: bytes, sample_rate: int) -> None:
    """Serialize PCM audio to a WAV file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)


def main() -> None:
    """Entry point for the websocket streaming CLI."""
    args = parse_args()

    configure_logging("INFO")
    logger = get_logger("ws_e2e_client")

    try:
        result = asyncio.run(
            stream_text(
                url=args.url,
                api_key=args.api_key,
                init_text=args.voice_init,
                text=args.text,
                timeout=args.timeout,
                playback=args.playback,
                metrics=args.metrics,
                chunk_mode=args.chunk_mode,
            ),
        )
    except Exception as exc:  # pragma: no cover - manual script
        logger.exception("streaming_failed")
        raise SystemExit(1) from exc

    audio = result["audio_bytes"]
    final = result["final"]
    connected = result["connected"]

    samples = np.frombuffer(audio, dtype="<i2")
    if args.metrics or args.wav or samples.size:
        stats = {
            "connected": connected,
            "final": final,
            "bytes": len(audio),
            "samples": len(samples),
        }
        if samples.size:
            stats["amplitude_stats"] = {
                "min": int(samples.min()),
                "max": int(samples.max()),
                "mean": float(samples.mean()),
            }
        logger.info("stream_result", result=stats)

    if args.metrics:
        chunk_times = result.get("chunk_timestamps", [])
        start_ts = result.get("start_timestamp")
        end_ts = result.get("end_timestamp")
        sentence_count = len(result.get("sentences", []))
        metrics_payload = {
            "chunks": result.get("chunk_count", 0),
            "sentences": sentence_count,
        }
        if sentence_count > 1:
            metrics_payload["sentence_breakdown"] = result.get("sentences", [])

        if chunk_times and start_ts is not None:
            metrics_payload["ttfb_ms"] = (chunk_times[0] - start_ts) * 1000
        if start_ts is not None and end_ts is not None:
            metrics_payload["total_duration_ms"] = (end_ts - start_ts) * 1000

        if len(chunk_times) > 1:
            gaps_ms = [
                (chunk_times[i] - chunk_times[i - 1]) * 1000
                for i in range(1, len(chunk_times))
            ]
            metrics_payload["inter_chunk_ms"] = {
                "min": min(gaps_ms),
                "max": max(gaps_ms),
                "avg": sum(gaps_ms) / len(gaps_ms),
            }

        logger.info("stream_metrics", metrics=metrics_payload)

    if args.wav:
        save_wav(args.wav, audio, sample_rate=22050)
        logger.info("saved_wav", path=str(args.wav))


if __name__ == "__main__":
    main()
