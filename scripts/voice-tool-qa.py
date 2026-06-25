#!/usr/bin/env python3
"""Comprehensive end-to-end voice QA test.

Tests BOTH voice conversation AND tool execution, verifying results
on backend (transcription, LLM response) and frontend (app_message
delivery of tool events).

Stages:
  1. Create Daily room via API
  2. Start bot via gateway /start
  3. Join as simulated participant (Daily SDK)
  4. Wait for bot greeting (confirms TTS pipeline)
  5. Generate + stream "open my notes" audio (via PocketTTS)
  6. Verify: user transcription, bot response, tool app_message
  7. Generate + stream "what time is it" audio
  8. Verify: data-tool result in bot response
  9. Report pass/fail per stage with timestamps
"""

import asyncio
import io
import json
import os
import struct
import sys
import time
import wave
from pathlib import Path
from urllib import request, error

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DAILY_API_KEY = "4d760bbd7d620bc4d2ac39c911a59d65d3b37544e799afdacf557e84c6912cd0"
DAILY_DOMAIN = "pearlos"
BOT_GATEWAY = "http://localhost:4444"
TTS_ENDPOINT = "http://localhost:8766/tts"
FALLBACK_AUDIO = "/opt/pearlos/apps/pipecat-daily-bot/bot/tests/integration/resources/hello_how_are_you.wav"

# Timeouts (seconds)
BOT_JOIN_WAIT = 10
GREETING_WAIT = 12
POST_AUDIO_WAIT = 20
CLEANUP_WAIT = 2

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_t0 = time.time()


def log(msg: str):
    elapsed = time.time() - _t0
    ts = time.strftime("%H:%M:%S", time.gmtime())
    print(f"[{ts} +{elapsed:6.1f}s] {msg}", flush=True)


