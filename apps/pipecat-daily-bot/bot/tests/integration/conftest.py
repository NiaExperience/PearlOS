"""Pytest hooks for live Daily integration tests.

This module automatically launches a local Chorus (Kokoro) server when the
Pipecat bot is configured to use the Kokoro TTS provider. The goal is to remove
manual setup so the `test_hello_world` harness can synthesize audio during the
live Daily session.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Deque, Iterator, Optional
from urllib.parse import urlparse

import shutil
import sys

# Enable Chorus auto-start for integration tests by default
os.environ.setdefault("PIPECAT_AUTOSTART_CHORUS", "1")

import pytest
import requests


@pytest.fixture(autouse=True)
def _disable_redis_for_live_tests(monkeypatch):
    """Force Redis off for live harness tests unless a test opts in.

    The repo .env enables Redis with auth, which breaks local live tests when no
    server is available. Default everything to disabled/unauthenticated; tests
    that need Redis (e.g., fakeredis in admin messaging) explicitly re-enable.
    """

    monkeypatch.setenv("USE_REDIS", "false")
    monkeypatch.setenv("REDIS_AUTH_REQUIRED", "false")
    monkeypatch.delenv("REDIS_SHARED_SECRET", raising=False)
    monkeypatch.delenv("REDIS_URL", raising=False)
    yield

_BOT_PACKAGE_PARENT = Path(__file__).resolve().parents[3]
if str(_BOT_PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(_BOT_PACKAGE_PARENT))

from core.config import BOT_TTS_PROVIDER, KOKORO_TTS_BASE_URL  # type: ignore[import]

_LOG_LINES = 400
_HEALTH_PATH = "/healthz"
_STARTUP_TIMEOUT_SECS = 90
_REQUEST_TIMEOUT_SECS = 3
_AUTOSTART_FLAG = "PIPECAT_AUTOSTART_CHORUS"

_REPO_ROOT = Path(__file__).resolve().parents[5]
_START_SCRIPT = _REPO_ROOT / "scripts" / "start-chorus-tts.sh"


class ChorusServerError(RuntimeError):
    """Raised when the local Chorus server fails to start."""

    def __init__(self, message: str, logs: Optional[list[str]] = None) -> None:
        super().__init__(message)
        self.logs = logs or []


class ChorusServerProcess:
    """Manage the lifecycle of the Chorus TTS subprocess for tests."""

    def __init__(self, health_url: str) -> None:
        self._health_url = health_url
        self._process: Optional[subprocess.Popen[str]] = None
        self._log_buffer: Deque[str] = deque(maxlen=_LOG_LINES)
        self._reader: Optional[threading.Thread] = None

    @property
    def health_url(self) -> str:
        return self._health_url

    def start(self) -> None:
        if self._process is not None:
            return

        if not _START_SCRIPT.exists():
            raise ChorusServerError(f"Chorus launch script missing: {_START_SCRIPT}")
        env = os.environ.copy()
        env.setdefault("API_KEYS", env.get("KOKORO_TTS_API_KEY", "test-key"))

        command = ["bash", str(_START_SCRIPT)]
        self._process = subprocess.Popen(
            command,
            cwd=str(_REPO_ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            preexec_fn=os.setsid if os.name != "nt" else None,  # Create new session for clean process group isolation
        )
        self._reader = threading.Thread(target=self._capture_output, daemon=True)
        self._reader.start()
        self._wait_for_health()

    def stop(self) -> None:
        if self._process is None:
            return
        try:
            if self._process.poll() is None:
                if os.name != "nt":
                    try:
                        pgid = os.getpgid(self._process.pid)
                        # Only kill process group if it's different from our own
                        if pgid != os.getpgid(0):
                            os.killpg(pgid, signal.SIGTERM)
                        else:
                            # Fallback to killing just the process
                            self._process.terminate()
                    except (ProcessLookupError, OSError):
                        # Process may have already exited
                        pass
                else:  # pragma: no cover - windows fallback
                    self._process.terminate()
                try:
                    self._process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        try:
                            pgid = os.getpgid(self._process.pid)
                            if pgid != os.getpgid(0):
                                os.killpg(pgid, signal.SIGKILL)
                            else:
                                self._process.kill()
                        except (ProcessLookupError, OSError):
                            pass
                    else:  # pragma: no cover - windows fallback
                        self._process.kill()
                    try:
                        self._process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        pass  # Process is really stuck, but we tried
        finally:
            self._process = None

    def _capture_output(self) -> None:
        assert self._process is not None
        assert self._process.stdout is not None
        for line in self._process.stdout:
            stripped = line.rstrip()
            self._log_buffer.append(stripped)

    def _wait_for_health(self) -> None:
        assert self._process is not None
        deadline = time.time() + _STARTUP_TIMEOUT_SECS
        last_error: Optional[str] = None
        while time.time() < deadline:
            if self._process.poll() is not None:
                raise ChorusServerError(
                    "Chorus server exited during startup",
                    logs=self.tail(40),
                )
            try:
                response = requests.get(self._health_url, timeout=_REQUEST_TIMEOUT_SECS)
                if response.ok:
                    return
                last_error = f"HTTP {response.status_code}"
            except requests.RequestException as exc:  # pragma: no cover - network only
                last_error = str(exc)
            time.sleep(1)
        raise ChorusServerError(
            f"Timed out waiting for Chorus health check: {last_error}",
            logs=self.tail(40),
        )

    def tail(self, limit: int = 20) -> list[str]:
        if limit <= 0:
            return list(self._log_buffer)
        return list(self._log_buffer)[-limit:]


def _should_autostart() -> bool:
    flag = os.getenv(_AUTOSTART_FLAG)
    provider = BOT_TTS_PROVIDER().strip().lower()

    # Prefer an already running Chorus instance if health is OK
    health_url = _detect_health_url()
    try:
        response = requests.get(health_url, timeout=_REQUEST_TIMEOUT_SECS)
        if response.ok:
            print(f"\n🔍 Chorus already running at {health_url}; skipping autostart")
            return False
        print(
            f"\n🔍 Chorus health check failed (status {response.status_code}); "
            "will consider autostart"
        )
    except requests.RequestException as exc:
        print(f"\n🔍 Chorus health check exception: {exc}; will consider autostart")

    print(
        f"🔍 Chorus autostart decision: PIPECAT_AUTOSTART_CHORUS={flag}, "
        f"BOT_TTS_PROVIDER={provider}"
    )
    if flag is not None:
        result = flag.strip().lower() not in {"0", "false", "off"}
        print(f"🔍 Result from flag: {result}")
        return result
    result = provider == "kokoro"
    print(f"🔍 Result from provider: {result}")
    return result


def _detect_health_url() -> str:
    override = os.getenv("KOKORO_TTS_HEALTH_URL")
    if override:
        return override
    base = os.getenv("KOKORO_TTS_BASE_URL") or KOKORO_TTS_BASE_URL()
    parsed = urlparse(base)
    scheme = parsed.scheme.lower()
    http_scheme = "https" if scheme in {"wss", "https"} else "http"
    netloc = parsed.netloc or parsed.path
    netloc = netloc.rstrip("/")
    if not netloc:
        netloc = "127.0.0.1:8000"
    return f"{http_scheme}://{netloc}{_HEALTH_PATH}"


@pytest.fixture(scope="session", autouse=True)
def chorus_server_session() -> Iterator[Optional[ChorusServerProcess]]:
    """Launch Chorus automatically for live integration tests when requested."""

    if not _should_autostart():
        yield None
        return

    if not shutil.which("uv"):
        pytest.skip("Chorus autostart requested but 'uv' CLI is not available on PATH")

    health_url = _detect_health_url()
    print(f"\n🚀 Starting Chorus server, health URL: {health_url}")
    server = ChorusServerProcess(health_url)
    try:
        server.start()
        print(f"✅ Chorus server started successfully")
    except ChorusServerError as exc:
        tail = "\n".join(exc.logs)
        pytest.skip(
            "Chorus autostart failed: "
            + str(exc)
            + (f"\nLast log lines:\n{tail}" if tail else "")
        )
    yield server
    server.stop()
    print(f"🛑 Chorus server stopped")
