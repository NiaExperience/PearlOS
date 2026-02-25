"""Integration tests for the websocket application layer."""

from __future__ import annotations

import time
from pathlib import Path
from typing import ClassVar

import pytest
from chorus_tts.app import create_app
from chorus_tts.auth import APIKeyAuth, AuthenticationError
from chorus_tts.config import Settings
from chorus_tts.session import PendingSegment
from chorus_tts.voices import VoiceRegistry
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect


class DummyEngine:
    """Minimal stub satisfying the engine interface."""


def create_settings(tmp_path: Path) -> Settings:
    """Construct Settings backed by temporary model and voice files."""
    model = tmp_path / "model.onnx"
    voices = tmp_path / "voices.npy"
    model.write_bytes(b"onnx")
    voices.write_bytes(b"voices")
    return Settings(
        model_path=model,
        voices_path=voices,
        api_keys=("test",),
        chunk_length_schedule=(80, 120, 180),
        default_voice_id="af_alloy",
    )


def test_health_endpoint(tmp_path: Path) -> None:
    """Serve health endpoint and populate FastAPI state."""
    settings = create_settings(tmp_path)
    registry = VoiceRegistry(default_voice_id=settings.default_voice_id)
    app = create_app(settings, voice_registry=registry, engine=DummyEngine())

    client = TestClient(app)
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert app.state.settings is settings
    assert app.state.voice_registry is registry
    assert isinstance(app.state.engine, DummyEngine)


def test_asyncapi_spec_served(tmp_path: Path) -> None:
    """Serve AsyncAPI document when artifact is available."""
    settings = create_settings(tmp_path)
    generated_docs = tmp_path / "asyncapi_docs"
    spec_path = generated_docs / "asyncapi.yaml"
    generated_docs.mkdir(parents=True, exist_ok=True)
    spec_path.write_text("channels: {}\n", encoding="utf-8")
    app = create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        documentation_dir=generated_docs,
    )
    client = TestClient(app)

    response = client.get("/asyncapi.yaml")

    assert response.status_code == 200
    assert "channels:" in response.text


def test_asyncapi_spec_missing_returns_not_found(tmp_path: Path) -> None:
    """Return 404 when AsyncAPI artifact has not been generated."""
    import chorus_tts.app as app_module

    generated_docs = tmp_path / "asyncapi_docs"
    settings = create_settings(tmp_path)
    app = app_module.create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        documentation_dir=generated_docs,
    )
    client = TestClient(app)

    response = client.get("/asyncapi.yaml")

    assert response.status_code == 404
    assert "AsyncAPI spec not generated" in response.text


def test_asyncapi_viewer_serves_generated_assets_only(tmp_path: Path) -> None:
    """Expose AsyncAPI viewer assets from generated directory instead of docs/."""
    generated_docs = tmp_path / "asyncapi_docs"
    generated_html = generated_docs / "html"
    generated_html.mkdir(parents=True, exist_ok=True)
    viewer_file = generated_html / "index.html"
    viewer_file.write_text("<html>viewer</html>", encoding="utf-8")

    stray_dir = tmp_path / "docs" / "asyncapi_html"
    stray_dir.mkdir(parents=True, exist_ok=True)
    stray_file = stray_dir / "internal-notes.txt"
    stray_file.write_text("internal", encoding="utf-8")

    settings = create_settings(tmp_path)
    app = create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        documentation_dir=generated_docs,
    )
    client = TestClient(app)

    viewer_response = client.get("/asyncapi/index.html")
    assert viewer_response.status_code == 200
    assert "viewer" in viewer_response.text

    stray_response = client.get("/asyncapi/internal-notes.txt")
    assert stray_response.status_code == 404


@pytest.mark.parametrize(
    ("spec_exists", "html_exists", "expected_links"),
    [
        (
            True,
            True,
            ["/asyncapi.yaml", "/asyncapi"],
        ),
        (
            False,
            False,
            [],
        ),
    ],
)
def test_documentation_index_reflects_available_assets(
    tmp_path: Path,
    *,
    spec_exists: bool,
    html_exists: bool,
    expected_links: list[str],
) -> None:
    """Render documentation index with dynamic AsyncAPI links."""
    import chorus_tts.app as app_module

    generated_docs = tmp_path / "asyncapi_docs"
    spec_path = generated_docs / "asyncapi.yaml"
    html_path = generated_docs / "html"

    if spec_exists:
        spec_path.parent.mkdir(parents=True, exist_ok=True)
        spec_path.write_text("channels: {}\n", encoding="utf-8")
    if html_exists:
        html_path.mkdir(parents=True, exist_ok=True)
        (html_path / "index.html").write_text("<html></html>", encoding="utf-8")

    settings = create_settings(tmp_path)
    app = app_module.create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        documentation_dir=generated_docs,
    )
    client = TestClient(app)

    response = client.get("/documentation")

    assert response.status_code == 200
    for link in expected_links:
        assert link in response.text
    absent_links = {"/asyncapi.yaml", "/asyncapi"} - set(expected_links)
    for link in absent_links:
        assert link not in response.text


