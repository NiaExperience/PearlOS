"""Live Daily + LLM integration harness.

This harness launches the real Pipecat pipeline, connects to Daily using the
bot runtime, and feeds a synthetic utterance by publishing a short PCM clip via
Daily's CustomAudioSource API. Audio is generated at runtime with Kokoro TTS by
default (falling back to ElevenLabs when Kokoro credentials are absent). The
intent is to exercise the full Daily ⇄ LLM loop instead of mocks.
"""

from __future__ import annotations

import asyncio
import audioop
import contextlib
import json
import math
import os
import pathlib
import struct
import sys
import time
from types import MethodType
import uuid
import wave
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional
from urllib import error, request
from unittest.mock import patch

from pipecat.transports.daily.transport import DailyParams

_BOT_PACKAGE_PARENT = pathlib.Path(__file__).resolve().parents[3]
if str(_BOT_PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(_BOT_PACKAGE_PARENT))

if "bot" in sys.modules and not hasattr(sys.modules["bot"], "__path__"):
    del sys.modules["bot"]

from daily import CallClient, CustomAudioSource, CustomAudioTrack, EventHandler

import bot
from bot.loguru import get_logger

try:
    from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
except ImportError:  # pragma: no cover - ElevenLabs optional in test envs
    ElevenLabsTTSService = None  # type: ignore


AUDIO_FRAME_MS = 20
_DEFAULT_USER_UTTERANCE = "Hello, how are you?"
_DEFAULT_ASSISTANT_WAIT_SECS = 30.0
_PCM_SAMPLE_WIDTH = 2


logger = get_logger(__name__, tag="harness")


@dataclass(slots=True)
class AudioClip:
    """PCM clip ready for streaming via Daily."""

    pcm: bytes
    sample_rate: int
    channels: int = 1

    def iter_frames(self, frame_ms: int = AUDIO_FRAME_MS) -> Iterable[bytes]:
        frame_bytes = int(self.sample_rate * frame_ms / 1000) * self.channels * _PCM_SAMPLE_WIDTH
        if frame_bytes <= 0:
            raise ValueError("frame_bytes must be positive")
        for start in range(0, len(self.pcm), frame_bytes):
            chunk = self.pcm[start : start + frame_bytes]
            if len(chunk) < frame_bytes:
                chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
            yield chunk


@dataclass(slots=True)
class LiveSessionConfig:
    """Runtime configuration for a live integration session."""

    daily_domain: str
    daily_api_key: str
    room_name: str
    persona: str
    personality_id: str
    participant_name: str = "Integration Tester"
    session_user_id: str = "integration-user"
    user_message: str = _DEFAULT_USER_UTTERANCE
    tenant_id: Optional[str] = None
    synthesize_text: Optional[str] = None
    audio_fixture_dir: pathlib.Path = field(
        default_factory=lambda: pathlib.Path(__file__).parent / "resources"
    )
    audio_fixture_name: str = "hello_how_are_you.wav"
    assistant_timeout_secs: float = _DEFAULT_ASSISTANT_WAIT_SECS
    audio_sample_rate: int = 48000
    enable_user_audio: bool = False  # If True, streams audio clip after bot greeting
    expected_tool_call: Optional[str] = None
    min_assistant_messages: int = 1  # Minimum number of messages to wait for from assistant
    wait_for_bot_stopped: bool = True  # Require a bot stop event after last assistant message
    user_data: Optional[Dict[str, Any]] = None  # Custom user data for the participant

    @property
    def room_url(self) -> str:
        return f"https://{self.daily_domain}.daily.co/{self.room_name}"

    @property
    def audio_fixture_path(self) -> pathlib.Path:
        return self.audio_fixture_dir / self.audio_fixture_name

    @classmethod
    def from_env(cls) -> "LiveSessionConfig":
        domain = os.getenv("DAILY_DOMAIN")
        room = os.getenv("DAILY_TEST_ROOM")
        api_key = os.getenv("DAILY_API_KEY")
        persona = os.getenv("PIPECAT_TEST_PERSONA", "Pearl")
        personality_id = os.getenv("PIPECAT_TEST_PERSONALITY_ID", "pearl")
        tenant_id = os.getenv("PIPECAT_TEST_TENANT_ID")
        room_strategy = os.getenv("PIPECAT_UNIQUE_DAILY_ROOMS", "1").lower() not in {
            "0",
            "false",
            "off",
        }
        room_prefix = os.getenv("DAILY_TEST_ROOM_PREFIX", "pipecat-int")
        if room_strategy:
            base = room or room_prefix
            unique_suffix = uuid.uuid4().hex[:10]
            room = f"{base}-{unique_suffix}"

        if not all([domain, room, api_key]):
            missing = [
                name
                for name, value in {
                    "DAILY_DOMAIN": domain,
                    "DAILY_TEST_ROOM": room,
                    "DAILY_API_KEY": api_key,
                }.items()
                if not value
            ]
            raise RuntimeError(f"Missing required Daily configuration: {', '.join(missing)}")
        synthesize_text = os.getenv("PIPECAT_TEST_SYNTH_TEXT")
        assistant_wait = float(
            os.getenv("PIPECAT_ASSISTANT_TIMEOUT_SECS", str(_DEFAULT_ASSISTANT_WAIT_SECS))
        )
        sample_rate = int(os.getenv("PIPECAT_AUDIO_SAMPLE_RATE", "16000"))
        return cls(
            daily_domain=domain,
            daily_api_key=api_key,
            room_name=room,
            persona=persona,
            personality_id=personality_id,
            tenant_id=tenant_id,
            synthesize_text=synthesize_text,
            assistant_timeout_secs=assistant_wait,
            audio_sample_rate=sample_rate,
        )


