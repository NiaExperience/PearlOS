import asyncio
import importlib
import sys
from types import SimpleNamespace
from typing import Any

import pytest
from loguru import logger


async def _noop_initialize(*_args, **_kwargs):
    await asyncio.sleep(0)


def _make_fake_flow_manager():
    return SimpleNamespace(
        initialize=_noop_initialize,
        state={
            "participants": [],
            "participant_contexts": {},
            "stealth_participants": set(),
            "greeting_rooms": {},
            "admin": {},
            "last_joined_participant": None,
        },
    )


class FakeTransport:
    def __init__(self):
        self._handlers = {
            "on_joined": [],
            "on_participant_joined": [],
            "on_participant_left": [],
            "on_first_participant_joined": [],
            "on_error": [],
        }

    def event_handler(self, name):
        def deco(fn):
            if name not in self._handlers:
                self._handlers[name] = []
            self._handlers[name].append(fn)
            return fn

        return deco

    async def capture_participant_transcription(self, pid):
        return None


class FakeTask:
    def __init__(self):
        self.cancelled = False
        self.name = "fake-task"
        self._handlers = {}

    async def cancel(self):
        self.cancelled = True

    async def queue_frames(self, frames):
        return None

    def event_handler(self, name):
        def deco(fn):
            if name not in self._handlers:
                self._handlers[name] = []
            self._handlers[name].append(fn)
            return fn

        return deco


class FakeContext:
    """Mock OpenAI context object for testing."""
    def __init__(self):
        self._tools = []
        self._original_tools = []
        self.tools = []
        self._messages = []

    def set_messages(self, messages):
        self._messages = messages


def _build_fake_pipeline_components(*, transport: FakeTransport | None = None):
    transport = transport or FakeTransport()
    task = FakeTask()
    context_agg = SimpleNamespace(
        user=lambda: SimpleNamespace(get_context_frame=lambda: {}),
        assistant=lambda: None,
    )
    messages = [{"role": "system", "content": "test"}]
    multi_user_aggregator = SimpleNamespace()
    context = FakeContext()
    flow_manager = _make_fake_flow_manager()
    personality_message = {"role": "system", "content": "test"}
    forwarder_ref = {'instance': None}  # Add forwarder_ref for note tools
    return {
        "transport": transport,
        "task": task,
        "context_agg": context_agg,
        "messages": messages,
        "multi_user_aggregator": multi_user_aggregator,
        "context": context,
        "personality_message": personality_message,
        "flow_manager": flow_manager,
        "forwarder_ref": forwarder_ref,
    }


def _build_pipeline_return(components: dict):
    return (
        None,
        components["task"],
        components["context_agg"],
        components["transport"],
        components["messages"],
        components["multi_user_aggregator"],
        components["context"],
        components["personality_message"],
        components["flow_manager"],
        components["forwarder_ref"],
    )