def test_websocket_requires_api_key(tmp_path: Path) -> None:
    """Reject websocket connections that omit authentication."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect("/v1/text-to-speech/af_alloy/stream-input") as ws:
        message = ws.receive_json()
        assert message["event"] == "error"
        assert message["code"] == "error.unauthorized"

        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 1008


def test_websocket_rejects_invalid_key(tmp_path: Path) -> None:
    """Reject websocket connections with an invalid API key."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=wrong",
    ) as ws:
        message = ws.receive_json()
        assert message["event"] == "error"
        assert message["code"] == "error.unauthorized"

        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 1008


def test_websocket_rejects_output_format(tmp_path: Path) -> None:
    """Decline websockets requesting unsupported audio formats."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    # FastAPI validates Enum values during handshake and closes with 1008 if invalid
    with (
        pytest.raises(WebSocketDisconnect) as exc,
        client.websocket_connect(
            "/v1/text-to-speech/af_alloy/stream-input?api_key=test&output_format=pcm_99999",
        ) as ws,
    ):
        ws.receive_json()

    assert exc.value.code == 1008


def test_websocket_accepts_pcm_24000(tmp_path: Path) -> None:
    """Accept websockets requesting pcm_24000 audio format."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test&output_format=pcm_24000",
    ) as ws:
        message = ws.receive_json()
        assert message["event"] == "connected"
        assert message["output_format"] == "pcm_24000"
        ws.close()


def test_api_key_extraction_priority(tmp_path: Path) -> None:
    """Prefer xi-api-key header over other credential sources."""
    settings = create_settings(tmp_path)
    auth = APIKeyAuth(settings)

    class FakeHeaders(dict):
        def get(self, key, default=None):
            return super().get(key.lower(), default)

    class FakeWebSocket:
        def __init__(self):
            self.headers = FakeHeaders(
                {
                    "xi-api-key": " test ",
                    "authorization": "Bearer should-not-be-used",
                },
            )
            self.query_params = {"api_key": "ignore-me"}

    token = auth.authenticate_websocket(FakeWebSocket())
    assert token == "test"  # noqa: S105 - fixture uses static token


def test_api_key_auth_missing_header(tmp_path: Path) -> None:
    """Raise when all credential sources are absent."""
    settings = create_settings(tmp_path)
    auth = APIKeyAuth(settings)

    class FakeWebSocket:
        def __init__(self):
            self.headers = {}
            self.query_params = {}

    with pytest.raises(AuthenticationError):
        auth.authenticate_websocket(FakeWebSocket())


def test_api_key_auth_invalid_key(tmp_path: Path) -> None:
    """Reject when credential does not match configured keys."""
    settings = create_settings(tmp_path)
    auth = APIKeyAuth(settings)

    class FakeWebSocket:
        def __init__(self):
            self.headers = {"xi-api-key": "wrong"}
            self.query_params = {}

    with pytest.raises(AuthenticationError):
        auth.authenticate_websocket(FakeWebSocket())


@pytest.mark.asyncio
async def test_api_key_auth_accepts_bearer_header(tmp_path: Path) -> None:
    """Allow Bearer tokens when header is present."""
    settings = create_settings(tmp_path)
    auth = APIKeyAuth(settings)

    class FakeWebSocket:
        headers: ClassVar[dict[str, str]] = {}
        query_params: ClassVar[dict[str, str]] = {}

    token = await auth(
        FakeWebSocket(),
        xi_api_key=None,
        authorization="Bearer test",
        api_key=None,
    )
    assert token == "test"  # noqa: S105 - fixture uses static token


def test_websocket_generates_segments(tmp_path: Path) -> None:
    """Stream text and generate an automatic audio segment."""
    settings = create_settings(tmp_path)
    registry = VoiceRegistry()
    recorded: list[PendingSegment] = []

    async def recorder(_ws, _session, segments: list[PendingSegment]) -> None:
        recorded.extend(segments)

    app = create_app(
        settings,
        voice_registry=registry,
        engine=DummyEngine(),
        on_segments_ready=recorder,
    )
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        connected = ws.receive_json()
        assert connected["event"] == "connected"

        ws.send_json({"text": " "})  # initialize
        ws.send_json({"text": "a" * 80 + " "})  # triggers first schedule threshold
        ws.send_json({"text": ""})  # close connection
        final = ws.receive_json()
        assert final["event"] == "finalOutput"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 1000
    assert len(recorded) == 1
    assert recorded[0].text == "a" * 80
    assert recorded[0].is_final is False
    assert recorded[0].reason == "auto"


