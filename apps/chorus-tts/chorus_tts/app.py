# SPDX-License-Identifier: MIT
"""ASGI application factory for the Chorus TTS websocket service.

The application attaches shared dependencies (settings, voice registry, and
engine) to `app.state` so request handlers can access them without repeated
initialisation.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from inspect import iscoroutine
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, WebSocket, status
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.websockets import WebSocketDisconnect
from structlog.stdlib import BoundLogger, get_logger

from .asyncapi_docs import attach_asyncapi_doc
from .asyncapi_registry import STREAM_INPUT_CHANNEL
from .auth import APIKeyAuth, AuthenticationError
from .config import Settings
from .kokoro_engine import KokoroEngine
from .logging_config import configure_logging
from .schemas import (
    AudioOutputEvent,
    ConnectedEvent,
    ErrorEvent,
    FinalOutputEvent,
    HandshakeParams,
    OutputFormat,
)
from .session import GenerationSession, PendingSegment, SessionError
from .voices import VoiceInfo, VoiceRegistry

SegmentConsumer = Callable[
    [WebSocket, GenerationSession, list[PendingSegment]],
    Awaitable[None] | None,
]


async def _send_event(websocket: WebSocket, event: BaseModel) -> None:
    """Serialise and send a websocket event payload."""
    await websocket.send_json(
        event.model_dump(mode="json", by_alias=True, exclude_none=True),
    )


def create_app(
    settings: Settings,
    *,
    voice_registry: VoiceRegistry | None = None,
    engine: KokoroEngine | None = None,
    on_segments_ready: SegmentConsumer | None = None,
    documentation_dir: Path | None = None,
) -> FastAPI:
    """Build the FastAPI application using provided dependencies.

    Args:
        settings: Validated application settings.
        voice_registry: Optional pre-built voice registry (useful for tests).
        engine: Optional KokoroEngine instance (can be mocked in tests).
        on_segments_ready: Optional callback invoked whenever buffered text is
            ready to be synthesized. Tests can inject a collector; production
            will integrate this with streaming in a later milestone.
        documentation_dir: Optional override for the generated AsyncAPI assets
            directory. Tests can supply a temporary path to avoid touching the
            repository tree.

    Returns:
        Configured FastAPI application with a `/healthz` endpoint.

    """
    registry = voice_registry or VoiceRegistry(
        default_voice_id=settings.default_voice_id,
    )
    engine_instance = engine or KokoroEngine(settings, registry)

    configure_logging(settings.log_level)
    api_auth = APIKeyAuth(settings)
    logger = get_logger("chorus_tts.websocket")

    @asynccontextmanager
    async def lifespan(
        _: FastAPI,
    ) -> AsyncIterator[None]:  # pragma: no cover - startup hook
        await _warmup_engine(engine_instance, registry, logger)
        yield

    app = FastAPI(title="Chorus TTS", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.voice_registry = registry
    app.state.engine = engine_instance

    segment_consumer = on_segments_ready or _build_default_consumer(
        engine_instance,
        logger,
    )

    project_root = Path(__file__).resolve().parent.parent
    docs_dir = documentation_dir or project_root / "var" / "asyncapi"
    _attach_documentation_routes(app, docs_dir)

    @app.get("/healthz", tags=["health"])
    async def healthcheck() -> dict[str, str]:
        return {"status": "ok"}

    @attach_asyncapi_doc(STREAM_INPUT_CHANNEL)
    @app.websocket("/v1/text-to-speech/{voice_id}/stream-input")
    async def websocket_stream(
        websocket: WebSocket,
        voice_id: str,
        params: HandshakeParams = Depends(),
    ) -> None:
        if not await _authenticate_connection(api_auth, websocket):
            return

        voice_resolution = await _resolve_voice(registry, websocket, voice_id)
        if voice_resolution is None:
            return
        resolved_voice_id, voice_info = voice_resolution

        if not await _ensure_supported_format(websocket, params):
            return

        session = GenerationSession(
            settings=settings,
            handshake_auto_mode=params.auto_mode,
            voice_info=voice_info,
        )

        connection_logger = await _initialise_session_state(
            websocket,
            params=params,
            resolved_voice_id=resolved_voice_id,
            voice_info=voice_info,
            logger=logger,
        )

        await _run_session_loop(
            websocket,
            session=session,
            segment_consumer=segment_consumer,
            inactivity_timeout=settings.inactivity_timeout,
            logger=connection_logger,
        )

    return app


def _attach_documentation_routes(app: FastAPI, generated_docs_dir: Path) -> None:
    """Expose documentation endpoints for OpenAPI and AsyncAPI artifacts."""
    asyncapi_spec_path = generated_docs_dir / "asyncapi.yaml"
    asyncapi_html_dir = generated_docs_dir / "html"

    @app.get("/asyncapi.yaml", include_in_schema=False)
    async def serve_asyncapi_spec() -> FileResponse:
        if not asyncapi_spec_path.exists():
            message = (
                "AsyncAPI spec not generated. Run scripts/build_asyncapi.py first."
            )
            raise HTTPException(status_code=404, detail=message)
        return FileResponse(asyncapi_spec_path)

    if asyncapi_html_dir.exists():
        app.mount(
            "/asyncapi",
            StaticFiles(directory=asyncapi_html_dir, html=True),
            name="asyncapi",
        )

    @app.get("/documentation", include_in_schema=False)
    async def documentation_index() -> HTMLResponse:
        links: list[tuple[str, str, str]] = [
            ("Swagger UI", "/docs", "Generated reference for HTTP endpoints."),
            ("ReDoc", "/redoc", "Alternate rendering for the OpenAPI schema."),
        ]
        if asyncapi_spec_path.exists():
            links.append(
                (
                    "AsyncAPI Spec",
                    "/asyncapi.yaml",
                    "YAML description of the websocket streaming contract.",
                ),
            )
        if asyncapi_html_dir.exists():
            links.append(
                (
                    "AsyncAPI Viewer",
                    "/asyncapi",
                    "Static site generated from the AsyncAPI document.",
                ),
            )

        list_items = "".join(
            f'<li><a href="{href}">{label}</a> - {description}</li>'
            for label, href, description in links
        )
        body = (
            "<html><head><title>Chorus TTS Docs</title></head><body>"
            "<h1>Documentation</h1>"
            "<p>Select a viewer:</p>"
            f"<ul>{list_items}</ul>"
            "</body></html>"
        )
        return HTMLResponse(content=body)


async def _warmup_engine(
    engine: KokoroEngine,
    registry: VoiceRegistry,
    logger: BoundLogger,
) -> None:
    """Run a lightweight warmup through the engine's session pool."""
    try:
        logger.info("warmup_start")
        warmed = await engine.warm_pool(
            text="hello ",
            voice_id=registry.default_voice_id,
            speed=1.0,
            lang="en-us",
            trim=True,
        )
        logger.info("warmup_complete", sessions=warmed)
    except Exception as exc:  # noqa: BLE001 pragma: no cover - best-effort warmup
        logger.warning("warmup_skipped", error=str(exc))


