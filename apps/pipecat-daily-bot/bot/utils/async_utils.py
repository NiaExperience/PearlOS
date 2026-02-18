from __future__ import annotations

import asyncio
from typing import Any, Callable

from loguru import logger


def get_running_loop_or_none() -> asyncio.AbstractEventLoop | None:
    """Return the currently running event loop, or None if not inside one."""
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None


def schedule_coroutine_on_loop(loop: asyncio.AbstractEventLoop, factory: Callable[[], Any]) -> bool:
    """Schedule a coroutine returned by factory on the provided loop.

    Returns True on success; logs and returns False on failure.
    """
    try:
        loop.create_task(factory())
        return True
    except Exception as err:  # pragma: no cover - defensive
        logger.error('[async] Failed to schedule coroutine: %s', err)
        return False


def run_coroutine_in_new_loop(factory: Callable[[], Any]) -> bool:
    """Execute a coroutine returned by factory in a fresh event loop.

    Useful in test contexts where no loop is running.
    """
    loop = asyncio.new_event_loop()
    try:
        loop.run_until_complete(factory())
        return True
    except Exception as err:  # pragma: no cover - defensive
        logger.error('[async] Failed to execute coroutine in new loop: %s', err)
        return False
    finally:
        loop.close()
