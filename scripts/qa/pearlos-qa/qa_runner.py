#!/usr/bin/env python3
"""
PearlOS Voice QA Harness — Core Test Runner

Automates PearlOS voice session testing by:
1. Opening PearlOS in headless Chrome via Playwright
2. Starting a voice session via the UI
3. Generating TTS audio via PocketTTS (Azelma)
4. Joining the Daily voice room as a synthetic participant to stream audio
5. Taking screenshots after each test utterance

Usage:
    python3 qa_runner.py [--headed] [--base-url URL] [--tts-url URL] [--gateway-url URL]
"""

import argparse
import asyncio
import io
import json
import logging
import os
import struct
import sys
import time
import wave
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("qa_runner")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PEARLOS_URL = "http://localhost:3000/pearlos"
TTS_URL = "http://localhost:8766/v1/audio/speech"
GATEWAY_URL = "http://localhost:4444"
RESULTS_DIR = Path("/tmp/qa-results")

# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class TestCase:
    name: str
    utterance: Optional[str]  # None = no audio, just an action
    wait_seconds: float
    action: Optional[str] = None  # "start_session", "close_session", or None
    description: str = ""

@dataclass
class TestResult:
    name: str
    description: str
    screenshot_path: str
    timestamp: str
    passed: Optional[bool] = None  # None = manual review needed
    notes: str = ""

TEST_CASES = [
    TestCase(
        name="01_start_session",
        utterance=None,
        wait_seconds=5,
        action="start_session",
        description="Start voice session — verify Pearl avatar animates",
    ),
    TestCase(
        name="02_weather",
        utterance="What's the weather?",
        wait_seconds=8,
        description="Expect weather card visible",
    ),
    TestCase(
        name="03_news",
        utterance="Show me the news",
        wait_seconds=8,
        description="Expect news cards",
    ),
    TestCase(
        name="04_science_fact",
        utterance="Tell me a science fact",
        wait_seconds=8,
        description="Expect Wonder Canvas with fact card",
    ),
    TestCase(
        name="05_galaxy",
        utterance="Show me the galaxy",
        wait_seconds=8,
        description="Expect galaxy template",
    ),
    TestCase(
        name="06_create_note",
        utterance="Create a note",
        wait_seconds=5,
        description="Expect notes app opens",
    ),
    TestCase(
        name="07_play_music",
        utterance="Play some music",
        wait_seconds=5,
        description="Expect music controls",
    ),
    TestCase(
        name="08_close_session",
        utterance=None,
        wait_seconds=3,
        action="close_session",
        description="Close/dismiss — verify canvas clears, no white box",
    ),
]

# ---------------------------------------------------------------------------
# TTS helper
# ---------------------------------------------------------------------------

def generate_tts_audio(text: str, tts_url: str = TTS_URL) -> bytes:
    """Generate WAV audio from text via PocketTTS (Azelma)."""
    log.info(f"Generating TTS for: {text!r}")
    resp = requests.post(
        tts_url,
        json={"input": text, "voice": "azelma"},
        timeout=30,
    )
    resp.raise_for_status()
    log.info(f"TTS audio received: {len(resp.content)} bytes")
    return resp.content


def parse_wav(wav_bytes: bytes):
    """Parse WAV bytes and return (sample_rate, num_channels, sample_width, frames)."""
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as wf:
        sample_rate = wf.getframerate()
        num_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        frames = wf.readframes(wf.getnframes())
    return sample_rate, num_channels, sample_width, frames

# ---------------------------------------------------------------------------
# Daily room join + audio streaming
# ---------------------------------------------------------------------------