def _build_default_consumer(
    engine: KokoroEngine,
    logger: BoundLogger,
) -> SegmentConsumer:
    async def default_consumer(
        websocket: WebSocket,
        session: GenerationSession,
        segments: list[PendingSegment],
    ) -> None:
        connection_logger: BoundLogger = getattr(websocket.state, "logger", logger)
        chunk_index = getattr(websocket.state, "chunk_index", 0)
        total_samples = getattr(websocket.state, "total_samples", 0)
        last_rate = getattr(websocket.state, "last_sample_rate", None)
        handshake = getattr(websocket.state, "handshake", None)
        lang = (
            getattr(handshake, "language_code", None)
            or session.voice_info.language_code
        )

        for segment in segments:
            (
                chunk_index,
                total_samples,
                last_rate,
            ) = await _stream_pending_segment(
                engine,
                websocket,
                session,
                segment,
                lang,
                connection_logger,
                chunk_index,
                total_samples,
                last_rate,
            )

        websocket.state.chunk_index = chunk_index
        websocket.state.total_samples = total_samples
        websocket.state.last_sample_rate = last_rate

    return default_consumer


async def _stream_pending_segment(
    engine: KokoroEngine,
    websocket: WebSocket,
    session: GenerationSession,
    segment: PendingSegment,
    lang: str,
    logger: BoundLogger,
    chunk_index: int,
    total_samples: int,
    last_rate: int | None,
) -> tuple[int, int, int | None]:
    try:
        async for chunk in engine.stream_text(
            text=segment.text,
            voice_id=websocket.state.voice_id,
            speed=session.voice_speed,
            lang=lang,
            is_phonemes=False,
            trim=True,
        ):
            chunk_index += 1
            total_samples += len(chunk.pcm) // 2
            last_rate = chunk.sample_rate
            await _send_event(
                websocket,
                AudioOutputEvent(
                    event="audioOutput",
                    chunk_index=chunk_index,
                    audio=chunk.as_base64(),
                    sample_rate=chunk.sample_rate,
                    isFinal=False,
                    segment_reason=segment.reason,
                ),
            )
            websocket.state.last_activity = time.monotonic()
            logger.debug(
                "streamed_chunk",
                chunk_index=chunk_index,
                segment_reason=segment.reason,
                samples=len(chunk.pcm) // 2,
            )
    except Exception as exc:  # pragma: no cover - escalates to caller
        await _send_event(
            websocket,
            ErrorEvent(
                event="error",
                code="error.engine_failure",
                message=str(exc),
                retryable=False,
            ),
        )
        await websocket.close(code=4000)
        raise

    return chunk_index, total_samples, last_rate


