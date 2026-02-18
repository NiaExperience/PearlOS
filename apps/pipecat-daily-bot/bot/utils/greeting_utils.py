from __future__ import annotations

from typing import Any, Dict


def filtered_system_messages(messages: list[dict[str, Any]], *, contains: str) -> list[dict[str, Any]]:
    """Return system messages whose content includes the given substring (case-insensitive)."""
    needle = (contains or "").lower()
    out: list[dict[str, Any]] = []
    for m in messages:
        try:
            if not isinstance(m, dict) or m.get("role") != "system":
                continue
            content = m.get("content")
            if isinstance(content, str) and needle in content.lower():
                out.append(m)
        except Exception:
            continue
    return out


def is_greeted(state: Dict[str, Any]) -> bool:
    """Check greeting state to determine whether any participant has been greeted."""
    try:
        greeted_ids = state.get("greeted_ids")
        if isinstance(greeted_ids, (set, list, tuple)) and len(greeted_ids) > 0:
            return True
    except Exception:
        pass
    return False


async def wait_gate(delay_secs: float, *, speaking_flag_getter) -> None:
    """Common gate: sleep for delay, then wait briefly for speaking to finish."""
    import asyncio

    try:
        if delay_secs > 0:
            await asyncio.sleep(delay_secs)
    except Exception:
        pass
    # Wait up to ~1s for speaking flag to clear
    tries = 0
    try:
        while speaking_flag_getter() and tries < 10:
            await asyncio.sleep(0.1)
            tries += 1
    except Exception:
        pass


async def wait_user_idle(
    idle_secs: float,
    *,
    is_user_speaking_getter,
    timeout_secs: float | None = None,
    poll_interval: float = 0.1,
) -> None:
    """Wait until the user has been silent for at least `idle_secs` consecutively.

    Args:
        idle_secs: Required amount of continuous silence before returning.
        is_user_speaking_getter: Callable that returns True if a user is currently speaking.
        timeout_secs: Optional hard cap to stop waiting even if idle isn't achieved.
        poll_interval: How frequently to sample speaking state.

    Behavior:
        - Accumulates continuous non-speaking time.
        - Resets the counter any time the user is speaking.
        - Returns once idle_secs is reached or timeout elapses (no error on timeout).
    """
    import asyncio
    import time

    if idle_secs <= 0:
        return

    start = time.monotonic()
    idle_accum = 0.0
    last = start

    while True:
        try:
            speaking = bool(is_user_speaking_getter())
        except Exception:
            speaking = False

        now = time.monotonic()
        dt = now - last
        last = now

        if speaking:
            idle_accum = 0.0
        else:
            idle_accum += dt

        if idle_accum >= idle_secs:
            return

        if timeout_secs is not None and (now - start) >= timeout_secs:
            return

        try:
            await asyncio.sleep(max(0.01, poll_interval))
        except Exception:
            # If sleeping fails, just break to avoid blocking
            return