async def stream_audio_to_daily(room_url: str, token: str, wav_bytes: bytes):
    """
    Join a Daily room as a synthetic participant and stream WAV audio.
    Uses daily-python SDK.
    """
    try:
        import daily
    except ImportError:
        log.error("daily-python not installed. Run: pip install daily-python")
        raise

    sample_rate, num_channels, sample_width, frames = parse_wav(wav_bytes)
    log.info(
        f"WAV: {sample_rate}Hz, {num_channels}ch, {sample_width}B/sample, "
        f"{len(frames)} bytes of PCM"
    )

    # daily-python requires initialization
    daily.Daily.init()

    client = daily.CallClient()

    joined = asyncio.Event()
    left = asyncio.Event()

    class EventHandler(daily.EventHandler):
        def on_joined(self, data, error):
            if error:
                log.error(f"Daily join error: {error}")
            else:
                log.info("Joined Daily room as synthetic participant")
            joined.set()

        def on_left(self, error):
            left.set()

    handler = EventHandler()
    client.set_event_handler(handler)

    # Join with microphone enabled
    client.join(
        room_url,
        client_settings=daily.CallClientSettings(
            inputs=daily.CallClientInputs(
                microphone=daily.DeviceSettings(
                    is_enabled=True,
                )
            )
        ),
        completion=handler.on_joined,
    )

    # Wait for join
    await asyncio.wait_for(joined.wait(), timeout=15)

    # Stream audio frames via the microphone
    # daily-python expects 16-bit PCM at the configured sample rate
    # We'll use the virtual microphone device to send audio
    mic = daily.VirtualMicrophoneDevice(
        sample_rate=sample_rate,
        channels=num_channels,
        non_blocking=True,
    )
    client.update_inputs(
        daily.CallClientInputs(
            microphone=daily.CustomDeviceSettings(
                device=mic,
                is_enabled=True,
            )
        )
    )

    # Send audio in chunks (~20ms frames)
    chunk_samples = sample_rate // 50  # 20ms
    bytes_per_sample = sample_width * num_channels
    chunk_bytes = chunk_samples * bytes_per_sample

    offset = 0
    while offset < len(frames):
        chunk = frames[offset : offset + chunk_bytes]
        # Pad last chunk if needed
        if len(chunk) < chunk_bytes:
            chunk += b"\x00" * (chunk_bytes - len(chunk))
        mic.write_frames(chunk)
        offset += chunk_bytes
        await asyncio.sleep(0.018)  # ~20ms pacing

    # Brief pause to let audio finish transmitting
    await asyncio.sleep(0.5)

    # Leave
    client.leave()
    await asyncio.wait_for(left.wait(), timeout=5)
    log.info("Left Daily room")


async def try_stream_audio(room_url: str, token: str, wav_bytes: bytes):
    """Attempt to stream audio; log but don't fail if daily-python isn't available."""
    try:
        await stream_audio_to_daily(room_url, token, wav_bytes)
    except ImportError:
        log.warning("daily-python not available — skipping audio streaming")
    except Exception as e:
        log.warning(f"Audio streaming failed (non-fatal): {e}")

# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------