def create_daily_room(name: str) -> dict:
    body = json.dumps({
        "name": name,
        "privacy": "public",
        "properties": {
            "exp": int(time.time()) + 900,
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
    with request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def delete_daily_room(name: str):
    try:
        req = request.Request(
            f"https://api.daily.co/v1/rooms/{name}",
            method="DELETE",
            headers={"Authorization": f"Bearer {DAILY_API_KEY}"},
        )
        request.urlopen(req, timeout=10)
        log(f"Room {name} deleted")
    except Exception as exc:
        log(f"Room cleanup warning: {exc}")


def create_meeting_token(room_name: str) -> str:
    body = json.dumps({
        "properties": {
            "room_name": room_name,
            "is_owner": False,
            "exp": int(time.time()) + 900,
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


def start_bot(room_url: str) -> dict:
    body = json.dumps({"room_url": room_url}).encode()
    req = request.Request(
        f"{BOT_GATEWAY}/start",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except error.HTTPError as exc:
        text = exc.read().decode()[:300]
        log(f"Bot gateway HTTP {exc.code}: {text}")
        return {"error": text}


def generate_tts_wav(text: str) -> bytes:
    """Call PocketTTS and return raw WAV bytes."""
    import urllib.parse
    boundary = "----VoiceQABoundary"
    parts = []
    for field_name, field_val in [("text", text), ("voice", "azelma")]:
        parts.append(
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{field_name}"\r\n\r\n'
            f"{field_val}\r\n"
        )
    parts.append(f"--{boundary}--\r\n")
    payload = "".join(parts).encode()
    req = request.Request(
        TTS_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with request.urlopen(req, timeout=30) as resp:
        return resp.read()


def load_wav_pcm(wav_bytes: bytes) -> tuple:
    """Parse WAV bytes, return (pcm_bytes, sample_rate, channels)."""
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels()


def load_wav_file(path: str) -> tuple:
    with wave.open(path, "rb") as w:
        return w.readframes(w.getnframes()), w.getframerate(), w.getnchannels()


def resample_to_16k_mono(pcm: bytes, src_rate: int, src_ch: int) -> bytes:
    """Crude resample to 16kHz mono (nearest-neighbour). Good enough for test."""
    target_rate = 16000
    # Decode to samples
    sample_width = 2  # 16-bit
    frame_size = src_ch * sample_width
    n_frames = len(pcm) // frame_size
    if src_ch == 1:
        samples = list(struct.unpack(f"<{n_frames}h", pcm[:n_frames * 2]))
    else:
        raw = struct.unpack(f"<{n_frames * src_ch}h", pcm[:n_frames * src_ch * 2])
        samples = [raw[i * src_ch] for i in range(n_frames)]  # take left channel

    # Resample
    ratio = target_rate / src_rate
    out_len = int(n_frames * ratio)
    resampled = []
    for i in range(out_len):
        src_idx = min(int(i / ratio), len(samples) - 1)
        resampled.append(samples[src_idx])
    return struct.pack(f"<{len(resampled)}h", *resampled), target_rate, 1


# ---------------------------------------------------------------------------
# Stage result tracking
# ---------------------------------------------------------------------------
class StageResult:
    def __init__(self):
        self.results = {}

    def record(self, name: str, passed: bool, detail: str = ""):
        ts = time.strftime("%H:%M:%S", time.gmtime())
        elapsed = time.time() - _t0
        self.results[name] = {
            "passed": passed,
            "detail": detail,
            "time": f"{ts} (+{elapsed:.1f}s)",
        }
        status = "PASS" if passed else "FAIL"
        log(f"  [{status}] {name}: {detail}")

    def summary(self) -> bool:
        log("")
        log("=" * 60)
        log("VOICE TOOL QA - FINAL REPORT")
        log("=" * 60)
        all_pass = True
        for name, r in self.results.items():
            tag = "PASS" if r["passed"] else "FAIL"
            all_pass = all_pass and r["passed"]
            log(f"  [{tag}] {name:40s}  {r['time']}  {r['detail']}")
        log("=" * 60)
        log(f"Overall: {'ALL PASSED' if all_pass else 'SOME FAILED'}")
        log("=" * 60)
        return all_pass


# ---------------------------------------------------------------------------
# Main test
# ---------------------------------------------------------------------------
async def run_test():
    from daily import Daily, CallClient, CustomAudioSource, CustomAudioTrack, EventHandler
    Daily.init()

    stages = StageResult()
    room_name = f"vqa-{int(time.time()) % 100000}"

    # ------------------------------------------------------------------
    # Stage 1: Create Daily room
    # ------------------------------------------------------------------
    log("STAGE 1: Creating Daily room...")
    try:
        room = create_daily_room(room_name)
        room_url = room.get("url", f"https://{DAILY_DOMAIN}.daily.co/{room_name}")
        stages.record("1_room_create", True, room_url)
    except Exception as exc:
        stages.record("1_room_create", False, str(exc))
        return stages.summary()

    # ------------------------------------------------------------------
    # Stage 2: Start bot via gateway
    # ------------------------------------------------------------------
    log("STAGE 2: Starting bot...")
    try:
        bot_result = start_bot(room_url)
        has_error = "error" in bot_result and bot_result["error"]
        if has_error:
            stages.record("2_bot_start", False, str(bot_result))
        else:
            stages.record("2_bot_start", True, json.dumps(bot_result)[:120])
    except Exception as exc:
        stages.record("2_bot_start", False, str(exc))
        delete_daily_room(room_name)
        return stages.summary()

    log(f"Waiting {BOT_JOIN_WAIT}s for bot to join and initialize...")
    await asyncio.sleep(BOT_JOIN_WAIT)

    # ------------------------------------------------------------------
    # Stage 3: Join as simulated participant
    # ------------------------------------------------------------------
    log("STAGE 3: Joining room as test participant...")

    class Handler(EventHandler):
        def __init__(self):
            self.joined = asyncio.Event()
            self.bot_joined = asyncio.Event()
            self.transcriptions = []          # all transcription messages
            self.user_transcriptions = []     # transcriptions of OUR audio
            self.bot_transcriptions = []      # transcriptions of bot speech
            self.bot_transcript_app_msgs = [] # bot.transcript delivered via app_message
            self.app_messages = []            # tool / frontend events
            self.errors = []
            self.participant_names = {}
            self._loop = asyncio.get_event_loop()
            self._our_id = None

        def on_joined(self, data):
            local = data.get("participants", {}).get("local", {})
            self._our_id = local.get("id")
            log(f"  Joined room, our id={self._our_id}")
            self._loop.call_soon_threadsafe(self.joined.set)

        def on_left(self):
            log("  Left room")

        def on_participant_joined(self, participant):
            name = participant.get("info", {}).get("userName", "unknown")
            pid = participant.get("id", "?")
            self.participant_names[pid] = name
            log(f"  Participant joined: {name} ({pid})")
            # If it looks like the bot, signal
            if name.lower() not in ("e2e voice qa", ""):
                self._loop.call_soon_threadsafe(self.bot_joined.set)

        def on_participant_left(self, participant, reason):
            name = participant.get("info", {}).get("userName", "unknown")
            log(f"  Participant left: {name} ({reason})")

        def on_transcription_message(self, message):
            text = message.get("text", "")
            pid = message.get("participantId", "?")
            is_final = message.get("is_final", message.get("isFinal", True))
            who = self.participant_names.get(pid, pid)
            log(f"  TRANSCRIPT [{who}] (final={is_final}): {text}")
            self.transcriptions.append(message)
            if pid == self._our_id:
                self.user_transcriptions.append(message)
            else:
                self.bot_transcriptions.append(message)

        def on_app_message(self, message, sender):
            sender_name = self.participant_names.get(sender, sender)
            snippet = json.dumps(message)[:250]
            log(f"  APP_MSG from {sender_name}: {snippet}")
            self.app_messages.append({"message": message, "sender": sender})
            # Track bot.transcript events delivered via app_message
            if isinstance(message, dict) and message.get("event") == "bot.transcript":
                payload = message.get("payload", {})
                if payload.get("isFinal", False):
                    self.bot_transcript_app_msgs.append(payload.get("text", ""))

        def on_error(self, error_msg):
            log(f"  ERROR: {error_msg}")
            self.errors.append(error_msg)

    handler = Handler()
    client = CallClient(event_handler=handler)

    # We will create audio source at 16kHz mono, which is what pipecat expects
    source_rate = 16000
    source_ch = 1
    audio_source = CustomAudioSource(source_rate, source_ch)
    audio_track = CustomAudioTrack(audio_source)

    user_token = create_meeting_token(room_name)

    loop = asyncio.get_event_loop()

    def _join_cb(data, err):
        if err is None:
            loop.call_soon_threadsafe(handler.on_joined, data or {})
        else:
            log(f"  Join error: {err}")
            loop.call_soon_threadsafe(handler.errors.append, str(err))
            loop.call_soon_threadsafe(handler.joined.set)

    client.set_user_name("E2E Voice QA")
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
        completion=_join_cb,
    )

    try:
        await asyncio.wait_for(handler.joined.wait(), timeout=15)
        if handler.errors:
            stages.record("3_join_room", False, str(handler.errors))
            delete_daily_room(room_name)
            return stages.summary()
        stages.record("3_join_room", True, "joined successfully")
    except asyncio.TimeoutError:
        stages.record("3_join_room", False, "join timed out after 15s")
        client.leave()
        delete_daily_room(room_name)
        return stages.summary()

    # ------------------------------------------------------------------
    # Helper: stream PCM into room
    # ------------------------------------------------------------------
    async def stream_audio(pcm: bytes, rate: int, channels: int, label: str):
        """Stream PCM audio at correct pace, resampling to 16kHz mono if needed."""
        if rate != source_rate or channels != source_ch:
            log(f"  Resampling {label} from {rate}Hz/{channels}ch to {source_rate}Hz/mono")
            pcm, rate, channels = resample_to_16k_mono(pcm, rate, channels)

        frame_ms = 20
        frame_bytes = int(rate * frame_ms / 1000) * channels * 2
        total_frames = (len(pcm) + frame_bytes - 1) // frame_bytes
        log(f"  Streaming {label}: {len(pcm)} bytes, {total_frames} frames, ~{len(pcm)/(rate*channels*2):.1f}s")

        for start in range(0, len(pcm), frame_bytes):
            chunk = pcm[start:start + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            audio_source.write_frames(chunk)
            await asyncio.sleep(frame_ms / 1000)

        # Trailing silence so VAD detects end-of-speech
        silence = b"\x00" * frame_bytes
        for _ in range(80):  # 1.6s silence
            audio_source.write_frames(silence)
            await asyncio.sleep(frame_ms / 1000)
        log(f"  Finished streaming {label}")

    # ------------------------------------------------------------------
    # Stage 4: Wait for bot greeting
    # ------------------------------------------------------------------
    log("STAGE 4: Waiting for bot greeting (TTS check)...")
    t_greet_start = time.time()
    # The bot typically sends a greeting transcription or app_message shortly after joining.
    # We check for any bot transcription or audio track appearing.
    await asyncio.sleep(GREETING_WAIT)
    bot_greeted = len(handler.bot_transcriptions) > 0 or len(handler.app_messages) > 0
    if bot_greeted:
        detail_parts = []
        if handler.bot_transcriptions:
            first = handler.bot_transcriptions[0].get("text", "")[:80]
            detail_parts.append(f"transcript: '{first}'")
        if handler.app_messages:
            detail_parts.append(f"{len(handler.app_messages)} app_msg(s)")
        stages.record("4_bot_greeting", True, ", ".join(detail_parts))
    else:
        stages.record("4_bot_greeting", False,
                       "no bot transcription or app_message within window, "
                       "bot may still be working (continuing test)")

    # ------------------------------------------------------------------
    # Stage 5: Generate "open my notes" audio via PocketTTS
    # ------------------------------------------------------------------
    log('STAGE 5: Generating TTS audio for "open my notes"...')
    try:
        wav_bytes = generate_tts_wav("open my notes")
        pcm_notes, sr_notes, ch_notes = load_wav_pcm(wav_bytes)
        stages.record("5_tts_generate_notes", True,
                       f"{len(wav_bytes)} bytes WAV, {sr_notes}Hz, {ch_notes}ch")
    except Exception as exc:
        stages.record("5_tts_generate_notes", False, str(exc))
        # Fallback to hello audio
        log("  Falling back to hello_how_are_you.wav")
        pcm_notes, sr_notes, ch_notes = load_wav_file(FALLBACK_AUDIO)

    # ------------------------------------------------------------------
    # Stage 6: Stream "open my notes" into room
    # ------------------------------------------------------------------
    log('STAGE 6: Streaming "open my notes" audio...')
    pre_transcript_count = len(handler.transcriptions)
    pre_app_msg_count = len(handler.app_messages)
    pre_bot_app_transcript_count = len(handler.bot_transcript_app_msgs)

    await stream_audio(pcm_notes, sr_notes, ch_notes, "open-my-notes")
    stages.record("6_stream_notes_audio", True, "audio streamed")

    # ------------------------------------------------------------------
    # Stage 7: Verify transcription, bot response, and tool events
    # ------------------------------------------------------------------
    log(f"STAGE 7: Waiting {POST_AUDIO_WAIT}s for backend + frontend response...")
    await asyncio.sleep(POST_AUDIO_WAIT)

    # 7a: User transcription (proves STT works)
    new_user_transcripts = handler.user_transcriptions[:]
    has_user_transcript = len(new_user_transcripts) > 0
    if has_user_transcript:
        texts = [t.get("text", "") for t in new_user_transcripts]
        stages.record("7a_user_transcription", True,
                       f"{len(texts)} transcript(s): {'; '.join(texts)[:120]}")
    else:
        stages.record("7a_user_transcription", False,
                       "no user transcription received (STT may not be running)")

    # 7c (computed first so 7b can reference tool_msgs):
    # App messages with tool events (proves tool execution + frontend delivery)
    new_app_msgs = handler.app_messages[pre_app_msg_count:]
    tool_keywords = ["app.open", "note.open", "notes", "open", "tool",
                     "canvas", "action", "function_call", "tool_call"]
    tool_msgs = []
    for am in new_app_msgs:
        msg_str = json.dumps(am.get("message", {})).lower()
        if any(kw in msg_str for kw in tool_keywords):
            tool_msgs.append(am)

    # 7b: Bot transcript response (proves LLM + TTS pipeline)
    # Bot transcripts arrive via app_message with event="bot.transcript".
    # We snapshot counts before streaming, so only count new ones.
    new_bot_transcripts = handler.bot_transcriptions[pre_transcript_count:]
    new_bot_app_transcripts = handler.bot_transcript_app_msgs[pre_bot_app_transcript_count:]
    native_count = len(new_bot_transcripts)
    app_count = len(new_bot_app_transcripts)
    has_bot_verbal = native_count > 0 or app_count > 0
    if has_bot_verbal:
        if app_count > 0:
            last_text = new_bot_app_transcripts[-1][:120]
            stages.record("7b_bot_response", True,
                           f"{app_count} bot.transcript app_msg(s), last: '{last_text}'")
        else:
            last_text = new_bot_transcripts[-1].get("text", "")[:120]
            stages.record("7b_bot_response", True,
                           f"{native_count} native transcript(s), last: '{last_text}'")
    elif tool_msgs:
        # Tool executed without verbal response, that is acceptable
        stages.record("7b_bot_response", True,
                       "no verbal response, but tool executed (silent tool action)")
    else:
        stages.record("7b_bot_response", False,
                       f"no bot response: {native_count} native, {app_count} app transcripts")

    # 7c: Report tool app_message results
    if tool_msgs:
        snippet = json.dumps(tool_msgs[0]["message"])[:150]
        stages.record("7c_tool_app_message", True,
                       f"{len(tool_msgs)} tool-related app_msg(s), first: {snippet}")
    else:
        all_msgs_detail = f"{len(new_app_msgs)} app_msg(s) total"
        if new_app_msgs:
            all_msgs_detail += f", sample: {json.dumps(new_app_msgs[0]['message'])[:120]}"
        stages.record("7c_tool_app_message", False,
                       f"no tool app_messages found. {all_msgs_detail}")

    # ------------------------------------------------------------------
    # Stage 8: Generate + stream "what time is it" audio
    # ------------------------------------------------------------------
    log('STAGE 8: Generating and streaming "what time is it" audio...')
    try:
        wav_time = generate_tts_wav("what time is it")
        pcm_time, sr_time, ch_time = load_wav_pcm(wav_time)
        stages.record("8_tts_generate_time", True,
                       f"{len(wav_time)} bytes WAV, {sr_time}Hz")
    except Exception as exc:
        stages.record("8_tts_generate_time", False, str(exc))
        pcm_time, sr_time, ch_time = load_wav_file(FALLBACK_AUDIO)

    pre_bot_count = len(handler.bot_transcriptions)
    pre_app_count = len(handler.app_messages)
    pre_bot_app_transcript_count = len(handler.bot_transcript_app_msgs)

    await stream_audio(pcm_time, sr_time, ch_time, "what-time-is-it")

    # ------------------------------------------------------------------
    # Stage 9: Check for data-tool result in bot response
    # ------------------------------------------------------------------
    log(f"STAGE 9: Waiting {POST_AUDIO_WAIT}s for time-query response...")
    await asyncio.sleep(POST_AUDIO_WAIT)

    new_bot_after_time = handler.bot_transcriptions[pre_bot_count:]
    new_app_after_time = handler.app_messages[pre_app_count:]
    new_bot_app_transcripts = handler.bot_transcript_app_msgs[pre_bot_app_transcript_count:]

    time_keywords = ["time", "clock", "hour", "minute", "am", "pm",
                     "o'clock", "oclock", "utc", "gmt"]
    found_time_in_transcript = False
    for t in new_bot_after_time:
        text_lower = t.get("text", "").lower()
        if any(kw in text_lower for kw in time_keywords):
            found_time_in_transcript = True
            break

    # Also check bot.transcript app_msgs
    found_time_in_bot_app_transcript = False
    for text in new_bot_app_transcripts:
        if any(kw in text.lower() for kw in time_keywords):
            found_time_in_bot_app_transcript = True
            break

    found_time_in_app = False
    for am in new_app_after_time:
        msg_str = json.dumps(am.get("message", {})).lower()
        if any(kw in msg_str for kw in time_keywords):
            found_time_in_app = True
            break

    if found_time_in_transcript:
        text_snippet = new_bot_after_time[-1].get("text", "")[:100]
        stages.record("9_time_tool_result", True,
                       f"time info in native bot transcript: '{text_snippet}'")
    elif found_time_in_bot_app_transcript:
        stages.record("9_time_tool_result", True,
                       f"time info in bot.transcript app_msg: '{new_bot_app_transcripts[-1][:100]}'")
    elif found_time_in_app:
        stages.record("9_time_tool_result", True,
                       "time info found in app_message")
    elif len(new_bot_after_time) > 0 or len(new_bot_app_transcripts) > 0:
        detail = ""
        if new_bot_after_time:
            detail = f"native: '{new_bot_after_time[-1].get('text', '')[:80]}'"
        if new_bot_app_transcripts:
            detail += f" app: '{new_bot_app_transcripts[-1][:80]}'"
        stages.record("9_time_tool_result", False,
                       f"bot responded but no time keywords. {detail}")
    else:
        stages.record("9_time_tool_result", False,
                       f"no bot response after time query. "
                       f"{len(new_app_after_time)} app_msg(s) received")

    # ------------------------------------------------------------------
    # Stage 10: Summary
    # ------------------------------------------------------------------
    log("STAGE 10: Generating report...")

    # Extra diagnostic dump
    log("")
    log("--- Diagnostic: all transcriptions ---")
    for i, t in enumerate(handler.transcriptions):
        pid = t.get("participantId", "?")
        who = handler.participant_names.get(pid, pid)
        log(f"  [{i}] ({who}): {t.get('text', '')[:120]}")
    log(f"--- Diagnostic: all app_messages ({len(handler.app_messages)}) ---")
    for i, am in enumerate(handler.app_messages):
        log(f"  [{i}] from {am['sender']}: {json.dumps(am['message'])[:200]}")
    log(f"--- Diagnostic: errors ({len(handler.errors)}) ---")
    for e in handler.errors:
        log(f"  {e}")

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    log("Cleaning up...")
    client.leave()
    await asyncio.sleep(CLEANUP_WAIT)
    delete_daily_room(room_name)

    return stages.summary()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    os.environ.setdefault("PULSE_SERVER", "/tmp/pulse-stable/native")
    passed = asyncio.run(run_test())
    sys.exit(0 if passed else 1)
