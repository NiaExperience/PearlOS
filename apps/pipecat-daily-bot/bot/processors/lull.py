import time
from typing import List, Dict, Any
from loguru import logger

from pipecat.frames.frames import LLMRunFrame
from pipecat.processors.user_idle_processor import UserIdleProcessor
from core.config import BOT_PID

def create_lull_processor(messages: List[Dict[str, Any]], timeout_secs: float) -> UserIdleProcessor:
    """Create a UserIdleProcessor that appends a system note and triggers the LLM on timeout."""
    
    last_lull_at = 0.0

    async def lull_callback_impl(proc: UserIdleProcessor):
        nonlocal last_lull_at
        now = time.time()
        # Avoid rapid re-triggers if the user resumes briefly then goes quiet again.
        if now - last_lull_at < timeout_secs * 0.5:
            return
        last_lull_at = now
        logger.info(f"[{BOT_PID}] Lull detected, appending system note and triggering LLM")
        
        # Append note to context messages (list passed by reference)
        messages.append(
            {
                "role": "system",
                "content": (
                    f"System note: the user has been silent for {int(timeout_secs)} seconds. "
                    "If the user explicitly asked for silence or to be left alone, reply with 'SILENCE'. "
                    "Otherwise, gently check in with a brief, low-pressure question to see if they are still there or need help."
                ),
            }
        )
        # Trigger LLM generation by pushing a frame downstream from this processor.
        await proc.queue_frame(LLMRunFrame())

    return UserIdleProcessor(callback=lull_callback_impl, timeout=timeout_secs)