@dataclass(slots=True)
class SessionArtifacts:
    """Shares pipeline internals captured via instrumentation."""

    ready: asyncio.Event = field(default_factory=asyncio.Event)
    multi_user_aggregator: Any | None = None
    context_aggregator: Any | None = None
    messages_ref: List[Dict[str, Any]] | None = None
    bot_stop_event: asyncio.Event = field(default_factory=asyncio.Event)
    bot_stop_count: int = 0
    last_bot_stop: float | None = None

    def record_bot_stop(self) -> None:
        self.bot_stop_count += 1
        self.last_bot_stop = time.monotonic()
        self.bot_stop_event.set()

    def snapshot_messages(self) -> List[Dict[str, Any]]:
        aggregator = self.multi_user_aggregator
        if aggregator is not None:
            try:
                return aggregator.snapshot_messages()
            except Exception:
                pass
        if self.messages_ref is not None:
            return [dict(item) for item in self.messages_ref]
        if self.context_aggregator is not None:
            getter = getattr(self.context_aggregator, "get_messages", None)
            if callable(getter):
                value = getter()
                if isinstance(value, list):
                    return [dict(item) for item in value]
        return []


class _DailyAPIClient:
    """Thin wrapper around Daily REST endpoints used in tests."""

    def __init__(self, api_key: str, base_url: str = "https://api.daily.co/v1") -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        data = None
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
        req = request.Request(url, data=data, method=method, headers=headers)
        try:
            with request.urlopen(req, timeout=10) as resp:
                body = resp.read()
        except error.HTTPError as exc:
            if exc.code == 404:
                raise FileNotFoundError(path) from exc
            raise RuntimeError(
                f"Daily API {method} {path} failed: {exc.code} {exc.reason}"
            ) from exc
        except Exception as exc:  # pragma: no cover - network errors
            raise RuntimeError(f"Daily API {method} {path} failed: {exc}") from exc
        if not body:
            return {}
        try:
            return json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            raise RuntimeError(
                f"Daily API {method} {path} returned invalid JSON"
            ) from exc

    def ensure_room(self, room_name: str) -> None:
        try:
            self._request("GET", f"/rooms/{room_name}")
            return
        except FileNotFoundError:
            pass
        payload = {"name": room_name, "privacy": "private"}
        try:
            self._request("POST", "/rooms", payload)
        except RuntimeError as exc:  # pragma: no cover - handles races
            if "already exists" not in str(exc):
                raise

    def create_token(
        self,
        room_name: str,
        *,
        is_owner: bool = False,
        user_name: Optional[str] = None,
    ) -> str:
        payload: Dict[str, Any] = {
            "properties": {
                "room_name": room_name,
                "is_owner": is_owner,
            }
        }
        if user_name:
            payload["properties"]["user_name"] = user_name
        data = self._request("POST", "/meeting-tokens", payload)
        token = data.get("token")
        if not token:
            raise RuntimeError("Daily API did not return a meeting token")
        return token


class _ParticipantEventHandler(EventHandler):
    """Handles join/leave callbacks for the synthetic participant."""

    def __init__(self) -> None:
        super().__init__()
        self._loop = asyncio.get_running_loop()
        self.joined = self._loop.create_future()
        self.left = self._loop.create_future()
        self.last_error: Optional[str] = None

    def on_joined(self, data):  # type: ignore[override]
        if not self.joined.done():
            self._loop.call_soon_threadsafe(self.joined.set_result, data or {})

    def on_left(self):  # type: ignore[override]
        if not self.left.done():
            self._loop.call_soon_threadsafe(self.left.set_result, True)

    def on_error(self, message: str):  # type: ignore[override]
        self.last_error = message
        if not self.joined.done():
            self._loop.call_soon_threadsafe(
                self.joined.set_exception, RuntimeError(message)
            )
        if not self.left.done():
            self._loop.call_soon_threadsafe(
                self.left.set_exception, RuntimeError(message)
            )


