"""VisionProcessor — Periodic video frame analysis for Pearl Vision.

Captures frames from user video streams at configurable intervals, sends them
to a vision-capable LLM (e.g., GPT-4o), and injects visual context descriptions
into Pearl's conversation context.

Architecture:
    - Runs as a FrameProcessor in the Pipecat pipeline
    - Listens for UserImageRawFrame from DailyTransport (after requesting frames)
    - Sends frames to vision LLM via OpenAI-compatible API
    - Injects vision descriptions as system messages into LLM context
    - Supports periodic capture (interval-based) and on-demand capture

Configuration (env vars):
    BOT_VISION_ENABLED  — Feature flag (default: false)
    BOT_VISION_MODEL    — Vision LLM model (default: openai/gpt-4o)
    BOT_VISION_INTERVAL — Capture interval in seconds (default: 10, 0=disabled, -1=on-demand)
    BOT_VISION_PROMPT   — Custom prompt for vision analysis
"""

from __future__ import annotations

import asyncio
import base64
import io
import os
import time
from typing import Any, Optional

import aiohttp
from loguru import logger

from pipecat.frames.frames import (
    Frame,
    UserImageRawFrame,
    UserImageRequestFrame,
)
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

from core.config import BOT_PID

# Try importing PIL for image conversion; fall back to raw handling
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


# Default vision analysis prompt
DEFAULT_VISION_PROMPT = (
    "Describe what you see in this image concisely. Focus on: "
    "the person (appearance, expression, what they're doing), "
    "their environment, and anything notable they might be showing. "
    "Keep it to 2-3 sentences. Be natural and conversational."
)