async def take_screenshot(page, name: str, results_dir: Path) -> str:
    """Take a full-page screenshot and return the file path."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_{name}.png"
    filepath = results_dir / filename
    await page.screenshot(path=str(filepath), full_page=True)
    log.info(f"Screenshot saved: {filepath}")
    return str(filepath)


async def start_voice_session(page):
    """Click the microphone/chat button to start a voice session."""
    log.info("Starting voice session...")
    # Look for the mic/chat button — try several selectors
    selectors = [
        'button[aria-label*="microphone" i]',
        'button[aria-label*="voice" i]',
        'button[aria-label*="chat" i]',
        'button[aria-label*="mic" i]',
        '[data-testid="voice-button"]',
        '[data-testid="mic-button"]',
        '.mic-button',
        '.voice-button',
        '.chat-button',
        # Generic: look for a button with a mic icon
        'button:has(svg)',
    ]
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1000):
                await el.click()
                log.info(f"Clicked voice session button via: {sel}")
                return
        except Exception:
            continue

    # Fallback: try clicking the bottom-center area where the mic usually is
    log.warning("Could not find voice button by selector — trying viewport click")
    vp = page.viewport_size
    if vp:
        await page.mouse.click(vp["width"] // 2, vp["height"] - 60)
    else:
        await page.mouse.click(640, 700)


async def close_voice_session(page):
    """Close/dismiss the voice session."""
    log.info("Closing voice session...")
    selectors = [
        'button[aria-label*="close" i]',
        'button[aria-label*="end" i]',
        'button[aria-label*="hang" i]',
        'button[aria-label*="dismiss" i]',
        '[data-testid="close-button"]',
        '.close-button',
        '.end-call-button',
    ]
    for sel in selectors:
        try:
            el = page.locator(sel).first
            if await el.is_visible(timeout=1000):
                await el.click()
                log.info(f"Clicked close button via: {sel}")
                return
        except Exception:
            continue

    # Fallback: press Escape
    log.warning("Could not find close button — pressing Escape")
    await page.keyboard.press("Escape")


def get_daily_room_info(gateway_url: str = GATEWAY_URL) -> Optional[dict]:
    """
    Try to get Daily room URL and token from the bot gateway.
    Returns {"url": ..., "token": ...} or None.
    """
    try:
        resp = requests.get(f"{gateway_url}/api/daily/room", timeout=5)
        if resp.ok:
            return resp.json()
    except Exception:
        pass

    # Try alternative endpoint
    try:
        resp = requests.get(f"{gateway_url}/api/session", timeout=5)
        if resp.ok:
            data = resp.json()
            if "room_url" in data:
                return {"url": data["room_url"], "token": data.get("token", "")}
    except Exception:
        pass

    return None

# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------

async def run_tests(
    headed: bool = False,
    base_url: str = PEARLOS_URL,
    tts_url: str = TTS_URL,
    gateway_url: str = GATEWAY_URL,
):
    from playwright.async_api import async_playwright

    results_dir = RESULTS_DIR / datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    results_dir.mkdir(parents=True, exist_ok=True)
    log.info(f"Results directory: {results_dir}")

    results: list[TestResult] = []

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=not headed,
            args=[
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--allow-file-access-from-files",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-web-security",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            permissions=["microphone", "camera"],
            ignore_https_errors=True,
        )
        page = await context.new_page()

        # Navigate to PearlOS
        log.info(f"Navigating to {base_url}")
        try:
            await page.goto(base_url, wait_until="networkidle", timeout=30000)
        except Exception as e:
            log.warning(f"Navigation timeout (continuing): {e}")
            await page.goto(base_url, wait_until="domcontentloaded", timeout=15000)

        await asyncio.sleep(3)  # Let UI settle

        # Take baseline screenshot
        baseline_path = await take_screenshot(page, "00_baseline", results_dir)
        results.append(TestResult(
            name="00_baseline",
            description="PearlOS loaded — baseline state",
            screenshot_path=baseline_path,
            timestamp=datetime.now(timezone.utc).isoformat(),
            notes="Baseline before any interaction",
        ))

        # Run each test case
        for tc in TEST_CASES:
            log.info(f"\n{'='*60}")
            log.info(f"TEST: {tc.name} — {tc.description}")
            log.info(f"{'='*60}")

            try:
                # Handle actions
                if tc.action == "start_session":
                    await start_voice_session(page)
                elif tc.action == "close_session":
                    await close_voice_session(page)

                # Handle utterance (TTS + Daily streaming)
                if tc.utterance:
                    try:
                        wav_bytes = generate_tts_audio(tc.utterance, tts_url)

                        # Try to get Daily room info and stream audio
                        room_info = get_daily_room_info(gateway_url)
                        if room_info:
                            await try_stream_audio(
                                room_info["url"],
                                room_info.get("token", ""),
                                wav_bytes,
                            )
                        else:
                            log.warning(
                                "No Daily room info available — "
                                "TTS audio generated but not streamed. "
                                "The test will still screenshot the UI state."
                            )
                    except Exception as e:
                        log.warning(f"TTS/audio error (non-fatal): {e}")

                # Wait for response
                log.info(f"Waiting {tc.wait_seconds}s for response...")
                await asyncio.sleep(tc.wait_seconds)

                # Screenshot
                ss_path = await take_screenshot(page, tc.name, results_dir)

                results.append(TestResult(
                    name=tc.name,
                    description=tc.description,
                    screenshot_path=ss_path,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    notes="Screenshot captured — manual review needed",
                ))
                log.info(f"✓ {tc.name} completed")

            except Exception as e:
                log.error(f"✗ {tc.name} failed: {e}")
                # Try to screenshot even on failure
                try:
                    ss_path = await take_screenshot(
                        page, f"{tc.name}_ERROR", results_dir
                    )
                except Exception:
                    ss_path = ""

                results.append(TestResult(
                    name=tc.name,
                    description=tc.description,
                    screenshot_path=ss_path,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    passed=False,
                    notes=f"Error: {e}",
                ))

        await browser.close()

    # Write results.json
    results_json = results_dir / "results.json"
    results_data = {
        "run_timestamp": datetime.now(timezone.utc).isoformat(),
        "base_url": base_url,
        "tts_url": tts_url,
        "gateway_url": gateway_url,
        "total_tests": len(results),
        "results": [
            {
                "name": r.name,
                "description": r.description,
                "screenshot": r.screenshot_path,
                "timestamp": r.timestamp,
                "passed": r.passed,
                "notes": r.notes,
            }
            for r in results
        ],
    }
    results_json.write_text(json.dumps(results_data, indent=2))
    log.info(f"\nResults written to: {results_json}")
    log.info(f"Screenshots in: {results_dir}")
    log.info(f"Total tests: {len(results)}")

    return results_data


def main():
    parser = argparse.ArgumentParser(description="PearlOS Voice QA Runner")
    parser.add_argument("--headed", action="store_true", help="Run browser in headed mode")
    parser.add_argument("--base-url", default=PEARLOS_URL, help="PearlOS URL")
    parser.add_argument("--tts-url", default=TTS_URL, help="PocketTTS endpoint")
    parser.add_argument("--gateway-url", default=GATEWAY_URL, help="Bot gateway URL")
    args = parser.parse_args()

    asyncio.run(run_tests(
        headed=args.headed,
        base_url=args.base_url,
        tts_url=args.tts_url,
        gateway_url=args.gateway_url,
    ))


if __name__ == "__main__":
    main()