class DailyAudioParticipant:
    """Minimal Daily client that publishes a PCM clip as microphone audio."""

    def __init__(
        self,
        *,
        room_url: str,
        token: str,
        participant_name: str,
        audio_clip: Optional[AudioClip] = None,
        frame_sleep: float = AUDIO_FRAME_MS / 1000.0,
    ) -> None:
        self._room_url = room_url
        self._token = token
        self._participant_name = participant_name
        self._clip = audio_clip
        self._frame_sleep = frame_sleep
        self._handler = _ParticipantEventHandler()
        self._client = CallClient(event_handler=self._handler)
        # Only set up audio track if we have an audio clip
        if audio_clip is not None:
            self._audio_source = CustomAudioSource(audio_clip.sample_rate, audio_clip.channels)
            self._audio_track = CustomAudioTrack(self._audio_source)
        else:
            self._audio_source = None
            self._audio_track = None

    async def join(self) -> None:
        loop = asyncio.get_running_loop()

        def _completion(data, error_msg):
            if error_msg is None:
                loop.call_soon_threadsafe(self._handler.on_joined, data or {})
            else:
                loop.call_soon_threadsafe(self._handler.on_error, error_msg)

        self._client.set_user_name(self._participant_name)
        
        # Only configure publishing and inputs if we have an audio clip
        if self._clip is not None and self._audio_track is not None:
            publishing = {
                "microphone": {
                    "sendSettings": {
                        "channelConfig": "mono" if self._clip.channels == 1 else "stereo",
                        "bitrate": 64000,
                    }
                }
            }
            inputs = {
                "camera": {"isEnabled": False},
                "microphone": {
                    "isEnabled": True,
                    "settings": {
                        "customTrack": {"id": self._audio_track.id},
                    },
                },
            }
        else:
            # No audio - just join without microphone
            publishing = {}
            inputs = {
                "camera": {"isEnabled": False},
                "microphone": {"isEnabled": False},
            }
        
        client_settings = {"inputs": inputs, "publishing": publishing}

        self._client.join(
            self._room_url,
            self._token,
            client_settings=client_settings,
            completion=_completion,
        )
        await asyncio.wait_for(self._handler.joined, timeout=15)

        # Only add custom audio track if we have one
        if self._audio_track is not None:
            def _publish_completion(error_msg):
                if error_msg is not None:
                    loop.call_soon_threadsafe(self._handler.on_error, error_msg)

            self._client.add_custom_audio_track(
                "integration-mic",
                self._audio_track,
                completion=_publish_completion,
            )

    async def stream_audio(self) -> None:
        if self._clip is None or self._audio_source is None:
            raise RuntimeError("Cannot stream audio - no audio clip provided")
        
        # Stream the audio clip
        for chunk in self._clip.iter_frames():
            self._audio_source.write_frames(chunk)
            await asyncio.sleep(self._frame_sleep)
            
        # Stream silence for 1.2 seconds to prevent VAD glitches/interruptions
        # This ensures the VAD state settles to "silence" before we stop writing
        bytes_per_sample = 2 * self._clip.channels
        # 20ms is the default frame duration in iter_frames
        samples_per_frame = int(self._clip.sample_rate * 20 / 1000)
        bytes_per_frame = samples_per_frame * bytes_per_sample
        silence_chunk = b'\x00' * bytes_per_frame
        
        silence_frames = int(1.2 / 0.02)  # 1.2 seconds / 20ms
        for _ in range(silence_frames):
            self._audio_source.write_frames(silence_chunk)
            await asyncio.sleep(self._frame_sleep)

    async def leave(self) -> None:
        loop = asyncio.get_running_loop()

        def _completion(error_msg):
            if error_msg is None:
                loop.call_soon_threadsafe(self._handler.on_left)
            else:
                loop.call_soon_threadsafe(self._handler.on_error, error_msg)

        self._client.leave(completion=_completion)
        try:
            await asyncio.wait_for(self._handler.left, timeout=10)
        finally:
            self._client.release()


async def _synthesize_with_elevenlabs(text: str, target_sample_rate: int) -> Optional[AudioClip]:
    if ElevenLabsTTSService is None:
        return None
    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return None
    service = ElevenLabsTTSService(
        api_key=api_key,
        voice_id=os.getenv("ELEVENLABS_VOICE_ID", "Rachel"),
        output_format=f"pcm_{target_sample_rate}",
    )
    audio_chunks: List[bytes] = []
    sample_rate = target_sample_rate
    async for frame in service.run_tts(text):
        if isinstance(frame, TTSAudioRawFrame):
            audio_chunks.append(frame.audio)
            sample_rate = frame.sample_rate
    pcm = b"".join(audio_chunks)
    if not pcm:
        return None
    if sample_rate != target_sample_rate:
        pcm = audioop.ratecv(
            pcm, _PCM_SAMPLE_WIDTH, 1, sample_rate, target_sample_rate, None
        )[0]
        sample_rate = target_sample_rate
    return AudioClip(pcm=pcm, sample_rate=sample_rate)