async def _authenticate_connection(api_auth: APIKeyAuth, websocket: WebSocket) -> bool:
    try:
        api_auth.authenticate_websocket(websocket)
        return True
    except AuthenticationError:
        await _reject_handshake(
            websocket,
            error_code="error.unauthorized",
            message="Invalid API key.",
            close_code=status.WS_1008_POLICY_VIOLATION,
        )
        return False


async def _resolve_voice(
    registry: VoiceRegistry,
    websocket: WebSocket,
    voice_id: str,
) -> tuple[str, VoiceInfo] | None:
    try:
        return registry.resolve(voice_id)
    except KeyError:
        await _reject_handshake(
            websocket,
            error_code="error.voice_not_found",
            message=f"Voice '{voice_id}' not supported.",
            close_code=4000,
        )
        return None


async def _ensure_supported_format(
    websocket: WebSocket,
    params: HandshakeParams,
) -> bool:
    if params.output_format in (OutputFormat.PCM_22050, OutputFormat.PCM_24000):
        return True

    await _reject_handshake(
        websocket,
        error_code="error.unsupported_output_format",
        message=f"Output format {params.output_format.value} not supported.",
        close_code=4000,
    )
    return False


async def _initialise_session_state(
    websocket: WebSocket,
    *,
    params: HandshakeParams,
    resolved_voice_id: str,
    voice_info: VoiceInfo,
    logger: BoundLogger,
) -> BoundLogger:
    await websocket.accept()
    session_id = str(uuid4())
    websocket.state.session_id = session_id
    websocket.state.voice_id = resolved_voice_id
    websocket.state.handshake = params
    websocket.state.chunk_index = 0
    websocket.state.total_samples = 0
    websocket.state.last_sample_rate = None
    websocket.state.last_activity = time.monotonic()

    await _send_event(
        websocket,
        ConnectedEvent(
            event="connected",
            session_id=session_id,
            voice_id=resolved_voice_id,
            language_code=voice_info.language_code,
            output_format=params.output_format,
        ),
    )

    bound_logger = logger.bind(
        session_id=session_id,
        voice_id=resolved_voice_id,
    )
    websocket.state.logger = bound_logger

    bound_logger.info(
        "websocket_connected",
        auto_mode=params.auto_mode,
    )

    return bound_logger


