"""Flow-managed pacing utilities for the Pipecat Daily Bot.

The pacing controller encapsulates wrap-up timers, conversation beat scheduling,

and participant refresh loops so that they can be coordinated through
``flow_manager.state`` instead of ad-hoc globals inside legacy event handlers.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, Iterable, List, Mapping, Optional

from loguru import logger

from eventbus import events
from pipecat_flows import FlowManager

from .core import WRAPUP_NODE_NAME, get_default_wrapup_prompt

_Publisher = Callable[[str, Dict[str, Any]], None]
_AsyncFactory = Callable[[], Awaitable[None]]
_WrapupCallback = Callable[[], Awaitable[None]]


@dataclass(slots=True)
class BeatPlan:
    message: str
    start_time: float
    next_start_time: Optional[float]

    def as_dict(self) -> Dict[str, Any]:
        return {
            "message": self.message,
            "start_time": self.start_time,
            "next_start_time": self.next_start_time,
        }


class FlowPacingController:
    """Coordinate pacing timers and persist their metadata in Flow state."""

    __slots__ = (
        "_flow_manager",
        "_publish",
        "_room",
        "_wrapup_task",
        "_beat_tasks",
        "_call_start_time",
    )

    def __init__(
        self,
        *,
        flow_manager: Optional[FlowManager],
        publish: _Publisher,
        room: str,
    ) -> None:
        self._flow_manager = flow_manager
        self._publish = publish
        self._room = room
        self._wrapup_task: Optional[asyncio.Task[None]] = None
        self._beat_tasks: List[asyncio.Task[None]] = []
        self._call_start_time: Optional[float] = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def enabled(self) -> bool:
        return True

    def schedule_wrapup(
        self,
        *,
        delay: float,
        on_wrapup: Optional[_WrapupCallback] = None,
    ) -> None:
        """Schedule a wrap-up event after ``delay`` seconds."""

        if not self.enabled or delay <= 0:
            return

        self._cancel_wrapup_task()

        loop = self._get_running_loop()
        if loop is None:
            logger.warning("[flow.pacing] No running loop; skipping wrapup schedule")
            return

        pacing_state = self._get_pacing_state()
        now = self._loop_time(loop)

        wrapup_state = pacing_state.setdefault("wrapup", {})
        wrapup_prompt = self._resolve_wrapup_prompt()
        wrapup_state.update(
            {
                "scheduled_at": now,
                "delay": delay,
                "due_at": now + delay,
                "active": True,
                "has_callback": on_wrapup is not None,
                "prompt": wrapup_prompt,
            }
        )

        async def _wrapup_runner() -> None:
            try:
                await asyncio.sleep(delay)
                if on_wrapup is not None:
                    try:
                        await on_wrapup()
                    except Exception:
                        logger.exception("[flow.pacing] Wrapup callback failed")
                self._publish(
                    events.BOT_CONVO_WRAPUP,
                    {
                        "room": self._room,
                        "after_secs": delay,
                        "wrapup_prompt": wrapup_prompt,
                    },
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("[flow.pacing] Wrapup task failed")
            finally:
                wrapup_state["active"] = False
                wrapup_state["completed_at"] = self._loop_time(loop)

        self._wrapup_task = loop.create_task(_wrapup_runner())

    def schedule_beats(
        self,
        *,
        personality_record: Mapping[str, Any],
        repeat_interval: float,
    ) -> None:
        """Start beat tasks derived from the personality record."""

        if not self.enabled:
            return

        beats = personality_record.get("beats")
        if not isinstance(beats, Iterable):
            return

        loop = self._get_running_loop()
        if loop is None:
            logger.warning("[flow.pacing] No running loop; skipping beat schedule")
            return

        valid_beats = self._extract_beat_plans(beats)

        if not valid_beats:
            return

        self.cancel_beats()

        pacing_state = self._get_pacing_state()
        self._call_start_time = self._loop_time(loop)
        pacing_state["beats"] = {
            "repeat_interval": repeat_interval,
            "plans": [plan.as_dict() for plan in valid_beats],
            "started_at": self._call_start_time,
        }
        logger.debug(f"[flow.pacing] Scheduling {len(valid_beats)} beats with repeat interval {repeat_interval}s")
        self._beat_tasks = [loop.create_task(self._beat_runner(plan, repeat_interval)) for plan in valid_beats]

    def cancel_beats(self) -> None:
        for task in self._beat_tasks:
            if not task.done():
                task.cancel()
        self._beat_tasks = []
        if self.enabled:
            pacing_state = self._get_pacing_state()
            pacing_state.pop("beats", None)

    def cancel_all(self) -> None:
        self._cancel_wrapup_task()
        self.cancel_beats()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _beat_runner(self,
                           plan: BeatPlan,
                           repeat_interval: float
                           ) -> None:
        loop = self._get_running_loop()
        if loop is None:
            return

        try:
            await asyncio.sleep(plan.start_time)
            self._publish(
                events.BOT_CONVO_PACING_BEAT,
                {
                    "room": self._room,
                    "message": plan.message,
                    "start_time": plan.start_time,
                    "elapsed": plan.start_time,
                    "repeat_count": 0,
                },
            )

            # If we don't have a repeat interval, exit after publishing the beat
            if not repeat_interval or repeat_interval <= 0:
                logger.debug("[flow.pacing] No repeat interval set; not repeating beat")
                return

            logger.debug(f"[flow.pacing] Starting beat repeat every {repeat_interval}s")
            repeat_count = 1
            while True:
                await asyncio.sleep(repeat_interval)
                current_elapsed = self._current_elapsed(loop)
                if plan.next_start_time is not None and current_elapsed >= plan.next_start_time:
                    logger.debug("[flow.pacing] Reached next beat start time; stopping repeat")
                    break
                logger.debug(f"[flow.pacing] Repeating beat #{repeat_count} after {current_elapsed}s")
                self._publish(
                    events.BOT_CONVO_PACING_BEAT,
                    {
                        "room": self._room,
                        "message": plan.message,
                        "start_time": plan.start_time,
                        "elapsed": current_elapsed,
                        "repeat_count": repeat_count,
                    },
                )
                repeat_count += 1
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("[flow.pacing] Beat runner failed")

    def _cancel_wrapup_task(self) -> None:
        if self._wrapup_task and not self._wrapup_task.done():
            self._wrapup_task.cancel()
        self._wrapup_task = None
        if self.enabled:
            pacing_state = self._get_pacing_state()
            wrapup_state = pacing_state.setdefault("wrapup", {})
            wrapup_state.update({"active": False})

    def _get_pacing_state(self) -> Dict[str, Any]:
        flow_state = self._flow_manager.state  # type: ignore[union-attr]
        pacing_state = flow_state.setdefault("pacing", {})
        return pacing_state

    def _resolve_wrapup_prompt(self) -> str:
        prompt: Optional[str] = None
        flow_state: Any = None
        try:
            flow_state = self._flow_manager.state  # type: ignore[union-attr]
        except Exception:  # pragma: no cover - defensive fallback
            flow_state = None

        if isinstance(flow_state, dict):
            override = flow_state.get("wrapup_prompt_override")
            if isinstance(override, str) and override.strip():
                prompt = override.strip()
            else:
                nodes = flow_state.get("nodes")
                if isinstance(nodes, dict):
                    wrapup_node = nodes.get(WRAPUP_NODE_NAME)
                    if isinstance(wrapup_node, dict):
                        task_messages = wrapup_node.get("task_messages")
                        if isinstance(task_messages, list):
                            for entry in task_messages:
                                if not isinstance(entry, dict):
                                    continue
                                content = entry.get("content")
                                if isinstance(content, str) and content.strip():
                                    prompt = content.strip()
                                    break

        return prompt or get_default_wrapup_prompt()

    def _extract_beat_plans(self, beats: Iterable[Any]) -> List[BeatPlan]:
        beat_items = list(beats)
        plans: List[BeatPlan] = []

        for idx, beat in enumerate(beat_items):
            if not isinstance(beat, Mapping):
                continue

            message = beat.get("message")
            start_time = beat.get("start_time", 0)
            if not isinstance(message, str) or not message.strip():
                continue
            if not isinstance(start_time, (int, float)) or start_time < 0:
                continue

            next_start = self._find_next_start(beat_items, idx + 1)
            plans.append(
                BeatPlan(
                    message=message.strip(),
                    start_time=float(start_time),
                    next_start_time=next_start,
                )
            )

        return plans

    def _find_next_start(self, beat_items: List[Any], start_index: int) -> Optional[float]:
        for entry in beat_items[start_index:]:
            if not isinstance(entry, Mapping):
                continue
            next_message = entry.get("message")
            next_start_candidate = entry.get("start_time", 0)
            if (
                isinstance(next_message, str)
                and next_message.strip()
                and isinstance(next_start_candidate, (int, float))
                and next_start_candidate >= 0
            ):
                return float(next_start_candidate)
        return None

    def _get_running_loop(self) -> Optional[asyncio.AbstractEventLoop]:
        try:
            return asyncio.get_running_loop()
        except RuntimeError:
            return None

    def _loop_time(self, loop: asyncio.AbstractEventLoop) -> float:
        try:
            return loop.time()
        except Exception:
            return time.monotonic()

    def _current_elapsed(self, loop: asyncio.AbstractEventLoop) -> float:
        if self._call_start_time is None:
            self._call_start_time = self._loop_time(loop)
        return max(self._loop_time(loop) - self._call_start_time, 0.0)


__all__ = ["FlowPacingController"]