def test_flush_triggers_generation(tmp_path: Path) -> None:
    """Flush flag should force segment emission."""
    settings = create_settings(tmp_path)
    recorded: list[PendingSegment] = []

    def recorder(_ws, _session, segments: list[PendingSegment]) -> None:
        recorded.extend(segments)

    app = create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        on_segments_ready=recorder,
    )
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        ws.receive_json()
        ws.send_json({"text": " "})
        ws.send_json({"text": "short ", "flush": True})
        ws.send_json({"text": ""})
        final = ws.receive_json()
        assert final["event"] == "finalOutput"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()

    assert len(recorded) == 1
    assert recorded[0].text == "short"
    assert recorded[0].reason == "flush"


def test_try_trigger_generation(tmp_path: Path) -> None:
    """try_trigger_generation flag should emit buffered text."""
    settings = create_settings(tmp_path)
    recorded: list[PendingSegment] = []

    app = create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        on_segments_ready=lambda _ws, _session, segs: recorded.extend(segs),
    )
    client = TestClient(app)

    snippet = "x" * 60 + " "
    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        ws.receive_json()
        ws.send_json({"text": " "})
        ws.send_json({"text": snippet, "try_trigger_generation": True})
        ws.send_json({"text": ""})
        final = ws.receive_json()
        assert final["event"] == "finalOutput"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()

    assert len(recorded) == 1
    assert recorded[0].text == "x" * 60
    assert recorded[0].reason == "trigger"


def test_close_flushes_remaining_buffer(tmp_path: Path) -> None:
    """Closing connection should flush remaining buffer."""
    settings = create_settings(tmp_path)
    recorded: list[PendingSegment] = []

    app = create_app(
        settings,
        voice_registry=VoiceRegistry(),
        engine=DummyEngine(),
        on_segments_ready=lambda _ws, _session, segs: recorded.extend(segs),
    )
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        ws.receive_json()
        ws.send_json({"text": " "})
        ws.send_json({"text": "unfinished "})
        ws.send_json({"text": ""})
        final = ws.receive_json()
        assert final["event"] == "finalOutput"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()

    assert len(recorded) == 1
    assert recorded[0].text == "unfinished"
    assert recorded[0].is_final is True
    assert recorded[0].reason == "close"


def test_missing_initialize_causes_error(tmp_path: Path) -> None:
    """Reject sendText payloads before initialization."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        ws.receive_json()
        ws.send_json({"text": "hello world "})

        error = ws.receive_json()
        assert error["event"] == "error"
        assert error["code"] == "error.invalid_request"

        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 4000


def test_websocket_unknown_voice_returns_error(tmp_path: Path) -> None:
    """Return an error when the requested voice is unknown."""
    settings = create_settings(tmp_path)
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/unknown_voice/stream-input?api_key=test",
    ) as ws:
        message = ws.receive_json()
        assert message["event"] == "error"
        assert message["code"] == "error.voice_not_found"

        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 4000


def test_header_authentication(tmp_path: Path) -> None:
    """Allow websocket authentication via xi-api-key header."""
    settings = create_settings(tmp_path)
    registry = VoiceRegistry()
    recorded: list[PendingSegment] = []

    app = create_app(
        settings,
        voice_registry=registry,
        engine=DummyEngine(),
        on_segments_ready=lambda _ws, _session, segs: recorded.extend(segs),
    )
    client = TestClient(app)

    headers = {"xi-api-key": "test"}
    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input",
        headers=headers,
    ) as ws:
        ws.receive_json()
        ws.send_json({"text": " "})
        ws.send_json({"text": "hello "})
        ws.send_json({"text": ""})
        final = ws.receive_json()
        assert final["event"] == "finalOutput"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()

    assert recorded  # buffer flushed on close


def test_inactivity_timeout(tmp_path: Path) -> None:
    """Close idle websocket connections after configured timeout."""
    settings = create_settings(tmp_path)
    settings.inactivity_timeout = 0.2
    app = create_app(settings, voice_registry=VoiceRegistry(), engine=DummyEngine())
    client = TestClient(app)

    with client.websocket_connect(
        "/v1/text-to-speech/af_alloy/stream-input?api_key=test",
    ) as ws:
        ws.receive_json()  # connected
        time.sleep(0.3)
        error = ws.receive_json()
        assert error["event"] == "error"
        assert error["code"] == "error.inactivity_timeout"
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()

    assert exc.value.code == 1001