async def _run_session_loop(
    websocket: WebSocket,
    *,
    session: GenerationSession,
    segment_consumer: SegmentConsumer,
    inactivity_timeout: int,
    logger: BoundLogger,
) -> None:
    inactivity_task = asyncio.create_task(
        _inactivity_watchdog(websocket, inactivity_timeout, logger),
    )

    try:
        while True:
            try:
                payload = await websocket.receive_json()
            except WebSocketDisconnect:
                break

            websocket.state.last_activity = time.monotonic()

            try:
                outcome = session.process_payload(payload)
            except SessionError as exc:
                await _close_due_to_session_error(websocket, str(exc))
                break

            if outcome.initialized_now:
                continue

            if outcome.segments:
                try:
                    await _maybe_consume_segments(
                        segment_consumer,
                        websocket,
                        session,
                        outcome.segments,
                    )
                except WebSocketDisconnect:
                    break
                except Exception:
                    inactivity_task.cancel()
                    logger.exception("session_loop_unhandled_error")
                    return

            if outcome.close_connection:
                await _send_final_output(websocket, logger)
                break
    finally:
        inactivity_task.cancel()
        with suppress(asyncio.CancelledError):
            await inactivity_task


async def _close_due_to_session_error(websocket: WebSocket, message: str) -> None:
    await _send_event(
        websocket,
        ErrorEvent(
            event="error",
            code="error.invalid_request",
            message=message,
            retryable=False,
        ),
    )
    await websocket.close(code=4000)


async def _reject_handshake(
    websocket: WebSocket,
    *,
    error_code: str,
    message: str,
    close_code: int,
) -> None:
    await websocket.accept()
    await _send_event(
        websocket,
        ErrorEvent(
            event="error",
            code=error_code,
            message=message,
            retryable=False,
        ),
    )
    await websocket.close(code=close_code)


async def _maybe_consume_segments(
    consumer: SegmentConsumer,
    websocket: WebSocket,
    session: GenerationSession,
    segments: list[PendingSegment],
) -> None:
    result = consumer(websocket, session, segments)
    if result is None:
        return
    if iscoroutine(result):
        await result


async def _send_final_output(websocket: WebSocket, logger: BoundLogger) -> None:
    chunk_index = getattr(websocket.state, "chunk_index", 0)
    total_samples = getattr(websocket.state, "total_samples", 0)
    sample_rate = getattr(websocket.state, "last_sample_rate", None)
    duration_ms = int(total_samples / sample_rate * 1000) if sample_rate else 0

    logger.info(
        "session_completed",
        chunks=chunk_index,
        duration_ms=duration_ms,
    )

    await _send_event(
        websocket,
        FinalOutputEvent(
            event="finalOutput",
            isFinal=True,
            chunks=chunk_index,
            duration_ms=duration_ms,
        ),
    )
    await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)


async def _inactivity_watchdog(
    websocket: WebSocket,
    timeout: int,
    logger: BoundLogger,
) -> None:
    try:
        while True:
            await asyncio.sleep(timeout)
            last = getattr(websocket.state, "last_activity", None)
            if last is None:
                continue
            if time.monotonic() - last >= timeout:
                logger.info("closing_idle_websocket")
                await _send_event(
                    websocket,
                    ErrorEvent(
                        event="error",
                        code="error.inactivity_timeout",
                        message="Connection closed due to inactivity.",
                        retryable=True,
                    ),
                )
                await websocket.close(code=status.WS_1001_GOING_AWAY)
                break
    except asyncio.CancelledError:  # pragma: no cover
        return