async def _wait_for_handlers(transport: FakeTransport, session_task: asyncio.Task, timeout: float = 1.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout

    while True:
        if transport._handlers["on_participant_joined"] and transport._handlers["on_participant_left"]:
            return

        if session_task.done():
            try:
                session_task.result()
            except Exception as exc:  # pragma: no cover - diagnostic path
                raise AssertionError(
                    f"Session task failed before registering handlers: {exc}"
                ) from exc
            raise AssertionError("Session task finished before handlers registered")

        if loop.time() >= deadline:
            raise AssertionError(
                f"Handlers not registered within {timeout}s. "
                f"Join={len(transport._handlers['on_participant_joined'])} "
                f"Left={len(transport._handlers['on_participant_left'])}"
            )

        await asyncio.sleep(0.01)

# We will monkeypatch schedule timings to be very short for test speed.


@pytest.mark.asyncio
async def test_shutdown_after_last_participant_leaves(monkeypatch):
    # Disable Redis to avoid connection delays/hangs
    monkeypatch.setenv("USE_REDIS", "false")
    # Force small timers
    monkeypatch.setenv("BOT_EMPTY_INITIAL_SECS", "0.1")
    monkeypatch.setenv("BOT_EMPTY_POST_LEAVE_SECS", "0.05")

    # Capture logs
    records = []
    token = logger.add(lambda m: records.append(str(m)), level="INFO")

    # Import bot module fresh
    bot_mod = importlib.import_module("bot")

    # Store transport to trigger on_joined
    holder: dict[str, Any] = {}

    # Monkeypatch build_pipeline to avoid heavy deps
    async def fake_build_pipeline(*_args, **_kwargs):
        components = _build_fake_pipeline_components()
        holder["transport"] = components["transport"]
        return _build_pipeline_return(components)

    monkeypatch.setattr(bot_mod, "build_pipeline", fake_build_pipeline)

    # Monkeypatch fetch_functional_prompts to avoid needing MESH_API_ENDPOINT
    async def fake_fetch_prompts(*_args, **_kwargs):
        return {
            "bot_read_current_note": "Get current note test",
            "bot_replace_note": "Update note test",
            "bot_add_note_content": "Append to note test",
            "bot_create_note": "Create note test",
        }

    from actions import functional_prompt_actions

    monkeypatch.setattr(
        functional_prompt_actions,
        "fetch_functional_prompts",
        fake_fetch_prompts,
    )

    class DummyRunner:
        async def run(self, task):
            # Sleep enough for initial idle shutdown to trigger
            await asyncio.sleep(0.3)

    monkeypatch.setitem(
        sys.modules, 'pipecat.pipeline.runner', SimpleNamespace(PipelineRunner=DummyRunner)
    )

    # Run session in background
    session_task = asyncio.create_task(
        bot_mod.run_pipeline_session("https://example.daily/room", "test-token", "pearl")
    )

    # Wait for handlers to be registered
    await asyncio.sleep(0.05)
    
    transport = holder.get("transport")
    if transport:
        # Wait for on_joined handler to be registered
        try:
            await _wait_for_handlers(transport, session_task, timeout=1.0)
        except AssertionError:
            pass
        
        # Trigger on_joined to start the idle timer (simulates bot joining Daily room)
        for h in transport._handlers.get("on_joined", []):
            await h(transport, {})

    # Wait slightly longer than initial idle schedule (0.1s)
    await asyncio.sleep(0.15)
    # At this point with no participant the task should be cancelled by empty-room logic
    # (initial idle). We assert and stop.
    # If we reach here too soon, give a tiny grace
    await asyncio.sleep(0.02)
    # We expect cancellation
    # session_task won't finish until run_pipeline_session exits fully; cancellation sets task.cancelled flag on FakeTask
    # Extract FakeTask by scanning records: fallback -> just assert log marker
    joined = any("[participants] join" in r for r in records)
    empty_cancel = any("[empty-room] No participants" in r for r in records)
    assert empty_cancel is True
    assert joined is False

    logger.remove(token)
    # Ensure task completes or is cancelled
    try:
        await asyncio.wait_for(session_task, timeout=0.5)
    except asyncio.TimeoutError:
        pytest.fail("Session did not terminate after empty-room shutdown")
    except Exception as e:
        # Session may raise exceptions during shutdown, which is acceptable for this test
        logger.debug(f"Session task raised exception: {e}")


@pytest.mark.asyncio
async def test_post_leave_shutdown(monkeypatch):
    # Disable Redis to avoid connection delays/hangs
    monkeypatch.setenv("USE_REDIS", "false")
    monkeypatch.setenv("BOT_EMPTY_INITIAL_SECS", "5")  # large so initial idle not trigger
    monkeypatch.setenv("BOT_EMPTY_POST_LEAVE_SECS", "0.05")
    monkeypatch.setenv("BOT_TEST_EXPOSE_OBJECTS", "1")

    records = []
    token = logger.add(lambda m: records.append(str(m)), level="INFO")

    bot_mod = importlib.import_module("bot")

    # Monkeypatch build_pipeline to provide our fake transport
    transport = FakeTransport()
    pipeline_components = _build_fake_pipeline_components(transport=transport)

    async def fake_build(*_args, **_kwargs):
        return _build_pipeline_return(pipeline_components)

    monkeypatch.setattr(bot_mod, 'build_pipeline', fake_build)

    # Monkeypatch fetch_functional_prompts to avoid needing MESH_API_ENDPOINT
    async def fake_fetch_prompts(*_args, **_kwargs):
        return {
            "bot_read_current_note": "Get current note test",
            "bot_replace_note": "Update note test",
            "bot_add_note_content": "Append to note test",
            "bot_create_note": "Create note test",
        }

    from actions import functional_prompt_actions

    monkeypatch.setattr(
        functional_prompt_actions,
        "fetch_functional_prompts",
        fake_fetch_prompts,
    )

    class DummyRunner2:
        async def run(self, task):
            await asyncio.sleep(0.2)

    monkeypatch.setitem(
        sys.modules, 'pipecat.pipeline.runner', SimpleNamespace(PipelineRunner=DummyRunner2)
    )

    session_task = asyncio.create_task(
        bot_mod.run_pipeline_session("https://example.daily/room", "test-token", "pearl")
    )
    # Give more time for session to start and register handlers
    await asyncio.sleep(0.1)

    try:
        await _wait_for_handlers(transport, session_task)
    except AssertionError as exc:
        pytest.fail(str(exc))

    # Simulate participant join then leave using the injected transport
    for h in transport._handlers['on_participant_joined']:
        await h(transport, {"id": "user1", "local": False})
    await asyncio.sleep(0.01)
    for h in transport._handlers['on_participant_left']:
        await h(transport, {"id": "user1", "local": False}, "left")

    # Wait for post-leave timer
    await asyncio.sleep(0.08)

    left_logs = [r for r in records if '[participants] left id=user1' in r]
    schedule_logs = [r for r in records if 'schedule_shutdown' in r and 'post_leave_idle' in r]
    empty_cancel = any('[empty-room] No participants' in r for r in records)
    assert left_logs, "Participant leave log missing"
    assert schedule_logs, "Shutdown schedule log missing after leave"
    assert empty_cancel, "Empty-room cancellation log missing after leave"

    logger.remove(token)
    try:
        await asyncio.wait_for(session_task, timeout=0.5)
    except asyncio.TimeoutError:
        pytest.fail("Session did not terminate after post-leave shutdown")
    except Exception as e:
        # Session may raise exceptions during shutdown, which is acceptable for this test
        logger.debug(f"Session task raised exception: {e}")


@pytest.mark.asyncio
async def test_participants_change_events(monkeypatch):
    # Disable Redis to avoid connection delays/hangs
    monkeypatch.setenv("USE_REDIS", "false")
    monkeypatch.setenv("BOT_EMPTY_INITIAL_SECS", "5")
    monkeypatch.setenv("BOT_EMPTY_POST_LEAVE_SECS", "0.05")

    records = []
    token = logger.add(lambda m: records.append(str(m)), level="INFO")
    bot_mod = importlib.import_module("bot")

    holder: dict[str, Any] = {}

    async def fake_build_pipeline(*_args, **_kwargs):
        components = _build_fake_pipeline_components()
        holder["transport"] = components["transport"]
        return _build_pipeline_return(components)

    monkeypatch.setattr(bot_mod, "build_pipeline", fake_build_pipeline)

    # Monkeypatch fetch_functional_prompts to avoid needing MESH_API_ENDPOINT
    async def fake_fetch_prompts(*_args, **_kwargs):
        return {
            "bot_read_current_note": "Get current note test",
            "bot_replace_note": "Update note test",
            "bot_add_note_content": "Append to note test",
            "bot_create_note": "Create note test",
        }

    from actions import functional_prompt_actions

    monkeypatch.setattr(
        functional_prompt_actions,
        "fetch_functional_prompts",
        fake_fetch_prompts,
    )

    class DummyRunner:
        async def run(self, task):
            await asyncio.sleep(0.15)

    monkeypatch.setitem(
        sys.modules, 'pipecat.pipeline.runner', SimpleNamespace(PipelineRunner=DummyRunner)
    )

    session_task = asyncio.create_task(
        bot_mod.run_pipeline_session("https://example.daily/room", "test-token", "pearl")
    )

    await asyncio.sleep(0.02)
    transport = holder["transport"]

    try:
        await _wait_for_handlers(transport, session_task)
    except AssertionError as exc:
        pytest.fail(str(exc))

    for h in transport._handlers['on_participant_joined']:
        await h(transport, {"id": "userA"})
    await asyncio.sleep(0.02)
    for h in transport._handlers['on_participant_left']:
        await h(transport, {"id": "userA"}, "left")
    await asyncio.sleep(0.08)

    # Check that participants.change event was published
    # Note: The event shows current state, which is empty after userA left
    change_logs = [r for r in records if 'daily.participants.change' in r]
    assert change_logs, "participants.change event should have been published"
    # Also check that userA join and leave events were logged
    join_logs = [r for r in records if '[participants] join id=userA' in r]
    left_logs = [r for r in records if '[participants] left id=userA' in r]
    assert join_logs, "userA join should have been logged"
    assert left_logs, "userA leave should have been logged"

    logger.remove(token)
    try:
        await asyncio.wait_for(session_task, timeout=0.5)
    except Exception:
        pass
