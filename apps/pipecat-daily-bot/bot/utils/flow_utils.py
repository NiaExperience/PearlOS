from __future__ import annotations

from typing import Any, Awaitable, Callable

from loguru import logger
from pipecat.frames.frames import LLMRunFrame

from .async_utils import get_running_loop_or_none, run_coroutine_in_new_loop, schedule_coroutine_on_loop


def schedule_flow_llm_run(
    flow_manager: Any,
    *,
    before_queue: Callable[[], Awaitable[None]] | None = None,
) -> bool:
    """Queue a single LLMRunFrame via the Flow manager's task.queue_frames.

    - If a loop is running, schedule on that loop; otherwise create a new loop.
    - Returns False if no task/queue_frames callable found or scheduling fails.
    """
    assert flow_manager is not None, 'FlowManager is required'

    task = getattr(flow_manager, 'task', None)
    if task is None:
        return False

    queue_frames = getattr(task, 'queue_frames', None)
    if not callable(queue_frames):
        return False

    async def _queue_llm_frame():
        try:
            if before_queue is not None:
                await before_queue()
            await queue_frames([LLMRunFrame()])
        except Exception as err:  # pragma: no cover - defensive logging
            logger.error('[flow] Failed to queue LLM run: %s', err)
            raise

    loop = get_running_loop_or_none()
    if loop is not None:
        return schedule_coroutine_on_loop(loop, _queue_llm_frame)

    return run_coroutine_in_new_loop(_queue_llm_frame)