async def synthesize_audio_clip(
    text: str,
    *,
    target_sample_rate: int,
    fixture_path: Optional[pathlib.Path] = None,
) -> AudioClip:
    """Synthesize audio clip for test harness.
    
    Note: Kokoro requires WebSocket + Pipeline (TaskManager), so for test harness
    we use ElevenLabs API directly. The bot pipeline uses Kokoro successfully.
    
    If fixture_path is provided and exists (non-zero size), loads cached audio.
    NEVER overwrites existing fixture files - they are considered manually curated.
    Only synthesizes and saves if fixture_path does not exist.
    """
    # ALWAYS try loading from cache first if path provided and exists
    if fixture_path is not None and fixture_path.exists() and fixture_path.stat().st_size > 0:
        try:
            with wave.open(str(fixture_path), "rb") as wav:
                sample_rate = wav.getframerate()
                channels = wav.getnchannels()
                pcm = wav.readframes(wav.getnframes())
                
                # Accept whatever sample rate/channels the fixture has
                # This allows manually created fixtures to use any format
                logger.info(
                    f"Loaded cached audio from {fixture_path} "
                    f"(sample_rate={sample_rate}, channels={channels}, size={len(pcm)} bytes)"
                )
                
                # Resample if needed to match target
                if sample_rate != target_sample_rate:
                    logger.info(f"Resampling from {sample_rate}Hz to {target_sample_rate}Hz")
                    pcm = audioop.ratecv(
                        pcm, _PCM_SAMPLE_WIDTH, channels, sample_rate, target_sample_rate, None
                    )[0]
                    sample_rate = target_sample_rate
                
                # Convert to mono if needed
                if channels > 1:
                    logger.info(f"Converting from {channels} channels to mono")
                    pcm = audioop.tomono(pcm, _PCM_SAMPLE_WIDTH, 0.5, 0.5)
                    channels = 1
                
                return AudioClip(pcm=pcm, sample_rate=sample_rate, channels=channels)
        except Exception as exc:
            logger.error(f"Failed to load cached audio from {fixture_path}: {exc}", exc_info=True)
            raise RuntimeError(
                f"Cannot load existing fixture {fixture_path}. Please verify it's a valid WAV file."
            ) from exc
    
    # Only synthesize if fixture doesn't exist
    if fixture_path is not None and fixture_path.exists():
        raise RuntimeError(
            f"Fixture {fixture_path} exists but could not be loaded. "
            "Please check the file format or delete it to regenerate."
        )
    
    # Synthesize with ElevenLabs
    clip: Optional[AudioClip] = None
    try:
        clip = await _synthesize_with_elevenlabs(text, target_sample_rate)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("ElevenLabs synthesis failed, falling back", exc_info=exc)
    
    if clip is None:
        # Final fallback to synthetic audio
        logger.info("Generating synthetic PCM clip for integration harness")
        clip = _generate_placeholder_clip(text, target_sample_rate)
    
    # Save to fixture ONLY if path provided and doesn't exist
    if fixture_path is not None and not fixture_path.exists() and clip is not None:
        try:
            _ensure_fixture_dir(fixture_path.parent)
            _save_wav(clip, fixture_path)
            logger.info(f"Saved new audio fixture to {fixture_path}")
        except Exception as exc:
            logger.warning(f"Failed to save audio fixture to {fixture_path}: {exc}")
    
    return clip


def _generate_placeholder_clip(text: str, sample_rate: int) -> AudioClip:
    duration = min(6.0, max(1.5, len(text) * 0.08))
    total_samples = int(sample_rate * duration)
    base_frequency = 220.0
    modulation = max(1, len(text) % 5)
    pcm = bytearray()
    for index in range(total_samples):
        phase = 2 * math.pi * base_frequency * (index / sample_rate)
        envelope = 0.5 * (1 - math.cos(2 * math.pi * min(index / total_samples, 1)))
        value = int(12000 * envelope * math.sin(phase + (modulation * index / sample_rate)))
        pcm += struct.pack("<h", max(-32768, min(32767, value)))
    return AudioClip(pcm=bytes(pcm), sample_rate=sample_rate)
    
    