class VisionProcessor(FrameProcessor):
    """Processes video frames through a vision LLM and injects descriptions.
    
    This processor:
    1. Receives UserImageRawFrame from DailyTransport
    2. Converts frame to base64 JPEG
    3. Sends to vision LLM for analysis  
    4. Injects description into conversation context
    
    It also manages periodic frame requests via a background task.
    """

    def __init__(
        self,
        *,
        vision_model: str | None = None,
        vision_interval: float | None = None,
        vision_prompt: str | None = None,
        context: Any = None,
        transport: Any = None,
        **kwargs,
    ):
        super().__init__(**kwargs)
        
        self._vision_model = vision_model or os.getenv("BOT_VISION_MODEL", "openai/gpt-4o")
        
        interval_str = os.getenv("BOT_VISION_INTERVAL", "10")
        try:
            self._vision_interval = vision_interval if vision_interval is not None else float(interval_str)
        except ValueError:
            self._vision_interval = 10.0
            
        self._vision_prompt = vision_prompt or os.getenv(
            "BOT_VISION_PROMPT", DEFAULT_VISION_PROMPT
        )
        
        self._context = context  # OpenAILLMContext for injecting messages
        self._transport = transport  # DailyTransport for requesting frames
        
        # State
        self._active_participants: set[str] = set()
        self._capture_tasks: dict[str, asyncio.Task] = {}
        self._last_description: str = ""
        self._last_capture_time: float = 0
        self._processing_lock = asyncio.Lock()
        self._is_processing = False
        
        # API configuration — use OpenClaw gateway or OpenRouter (no direct OpenAI)
        self._api_base = os.getenv("OPENCLAW_API_URL", os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"))
        self._api_key = os.getenv("OPENCLAW_API_KEY", os.getenv("OPENROUTER_API_KEY", ""))
        
        # Resolve the actual model name for the API call
        # If using OpenClaw proxy, model can be "openai/gpt-4o" format
        self._resolved_model = self._vision_model
        
        logger.info(
            f"[{BOT_PID}] [vision] VisionProcessor initialized: "
            f"model={self._vision_model}, interval={self._vision_interval}s, "
            f"api_base={self._api_base}"
        )

    async def start_capture(self, participant_id: str):
        """Start periodic video frame capture for a participant.
        
        Called when a participant joins and has video enabled.
        """
        if participant_id in self._active_participants:
            logger.debug(f"[{BOT_PID}] [vision] Already capturing for {participant_id}")
            return
            
        self._active_participants.add(participant_id)
        
        # Start video capture on the transport (low framerate — we only need snapshots)
        if self._transport:
            try:
                await self._transport.capture_participant_video(
                    participant_id,
                    framerate=1,  # 1 FPS — we only need periodic snapshots
                    video_source="camera",
                    color_format="RGB",
                )
                logger.info(f"[{BOT_PID}] [vision] Started video capture for participant {participant_id}")
            except Exception as e:
                logger.error(f"[{BOT_PID}] [vision] Failed to start video capture for {participant_id}: {e}")
                self._active_participants.discard(participant_id)
                return
        
        # Start periodic capture task if interval-based
        if self._vision_interval > 0:
            task = asyncio.create_task(self._periodic_capture_loop(participant_id))
            self._capture_tasks[participant_id] = task
            logger.info(f"[{BOT_PID}] [vision] Started periodic capture loop for {participant_id} (every {self._vision_interval}s)")

    async def stop_capture(self, participant_id: str):
        """Stop video frame capture for a participant."""
        self._active_participants.discard(participant_id)
        
        task = self._capture_tasks.pop(participant_id, None)
        if task and not task.done():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            logger.info(f"[{BOT_PID}] [vision] Stopped capture for participant {participant_id}")

    async def request_frame(self, participant_id: str, text: str | None = None):
        """Request a single frame from a participant (on-demand capture).
        
        This can be called by tools or event handlers when Pearl wants to "look"
        at someone specifically.
        """
        if not self._transport:
            logger.warning(f"[{BOT_PID}] [vision] No transport available for frame request")
            return
            
        if participant_id not in self._active_participants:
            # Need to start capture first
            await self.start_capture(participant_id)
            # Give time for the video renderer to initialize
            await asyncio.sleep(0.5)
        
        frame = UserImageRequestFrame(
            user_id=participant_id,
            text=text or self._vision_prompt,
        )
        
        # Push the request upstream (toward transport input)
        await self.push_frame(frame, FrameDirection.UPSTREAM)
        logger.debug(f"[{BOT_PID}] [vision] Requested frame from participant {participant_id}")

    async def _periodic_capture_loop(self, participant_id: str):
        """Background task that periodically requests frames."""
        try:
            # Initial delay to let the participant's video stabilize
            await asyncio.sleep(3.0)
            
            while participant_id in self._active_participants:
                try:
                    await self.request_frame(participant_id)
                except Exception as e:
                    logger.error(f"[{BOT_PID}] [vision] Error requesting frame: {e}")
                
                await asyncio.sleep(self._vision_interval)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Periodic capture loop error: {e}")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        """Process frames flowing through the pipeline."""
        await super().process_frame(frame, direction)
        
        if isinstance(frame, UserImageRawFrame):
            # Got a video frame — analyze it asynchronously
            logger.debug(
                f"[{BOT_PID}] [vision] Received UserImageRawFrame from {frame.user_id}, "
                f"size={frame.size}, format={frame.format}"
            )
            # Don't block the pipeline — analyze in background
            asyncio.create_task(self._analyze_frame(frame))
            # Don't forward the raw image frame downstream
            return
        
        # Forward all other frames
        await self.push_frame(frame, direction)

    async def _analyze_frame(self, frame: UserImageRawFrame):
        """Analyze a video frame using the vision LLM."""
        # Debounce: skip if we're already processing or captured too recently
        if self._is_processing:
            logger.debug(f"[{BOT_PID}] [vision] Skipping frame — already processing")
            return
            
        min_gap = max(self._vision_interval * 0.5, 3.0) if self._vision_interval > 0 else 3.0
        now = time.time()
        if now - self._last_capture_time < min_gap:
            logger.debug(f"[{BOT_PID}] [vision] Skipping frame — too soon since last capture")
            return
        
        async with self._processing_lock:
            if self._is_processing:
                return
            self._is_processing = True
        
        try:
            self._last_capture_time = now
            
            # Convert raw frame to base64 JPEG
            base64_image = await self._frame_to_base64(frame)
            if not base64_image:
                return
            
            # Send to vision LLM
            description = await self._call_vision_llm(base64_image)
            if not description:
                return
            
            # Only inject if the description meaningfully changed
            if description.strip() == self._last_description.strip():
                logger.debug(f"[{BOT_PID}] [vision] Description unchanged, skipping injection")
                return
            
            self._last_description = description.strip()
            
            # Inject the vision context into the conversation
            await self._inject_vision_context(description, frame.user_id)
            
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Frame analysis error: {e}", exc_info=True)
        finally:
            async with self._processing_lock:
                self._is_processing = False

    async def _frame_to_base64(self, frame: UserImageRawFrame) -> str | None:
        """Convert a raw video frame to a base64-encoded JPEG string."""
        try:
            if HAS_PIL:
                # Use PIL for proper conversion
                img = Image.frombytes(
                    "RGB" if frame.format == "RGB" else frame.format or "RGB",
                    frame.size,
                    frame.image,
                )
                # Resize to max 512px on longest side to save tokens
                max_dim = 512
                w, h = img.size
                if max(w, h) > max_dim:
                    scale = max_dim / max(w, h)
                    new_size = (int(w * scale), int(h * scale))
                    img = img.resize(new_size, Image.LANCZOS)
                
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=70)
                jpeg_bytes = buf.getvalue()
            else:
                # Without PIL, try to use the raw bytes directly
                # This is a fallback — JPEG conversion is strongly preferred
                logger.warning(f"[{BOT_PID}] [vision] PIL not available, using raw frame bytes")
                jpeg_bytes = frame.image
            
            b64 = base64.b64encode(jpeg_bytes).decode("utf-8")
            logger.debug(f"[{BOT_PID}] [vision] Encoded frame: {len(jpeg_bytes)} bytes -> {len(b64)} b64 chars")
            return b64
            
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Failed to convert frame to base64: {e}")
            return None

    async def _call_vision_llm(self, base64_image: str) -> str | None:
        """Send a base64 image to the vision LLM and get a description."""
        try:
            url = f"{self._api_base.rstrip('/')}/chat/completions"
            
            payload = {
                "model": self._resolved_model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": self._vision_prompt,
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{base64_image}",
                                    "detail": "low",  # Use low detail to save tokens
                                },
                            },
                        ],
                    }
                ],
                "max_tokens": 200,
                "temperature": 0.3,
            }
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._api_key}",
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    json=payload,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=15),
                ) as resp:
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.error(
                            f"[{BOT_PID}] [vision] Vision LLM API error {resp.status}: {error_text[:200]}"
                        )
                        return None
                    
                    result = await resp.json()
                    description = result["choices"][0]["message"]["content"]
                    logger.info(f"[{BOT_PID}] [vision] Vision analysis: {description[:100]}...")
                    return description
                    
        except asyncio.TimeoutError:
            logger.warning(f"[{BOT_PID}] [vision] Vision LLM request timed out")
            return None
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Vision LLM call failed: {e}")
            return None

    async def _inject_vision_context(self, description: str, user_id: str):
        """Inject vision description into the LLM conversation context."""
        if not self._context:
            logger.warning(f"[{BOT_PID}] [vision] No context available for injection")
            return
        
        vision_message = {
            "role": "system",
            "content": (
                f"[VISION UPDATE] You can currently see the user through their camera. "
                f"Here is what you observe: {description}\n"
                f"Use this visual context naturally in conversation when relevant. "
                f"Don't announce that you're analyzing video — just seamlessly incorporate "
                f"what you see. If the user asks you what you see, describe it naturally."
            ),
        }
        
        try:
            # Add to the LLM context messages
            messages = self._context.get_messages() if hasattr(self._context, 'get_messages') else []
            
            # Remove previous vision messages to avoid context bloat
            cleaned = [
                m for m in messages
                if not (
                    isinstance(m, dict)
                    and m.get("role") == "system"
                    and isinstance(m.get("content"), str)
                    and m["content"].startswith("[VISION UPDATE]")
                )
            ]
            
            # Add the new vision message
            cleaned.append(vision_message)
            
            # Update context
            if hasattr(self._context, 'set_messages'):
                self._context.set_messages(cleaned)
            elif hasattr(self._context, 'messages'):
                self._context.messages = cleaned
            
            logger.info(f"[{BOT_PID}] [vision] Injected vision context for user {user_id}")
            
        except Exception as e:
            logger.error(f"[{BOT_PID}] [vision] Failed to inject vision context: {e}")

    async def cleanup(self):
        """Clean up all capture tasks."""
        for pid in list(self._capture_tasks):
            await self.stop_capture(pid)
        self._active_participants.clear()
        logger.info(f"[{BOT_PID}] [vision] Cleaned up all vision captures")
