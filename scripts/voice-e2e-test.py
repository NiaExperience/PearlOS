#!/usr/bin/env python3
"""Standalone end-to-end voice test.

Creates a Daily room, tells the bot gateway to join, then joins as a
simulated participant streaming audio. Checks if the bot responds.
"""

import asyncio
import json
import os
import sys
import time
import wave
from pathlib import Path
from urllib import request, error

DAILY_API_KEY = "4d760bbd7d620bc4d2ac39c911a59d65d3b37544e799afdacf557e84c6912cd0"
DAILY_DOMAIN = "pearlos"
BOT_GATEWAY = "http://localhost:4444"
AUDIO_FILE = "/opt/pearlos/apps/pipecat-daily-bot/bot/tests/integration/resources/hello_how_are_you.wav"

def log(msg):
    ts = time.strftime("%H:%M:%S", time.gmtime())
    print(f"[{ts}] {msg}", flush=True)


def create_daily_room(name: str) -> dict:
    """Create a temporary Daily room."""
    body = json.dumps({
        "name": name,
        "privacy": "public",
        "properties": {
            "exp": int(time.time()) + 600,
            "enable_chat": True,
        },
    }).encode()
    req = request.Request(
        "https://api.daily.co/v1/rooms",
        data=body,
        headers={
            "Authorization": f"Bearer {DAILY_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    with request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read())
    log(f"Room created: {result.get('url', '')} privacy={result.get('privacy', '')}")
    return result


def create_meeting_token(room_name: str, owner: bool = False) -> str:
    """Create a meeting token for a room."""
    body = json.dumps({
        "properties": {
            "room_name": room_name,
            "is_owner": owner,
            "exp": int(time.time()) + 600,
        }
    }).encode()
    req = request.Request(
        "https://api.daily.co/v1/meeting-tokens",
        data=body,
        headers={
            "Authorization": f"Bearer {DAILY_API_KEY}",
            "Content-Type": "application/json",
        },
    )
    with request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())["token"]


def tell_bot_to_join(room_url: str) -> dict:
    """Tell the bot gateway to start a session in this room."""
    body = json.dumps({
        "room_url": room_url,
        "persona": "Pearl",
        "personality_id": "pearl",
    }).encode()
    req = request.Request(
        f"{BOT_GATEWAY}/api/voice/start",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except error.HTTPError as e:
        body_text = e.read().decode()
        log(f"Bot gateway error {e.code}: {body_text[:200]}")
        return {"error": body_text}


def load_wav(path: str) -> tuple:
    """Load WAV file and return (pcm_bytes, sample_rate, channels)."""
    with wave.open(path, "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels()


async def run_e2e_test():
    from daily import Daily, CallClient, CustomAudioSource, CustomAudioTrack, EventHandler
    Daily.init()

    # Create room first, then tell bot to join it
    room_name = f"voice-e2e-{int(time.time()) % 100000}"
    log(f"Creating Daily room: {room_name}")
    room = create_daily_room(room_name)
    room_url = room.get("url", f"https://{DAILY_DOMAIN}.daily.co/{room_name}")
    log(f"Room: {room_url}")

    # Create participant token
    user_token = create_meeting_token(room_name, owner=False)
    log("User token created")

    # Tell bot to join
    log("Starting bot in room...")
    body = json.dumps({"room_url": room_url}).encode()
    req = request.Request(f"{BOT_GATEWAY}/start", data=body,
                          headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=15) as resp:
        result = json.loads(resp.read())
    log(f"Bot start result: {json.dumps(result)[:200]}")

    # Wait for bot to join
    log("Waiting 8s for bot to join and initialize...")
    await asyncio.sleep(8)

    # Load audio
    pcm, sr, ch = load_wav(AUDIO_FILE)
    log(f"Audio loaded: {len(pcm)} bytes, {sr}Hz, {ch}ch, {len(pcm)/(sr*ch*2):.1f}s")

    # Join as participant
    class Handler(EventHandler):
        def __init__(self):
            self.joined = asyncio.Event()
            self.left = asyncio.Event()
            self.transcriptions = []
            self.errors = []
            self.participants_joined = []
            self.participants_left = []
            self._loop = asyncio.get_event_loop()

        def on_joined(self, data):
            log(f"Participant joined room")
            self._loop.call_soon_threadsafe(self.joined.set)

        def on_left(self):
            self._loop.call_soon_threadsafe(self.left.set)

        def on_participant_joined(self, participant):
            name = participant.get("info", {}).get("userName", "unknown")
            log(f"  Participant joined: {name}")
            self.participants_joined.append(participant)

        def on_participant_left(self, participant, reason):
            name = participant.get("info", {}).get("userName", "unknown")
            log(f"  Participant left: {name} ({reason})")
            self.participants_left.append(participant)

        def on_transcription_message(self, message):
            text = message.get("text", "")
            participant = message.get("participantId", "?")
            log(f"  TRANSCRIPTION [{participant}]: {text}")
            self.transcriptions.append(message)

        def on_app_message(self, message, sender):
            log(f"  APP MSG from {sender}: {json.dumps(message)[:200]}")

        def on_error(self, error_msg):
            log(f"  ERROR: {error_msg}")
            self.errors.append(error_msg)

    handler = Handler()
    client = CallClient(event_handler=handler)
    audio_source = CustomAudioSource(sr, ch)
    audio_track = CustomAudioTrack(audio_source)

    log("Joining as user participant...")
    client.set_user_name("E2E Test User")
    loop = asyncio.get_event_loop()

    def _join_completion(data, error_msg):
        if error_msg is None:
            loop.call_soon_threadsafe(handler.on_joined, data or {})
        else:
            log(f"Join completion error: {error_msg}")
            loop.call_soon_threadsafe(handler.errors.append, error_msg)
            loop.call_soon_threadsafe(handler.joined.set)

    client.join(
        room_url,
        user_token,
        client_settings={
            "inputs": {
                "camera": {"isEnabled": False},
                "microphone": {
                    "isEnabled": True,
                    "settings": {"customTrack": {"id": audio_track.id}},
                },
            },
            "publishing": {
                "microphone": {
                    "sendSettings": {"channelConfig": "mono", "bitrate": 64000},
                },
            },
        },
        completion=_join_completion,
    )

    try:
        await asyncio.wait_for(handler.joined.wait(), timeout=15)
    except asyncio.TimeoutError:
        log("FAILED: Could not join room within 15s")
        client.leave()
        return False

    client.add_custom_audio_track("e2e-mic", audio_track)

    # Wait for bot greeting
    log("Waiting 5s for bot greeting...")
    await asyncio.sleep(5)

    # Stream the audio
    log("Streaming user audio into room...")
    frame_ms = 20
    frame_bytes = int(sr * frame_ms / 1000) * ch * 2
    for start in range(0, len(pcm), frame_bytes):
        chunk = pcm[start:start + frame_bytes]
        if len(chunk) < frame_bytes:
            chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
        audio_source.write_frames(chunk)
        await asyncio.sleep(frame_ms / 1000)

    # Stream silence
    silence = b"\x00" * frame_bytes
    for _ in range(60):  # 1.2s silence
        audio_source.write_frames(silence)
        await asyncio.sleep(frame_ms / 1000)

    log("Audio streaming complete. Waiting 15s for bot response...")
    await asyncio.sleep(15)

    # Report
    log("=" * 50)
    log("E2E TEST RESULTS")
    log("=" * 50)
    log(f"Participants seen joining: {len(handler.participants_joined)}")
    log(f"Transcriptions received: {len(handler.transcriptions)}")
    for t in handler.transcriptions:
        log(f"  [{t.get('participantId', '?')}] {t.get('text', '')}")
    log(f"Errors: {len(handler.errors)}")
    for e in handler.errors:
        log(f"  {e}")

    success = len(handler.transcriptions) > 0
    if success:
        log("PASS: Bot received and processed audio")
    else:
        log("FAIL: No transcriptions received - audio input not working")

    # Clean up
    log("Leaving room...")
    client.leave()
    await asyncio.sleep(2)

    # Delete room
    try:
        req = request.Request(
            f"https://api.daily.co/v1/rooms/{room_name}",
            method="DELETE",
            headers={"Authorization": f"Bearer {DAILY_API_KEY}"},
        )
        request.urlopen(req, timeout=10)
        log(f"Room {room_name} deleted")
    except Exception:
        pass

    return success


if __name__ == "__main__":
    os.environ.setdefault("PULSE_SERVER", "/tmp/pulse-stable/native")
    result = asyncio.run(run_e2e_test())
    sys.exit(0 if result else 1)