def _ensure_fixture_dir(path: pathlib.Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    
    
def _save_wav(clip: AudioClip, path: pathlib.Path) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(clip.channels)
        wav.setsampwidth(_PCM_SAMPLE_WIDTH)
        wav.setframerate(clip.sample_rate)
        wav.writeframes(clip.pcm)
    
    
async def _load_audio_fixture(config: LiveSessionConfig) -> AudioClip:
    """Load pre-recorded audio fixture for test session.
    
    Expects the fixture to already exist. Developers must create wav files
    manually or using external tools. This ensures consistent test audio
    and eliminates external API dependencies.
    """
    path = config.audio_fixture_path
    
    if not path.exists():
        raise FileNotFoundError(
            f"Audio fixture not found: {path}\n"
            f"Please create this wav file manually (16kHz mono recommended)."
        )
    
    # Load the fixture
    try:
        with wave.open(str(path), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            pcm = wav.readframes(wav.getnframes())
            
            logger.info(
                f"Loaded audio fixture from {path} "
                f"(sample_rate={sample_rate}, channels={channels}, size={len(pcm)} bytes)"
            )
            
            # Resample if needed to match target
            if sample_rate != config.audio_sample_rate:
                logger.info(f"Resampling from {sample_rate}Hz to {config.audio_sample_rate}Hz")
                pcm = audioop.ratecv(
                    pcm, _PCM_SAMPLE_WIDTH, channels, sample_rate, config.audio_sample_rate, None
                )[0]
                sample_rate = config.audio_sample_rate
            
            # Convert to mono if needed
            if channels > 1:
                logger.info(f"Converting from {channels} channels to mono")
                pcm = audioop.tomono(pcm, _PCM_SAMPLE_WIDTH, 0.5, 0.5)
                channels = 1
            
            return AudioClip(pcm=pcm, sample_rate=sample_rate, channels=channels)
    except Exception as exc:
        logger.error(f"Failed to load audio fixture from {path}: {exc}", exc_info=True)
        raise RuntimeError(
            f"Cannot load fixture {path}. Please verify it's a valid WAV file."
        ) from exc


@contextmanager
def _patched_environment(overrides: Dict[str, str]):
    previous = {key: os.getenv(key) for key in overrides}
    for key, value in overrides.items():
        os.environ[key] = value
    try:
        yield
    finally:
        for key, old in previous.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old


@contextmanager
def _runtime_patches():
    from types import SimpleNamespace

    async def _fake_fetch_prompts(*_args: Any, **_kwargs: Any) -> Dict[str, str]:
        return {
            "bot_replace_note": "Test replace note prompt",
            "bot_create_note": "Test create note prompt",
        }

    async def _fake_save_summary(*_args: Any, **_kwargs: Any) -> bool:
        return True

    async def _fake_generate_summary(_messages: List[Dict[str, Any]]) -> str:
        return "Summary unavailable in tests."

    class _FakeProfileService:
        async def reload_user_profile(self, *_args: Any, **_kwargs: Any) -> Dict[str, Any]:
            return {"first_name": "Integration"}

        async def load_user_profile(self, *_args: Any, **_kwargs: Any) -> Dict[str, Any]:
            return {"first_name": "Integration"}

    async def _fake_get_personality(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
        return {
            "_id": "personality-test",
            "name": "Integration Personality",
            "primaryPrompt": "You are a helpful assistant for integration testing.",
        }

    async def _fake_prepare_toolbox(*_args: Any, **_kwargs: Any):
        return SimpleNamespace(tools_schema=None, schemas=[], registrations=[])

    patches = [
        patch("actions.functional_prompt_actions.fetch_functional_prompts", new=_fake_fetch_prompts),
        patch("actions.profile_actions.save_conversation_summary", new=_fake_save_summary),
        patch("services.user_profile.get_profile_service", return_value=_FakeProfileService()),
        patch("actions.personality_actions.get_personality_by_id", new=_fake_get_personality),
        # patch("bot.toolbox.prepare_toolbox", new=_fake_prepare_toolbox),
    ]
    
    if hasattr(bot, "generate_conversation_summary"):
        patches.append(patch("bot.generate_conversation_summary", new=_fake_generate_summary))

    with contextlib.ExitStack() as stack:
        for item in patches:
            stack.enter_context(item)
        yield


@asynccontextmanager
async def _instrument_build_pipeline(artifacts: SessionArtifacts):
    original = bot.build_pipeline

    async def _wrapper(*args: Any, **kwargs: Any):
        result = await original(*args, **kwargs)
        (
            _pipeline,
            _task,
            context_agg,
            _transport,
            messages,
            multi_user_agg,
            *_rest,
        ) = result
        artifacts.context_aggregator = context_agg
        artifacts.messages_ref = messages
        artifacts.multi_user_aggregator = multi_user_agg
        _attach_bot_stop_hook(_transport, artifacts)
        artifacts.ready.set()
        return result

    with patch("bot.build_pipeline", new=_wrapper):
        yield


def _attach_bot_stop_hook(transport: Any, artifacts: SessionArtifacts) -> None:
    """Attach a hook to capture bot stop speaking events without altering transport behavior."""
    handler = getattr(transport, "_bot_stopped_speaking", None)
    if not callable(handler):
        return
    if getattr(transport, "_integration_bot_stop_hook", False):
        return

    if asyncio.iscoroutinefunction(handler):

        async def _wrapped(*args: Any, **kwargs: Any):
            artifacts.record_bot_stop()
            return await handler(*args, **kwargs)

    else:

        def _wrapped(*args: Any, **kwargs: Any):
            artifacts.record_bot_stop()
            return handler(*args, **kwargs)

    transport._bot_stopped_speaking = MethodType(_wrapped, transport)
    setattr(transport, "_integration_bot_stop_hook", True)
    logger.debug("[instrumentation] Attached bot stop hook to %s", type(transport).__name__)


async def _wait_for_assistant(
    artifacts: SessionArtifacts,
    *,
    timeout: float,
    min_messages: int = 1,
    expected_tool_call: Optional[str] = None,
    wait_for_bot_stop: bool = False,
) -> Dict[str, Any]:
    """Wait for assistant to produce at least min_messages messages.
    
    Args:
        artifacts: Session artifacts containing message aggregators
        timeout: Maximum time to wait in seconds
        min_messages: Minimum number of assistant messages required (default 1)
        expected_tool_call: Optional tool name to wait for. Returns immediately if found.
        wait_for_bot_stop: If True, require a downstream bot stop event after the latest assistant message
    
    Returns:
        Dict with 'messages' (all messages) and 'assistant_messages' (filtered)
    
    Raises:
        TimeoutError: If minimum messages not reached within timeout
    """
    deadline = time.monotonic() + timeout
    baseline_stop_count = artifacts.bot_stop_count
    last_assistant_count = 0
    stop_after_last_message = baseline_stop_count
    stop_wait_started_at: float | None = None
    while time.monotonic() < deadline:
        messages = artifacts.snapshot_messages()
        assistant_messages = [msg for msg in messages if msg.get("role") == "assistant"]

        if len(assistant_messages) != last_assistant_count:
            last_assistant_count = len(assistant_messages)
            stop_after_last_message = artifacts.bot_stop_count
            stop_wait_started_at = None
        
        # Check for expected tool call
        if expected_tool_call:
            for msg in assistant_messages:
                if "tool_calls" in msg:
                    for tc in msg["tool_calls"]:
                        if tc.get("function", {}).get("name") == expected_tool_call:
                            return {"messages": messages, "assistant_messages": assistant_messages}

        if len(assistant_messages) >= min_messages:
            if wait_for_bot_stop:
                stop_count = artifacts.bot_stop_count
                if stop_count > stop_after_last_message:
                    # Give the pipeline a short moment to flush frames after stop
                    if artifacts.last_bot_stop and time.monotonic() - artifacts.last_bot_stop < 0.2:
                        await asyncio.sleep(0.2)
                    logger.debug(
                        "[wait_for_assistant]: Messages met + bot stopped (count=%s, last_stop=%.3f)",
                        stop_count,
                        artifacts.last_bot_stop or -1.0,
                    )
                    return {"messages": messages, "assistant_messages": assistant_messages}
                if stop_wait_started_at is None:
                    stop_wait_started_at = time.monotonic()
                elif time.monotonic() - stop_wait_started_at >= 3.0:
                    logger.debug(
                        "[wait_for_assistant]: Messages met but no stop after %.1fs; returning on count",
                        time.monotonic() - stop_wait_started_at,
                    )
                    return {"messages": messages, "assistant_messages": assistant_messages}
            else:
                logger.debug(
                    f"[wait_for_assistant]: Found {len(assistant_messages)}/{min_messages} assistant messages: {assistant_messages}"
                )
                return {"messages": messages, "assistant_messages": assistant_messages}
        await asyncio.sleep(0.5)
    raise TimeoutError(
        f"Assistant did not produce {min_messages} message(s) within {timeout}s timeout"
    )


@dataclass(slots=True)
class SessionResult:
    messages: List[Dict[str, Any]]
    assistant_messages: List[str]
    user_messages: List[str]
    transcripts: List[str]
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)


async def run_live_session(config: LiveSessionConfig) -> SessionResult:
    # Daily.init(log_level=LogLevel.Warn)
    api = _DailyAPIClient(api_key=config.daily_api_key)
    api.ensure_room(config.room_name)
    bot_token = api.create_token(config.room_name, is_owner=True, user_name=config.persona)
    participant_token = api.create_token(
        config.room_name, user_name=config.participant_name
    )

    # Only load audio clip if we're going to use it
    clip = await _load_audio_fixture(config) if config.enable_user_audio else None
    artifacts = SessionArtifacts()
    tool_calls: List[Dict[str, Any]] = []

    # Choose appropriate prompt based on conversation mode
    if config.enable_user_audio:
        primary_prompt = (
            "You are a helpful assistant for integration testing. "
            "When participants join, greet them warmly by name. "
            "Then listen to their questions and provide helpful, concise answers. "
            "Be conversational and friendly. "
            "ALWAYS use the available tools to fulfill user requests immediately."
        )
    else:
        primary_prompt = (
            "You are a helpful assistant for integration testing. "
            "When participants join, greet them with a simple, friendly hello using their name. "
            "Keep your greeting brief and natural. Do not use any tools or functions - just say hello."
        )

    env_overrides = {
        "BOT_TEST_EXPOSE_OBJECTS": "1",
        "BOT_TTS_PROVIDER": "kokoro",  # Bot pipeline uses Kokoro (WebSocket-based)
        "KOKORO_TTS_API_KEY": os.getenv("KOKORO_TTS_API_KEY", "test-key"),  # Ensure bot doesn't fallback to ElevenLabs
        "BOT_FUNCTIONAL_PROMPTS": json.dumps({}),
        "BOT_PERSONALITY_RECORD": json.dumps(
            {
                "_id": config.personality_id,
                "name": config.persona,
                "primaryPrompt": primary_prompt,
            }
        ),
    }

    async with _instrument_build_pipeline(artifacts):
        # Patch DailyParams to adjust VAD sensitivity for tests
        def patched_daily_params(**kwargs):
            # When no user audio is streamed, disable VAD entirely to avoid false USER_SPEAKING events
            if not config.enable_user_audio:
                kwargs["vad_analyzer"] = None
            else:
                analyzer = kwargs.get("vad_analyzer")
                if analyzer and hasattr(analyzer, "params"):
                    # Keep VAD on for real audio, but make it conservative to avoid early false starts
                    analyzer.params.confidence = 0.9
                    analyzer.params.start_secs = 0.5
                    analyzer.params.min_volume = 0.2
                    analyzer.params.stop_secs = 1.0
                    # Avoid analyzer.set_params to prevent ZeroDivisionError before sample_rate is set
            
            # Force Daily to deliver 16kHz audio to avoid Pipecat internal resampling
            # (which uses soxr and causes nanobind leaks at shutdown)
            kwargs["audio_in_sample_rate"] = 16000
            
            # Match Kokoro TTS output rate (24kHz) to avoid resampling on output
            kwargs["audio_out_sample_rate"] = 24000
            
            params = DailyParams(**kwargs)
            return params

        with _runtime_patches(), _patched_environment(env_overrides), \
             patch("pipecat.transports.daily.transport.DailyParams", side_effect=patched_daily_params):
            session_task = asyncio.create_task(
                bot.run_pipeline_session(
                    config.room_url,
                    config.personality_id,
                    config.persona,
                    token=bot_token,
                    tenantId=config.tenant_id,
                )
            )
            await asyncio.wait_for(artifacts.ready.wait(), timeout=30)
            participant = DailyAudioParticipant(
                room_url=config.room_url,
                token=participant_token,
                participant_name=config.participant_name,
                audio_clip=clip,
            )
            try:
                print("DEBUG: Participant joining...")
                await participant.join()
                print("DEBUG: Participant joined.")
                
                if config.enable_user_audio:
                    # Two-way conversation mode:
                    # 1. Wait for bot's initial greeting
                    logger.info("Waiting for bot's initial greeting...")
                    greeting_response = await _wait_for_assistant(
                        artifacts,
                        timeout=config.assistant_timeout_secs,
                        wait_for_bot_stop=config.wait_for_bot_stopped,
                    )
                    logger.info(f"Got greeting: {len(greeting_response['assistant_messages'])} messages")
                    
                    # 2. Stream user audio into the room
                    logger.info(f"Streaming user audio: {config.user_message}")
                    await asyncio.sleep(1.0)
                    await participant.stream_audio()
                    
                    # 3. Wait for bot's response to the user's question
                    logger.info("Waiting for bot's response to user audio...")
                    response = await _wait_for_assistant(
                        artifacts, 
                        timeout=config.assistant_timeout_secs,
                        min_messages=len(greeting_response['assistant_messages']) + 1,
                        expected_tool_call=config.expected_tool_call,
                        wait_for_bot_stop=config.wait_for_bot_stopped,
                    )
                else:
                    # Simple greeting-only mode (no user audio)
                    # Wait for assistant response while participant is still in the room
                    # This prevents the bot from shutting down due to empty room
                    response = await _wait_for_assistant(
                        artifacts, 
                        timeout=config.assistant_timeout_secs,
                        min_messages=config.min_assistant_messages,
                        wait_for_bot_stop=config.wait_for_bot_stopped,
                    )
                
                # Give a bit more time for message aggregation to complete
                # await asyncio.sleep(1.0)
            finally:
                # Leave the room after getting the response (or timeout)
                await participant.leave()
                session_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await session_task

    messages: List[Dict[str, Any]] = response["messages"]
    assistant_text = [msg.get("content", "") for msg in response["assistant_messages"]]
    user_text = [msg.get("content", "") for msg in messages if msg.get("role") == "user"]
    
    # Extract tool calls from assistant messages
    tool_calls: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") == "assistant" and "tool_calls" in msg:
            for tc in msg["tool_calls"]:
                tool_calls.append({
                    "id": tc.get("id"),
                    "name": tc.get("function", {}).get("name"),
                    "arguments": tc.get("function", {}).get("arguments"),
                })

    return SessionResult(
        messages=messages,
        assistant_messages=assistant_text,
        user_messages=user_text,
        transcripts=user_text,
        tool_calls=tool_calls,
    )


async def run_stealth_session(config: LiveSessionConfig, stealth_participant_name: str) -> None:
    """Run a specialized session to test stealth mode behavior.
    
    Flow:
    1. Real user joins -> Bot should greet.
    2. Stealth user joins -> Bot should NOT greet.
    """
    api = _DailyAPIClient(api_key=config.daily_api_key)
    api.ensure_room(config.room_name)
    bot_token = api.create_token(config.room_name, is_owner=True, user_name=config.persona)
    
    # Tokens for both users
    real_token = api.create_token(config.room_name, user_name=config.participant_name)
    stealth_token = api.create_token(config.room_name, user_name=stealth_participant_name)

    artifacts = SessionArtifacts()

    # Standard prompt (no user audio needed for this test)
    primary_prompt = (
        "You are a helpful assistant for integration testing. "
        "When participants join, greet them with a simple, friendly hello using their name. "
        "Keep your greeting brief and natural. Do not use any tools or functions - just say hello."
    )

    env_overrides = {
        "BOT_TEST_EXPOSE_OBJECTS": "1",
        "BOT_TTS_PROVIDER": "kokoro",
        "KOKORO_TTS_API_KEY": os.getenv("KOKORO_TTS_API_KEY", "test-key"),
        "BOT_FUNCTIONAL_PROMPTS": json.dumps({}),
        "BOT_PERSONALITY_RECORD": json.dumps(
            {
                "_id": config.personality_id,
                "name": config.persona,
                "primaryPrompt": primary_prompt,
            }
        ),
    }

    async with _instrument_build_pipeline(artifacts):
        # Patch DailyParams (same as run_live_session)
        def patched_daily_params(**kwargs):
            analyzer = kwargs.get("vad_analyzer")
            if analyzer and hasattr(analyzer, "params"):
                analyzer.params.confidence = 0.7
                analyzer.params.start_secs = 0.2
                analyzer.params.min_volume = 0.1
                analyzer.params.stop_secs = 1.0
            kwargs["audio_in_sample_rate"] = 16000
            kwargs["audio_out_sample_rate"] = 24000
            return DailyParams(**kwargs)

        with _runtime_patches(), _patched_environment(env_overrides), \
             patch("pipecat.transports.daily.transport.DailyParams", side_effect=patched_daily_params):
            
            session_task = asyncio.create_task(
                bot.run_pipeline_session(
                    config.room_url,
                    config.personality_id,
                    config.persona,
                    token=bot_token,
                    tenantId=config.tenant_id,
                )
            )
            await asyncio.wait_for(artifacts.ready.wait(), timeout=30)
            
            real_participant = DailyAudioParticipant(
                room_url=config.room_url,
                token=real_token,
                participant_name=config.participant_name,
            )
            
            stealth_participant = DailyAudioParticipant(
                room_url=config.room_url,
                token=stealth_token,
                participant_name=stealth_participant_name,
            )

            try:
                # 1. Real User Joins
                print(f"DEBUG: Real participant {config.participant_name} joining...")
                await real_participant.join()
                print("DEBUG: Real participant joined.")
                
                # 2. Wait for Greeting
                print("DEBUG: Waiting for greeting for real user...")
                greeting_result = await _wait_for_assistant(
                    artifacts, 
                    timeout=config.assistant_timeout_secs,
                    min_messages=1,
                    wait_for_bot_stop=config.wait_for_bot_stopped,
                )
                assistant_msgs = greeting_result["assistant_messages"]
                print(f"DEBUG: Got greeting for real user. Total assistant messages: {len(assistant_msgs)}")
                
                # 3. Stealth User Joins
                print(f"DEBUG: Stealth participant {stealth_participant_name} joining...")
                await stealth_participant.join()
                print("DEBUG: Stealth participant joined.")
                
                # 4. Verify Silence
                # We expect NO new assistant messages.
                # We wait for a short period to give the bot a chance to mess up.
                print("DEBUG: Waiting to verify silence for stealth user...")
                try:
                    # Wait for one MORE message than we already have
                    await _wait_for_assistant(
                        artifacts,
                        timeout=5.0, # 5 seconds silence check
                        min_messages=len(assistant_msgs) + 1,
                        wait_for_bot_stop=config.wait_for_bot_stopped,
                    )
                    # If we get here, the bot spoke again!
                    new_msgs = artifacts.snapshot_messages()
                    new_assistant_msgs = [m for m in new_msgs if m.get("role") == "assistant"]
                    last_msg = new_assistant_msgs[-1].get("content", "")
                    raise RuntimeError(f"Stealth Check Failed: Bot greeted stealth user! Message: '{last_msg}'")
                    
                except TimeoutError:
                    print("DEBUG: Success - Bot remained silent for stealth user.")

            finally:
                await stealth_participant.leave()
                await real_participant.leave()
                session_task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await session_task
                
                # Log conversation summary
                messages = artifacts.snapshot_messages()
                print("\n=== Conversation Summary ===", flush=True)
                i=0
                for msg in messages:
                    role = msg.get("role", "unknown")
                    content = msg.get("content", "")
                    print(f"[{i}][{role}]: {content}", flush=True)
                    i += 1
                print("============================\n", flush=True)

