# Test configuration for bot package
# Ensure the bot directory (this file's parent parent) is on sys.path so tests can import 'bot' and 'personalities'.
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Awaitable, Callable, Union

from dotenv import load_dotenv

bot_dir = Path(__file__).resolve().parent.parent
package_root = bot_dir.parent
# Ensure we import the package version of `bot` (with __init__.py) instead of the
# module file when running tests from the package directory.
if str(package_root) not in sys.path:
    sys.path.insert(0, str(package_root))

repo_root = Path(__file__).resolve().parents[3]
# Try loading from apps/pipecat-daily-bot/.env first (more specific)
bot_app_dir = Path(__file__).resolve().parents[2]
load_dotenv(bot_app_dir / ".env")
# Then fallback to repo root .env
load_dotenv(repo_root / ".env")

# Import eventbus for reset fixture
import eventbus.bus as bus

# Default to optional auth for generic smoke tests
os.environ["BOT_CONTROL_AUTH_REQUIRED"] = "0"
# Ensure no secrets are set by default
for k in ("BOT_CONTROL_SHARED_SECRET", "BOT_CONTROL_SHARED_SECRET_PREV"):
    os.environ.pop(k, None)

# Disable Redis by default in tests and bypass Redis gating for gateway endpoints
os.environ.setdefault("USE_REDIS", "false")
os.environ.setdefault("TEST_BYPASS_REDIS", "true")

# =============================================================================
# Mesh Test Server Integration (In-Memory DB)
# =============================================================================

import pytest
import pytest_asyncio
import subprocess
import time
import requests
import signal
import threading
from collections import deque

from bot.loguru import get_logger

logger = get_logger(__name__, tag="tests")

def pytest_collection_modifyitems(config, items):
    """Skip integration tests if running in CI environment."""
    if os.environ.get("CI") == "true":
        skip_integration = pytest.mark.skip(reason="Skipping integration tests in CI environment")
        for item in items:
            if "integration" in item.nodeid or "integration" in item.name:
                item.add_marker(skip_integration)

def pytest_sessionfinish(session, exitstatus):
    """Called after whole test run finishes."""
    # Run the coverage merge script if we are in the root workspace context
    # We check for the existence of the script relative to the repo root
    try:
        script_path = repo_root / "scripts" / "merge-coverage.sh"
        if script_path.exists():
            logger.info("Merging coverage reports...")
            subprocess.run([str(script_path)], check=False, capture_output=True)
    except Exception as e:
        logger.warning(f"Failed to merge coverage reports: {e}")


# =============================================================================
# Event Bus Reset Fixture
# =============================================================================

@pytest.fixture(autouse=True)
def reset_eventbus():
    """Reset event bus state before each test to prevent subscription accumulation.
    
    This fixture runs automatically before every test to ensure a clean slate.
    Without this, event handlers from previous tests accumulate and fire multiple times.
    """
    # Clear all subscribers before test
    bus._subscribers.clear()
    bus._wildcard_subscribers.clear()
    bus._stream_queues.clear()
    
    yield
    
    # Clear again after test for cleanup
    bus._subscribers.clear()
    bus._wildcard_subscribers.clear()
    bus._stream_queues.clear()


# =============================================================================
# Mesh Server Configuration
# =============================================================================

# Track the mesh server process globally
_mesh_server_process = None
_mesh_server_stdout = deque(maxlen=5000)  # Keep last 5000 lines (more detail for debugging)
_mesh_output_thread = None

# Test server configuration
MESH_TEST_PORT = 5002
MESH_TEST_ENDPOINT = f'http://localhost:{MESH_TEST_PORT}/api'
MESH_TEST_HEALTH_ENDPOINT = f'http://localhost:{MESH_TEST_PORT}/health'
MESH_TEST_GRAPHQL_ENDPOINT = f'http://localhost:{MESH_TEST_PORT}/graphql'


_registered_tenants: set[str] = set()


def _read_mesh_output():
    """Background thread to read Mesh server output."""
    global _mesh_server_stdout
    if not _mesh_server_process or not _mesh_server_process.stdout:
        return
    
    try:
        for line in iter(_mesh_server_process.stdout.readline, ''):
            if not line:
                break
            _mesh_server_stdout.append(line.rstrip())
    except Exception as e:
        logger.warning(f"Error reading Mesh server output: {e}")


def cleanup_ports(ports: list[int]):
    """Force kill processes listening on specified ports."""
    current_pid = os.getpid()
    for port in ports:
        try:
            # Find PID using lsof, only looking for LISTEN state to avoid killing clients
            # -t: terse (PID only)
            # -i:{port}: select by internet address
            # -sTCP:LISTEN: only TCP listeners
            cmd = ["lsof", "-t", f"-i:{port}", "-sTCP:LISTEN"]
            try:
                pids = subprocess.check_output(cmd, text=True).strip().split('\n')
            except subprocess.CalledProcessError:
                # No process found
                continue

            for pid_str in pids:
                if not pid_str:
                    continue
                
                pid = int(pid_str)
                if pid == current_pid:
                    print(f"⚠️ Skipping cleanup of port {port} (owned by current process {pid})")
                    continue
                    
                print(f"🧹 Cleaning up dangling process on port {port} (PID: {pid})")
                subprocess.run(["kill", "-9", str(pid)], check=True)
                
        except Exception as e:
            print(f"⚠️ Error cleaning up port {port}: {e}")


def ensure_mesh_definitions_for_tenant(tenant_id: str) -> bool:
    """Ensure Mesh content definitions exist for a given tenant."""
    if not tenant_id or tenant_id in _registered_tenants:
        logger.info(f"⏭️ Mesh definitions already registered for tenant {tenant_id}, skipping")
        return True

    try:
        from nia_content_definitions import ALL_DEFINITIONS, ensure_content_definitions

        results = ensure_content_definitions(
            definitions=ALL_DEFINITIONS,
            mesh_url=MESH_TEST_ENDPOINT,
            tenant=tenant_id,
            mesh_secret=os.getenv("MESH_SHARED_SECRET"),
        )

        success = sum(1 for value in results.values() if value)
        failure = len(results) - success

        if failure:
            logger.warning(
                "Mesh definition registration partial failure (%s/%s succeeded) for tenant %s" % (
                success,
                len(results),
                tenant_id,
            ))
        else:
            logger.info(
                "Mesh definitions registered for tenant %s (%s types)",
                tenant_id,
                success,
            )

        _registered_tenants.add(tenant_id)
        return failure == 0

    except Exception:  # pragma: no cover - log context for setup issues
        logger.exception("Failed to register Mesh definitions for tenant %s" % tenant_id)
        return False


@pytest.fixture(scope="session", autouse=True)
def mesh_test_server():
    """
    Start Mesh server in test mode (in-memory DB) once for entire test session.
    
    The server runs on port 5002 with NODE_ENV=test, which automatically
    activates the pg-mem in-memory PostgreSQL database.
    
    This fixture is automatically used by all tests (autouse=True).
    """
    global _mesh_server_process, _mesh_output_thread
    
    # Get repository root (4 levels up from this file)
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../../..'))
    
    # Set environment for test mode
    env = os.environ.copy()
    
    # Log current environment for debugging
    # print("\n📋 Current Environment Variables:")
    # for key, value in sorted(env.items()):
    #     # Redact sensitive values
    #     if any(secret in key.upper() for secret in ['SECRET', 'PASSWORD', 'TOKEN', 'KEY']):
    #         print(f"  {key}=<redacted>")
    #     else:
    #         print(f"  {key}={value}")
    env['NODE_ENV'] = 'test'
    env['PORT'] = str(MESH_TEST_PORT)  # Mesh server reads PORT, not MESH_PORT
    env['MESH_ENDPOINT'] = MESH_TEST_GRAPHQL_ENDPOINT
    # Set auth secrets for both server and client
    env['MESH_SHARED_SECRET'] = 'test-mesh-secret'
    env['BOT_CONTROL_SHARED_SECRET'] = 'test-bot-secret'
    env['DEBUG_MESH'] = os.environ.get('DEBUG_MESH', 'false')
    env['DEBUG_PRISM'] = os.environ.get('DEBUG_PRISM', 'false')
    
    # Cleanup potential dangling processes from previous runs
    cleanup_ports([MESH_TEST_PORT, 5001])

    # Start Mesh server as subprocess (background process)
    # Use the start-test-server.ts script which accepts port as parameter
    mesh_dir = os.path.join(repo_root, 'apps/mesh')
    start_script = os.path.join(mesh_dir, 'start-test-server.ts')
    try:
        _mesh_server_process = subprocess.Popen(
            ['npx', 'ts-node', start_script, str(MESH_TEST_PORT)],
            cwd=mesh_dir,
            env=env,
            stdout=subprocess.PIPE,  # Capture stdout for later display
            stderr=subprocess.STDOUT,  # Merge stderr into stdout
            text=True,  # Text mode for easier handling
            bufsize=1,  # Line buffered
            preexec_fn=os.setsid if sys.platform != 'win32' else None,  # Create new process group for clean shutdown
        )
        
        print(f"📋 Mesh server process started with PID: {_mesh_server_process.pid}")
        
        # Start background thread to capture output
        _mesh_output_thread = threading.Thread(target=_read_mesh_output, daemon=True)
        _mesh_output_thread.start()
        
    except Exception as e:
        print(f"❌ Failed to start Mesh server process: {e}")
        raise
    
    # Give server a moment to start before health checking
    print("⏳ Giving server 3 seconds to start...")
    time.sleep(3)
    
    # Wait for server to be ready
    print("⏳ Waiting for Mesh server health check...")
    max_retries = 120  # 60 seconds (0.5s intervals) - in-memory DB can take time to initialize
    server_ready = False
    
    for i in range(max_retries):
        try:
            response = requests.get(MESH_TEST_HEALTH_ENDPOINT, timeout=2)
            if response.ok:
                print(f"✅ Mesh server ready after {i+1} attempts ({(i+1)*0.5:.1f}s)")
                server_ready = True
                break
        except requests.exceptions.RequestException as e:
            if i % 10 == 0 and i > 0:  # Log every 5 seconds
                print(f"⏳ Still waiting... ({i+1}/{max_retries} attempts, {(i+1)*0.5:.1f}s elapsed)")
            if i == max_retries - 1:
                print(f"❌ Connection error: {e}")
                # Print server output for debugging
                if _mesh_server_process.poll() is not None:
                    print(f"❌ Mesh server exited early with code: {_mesh_server_process.poll()}")
                break
            time.sleep(0.5)
    
    if not server_ready:
        print(f"❌ Mesh server failed to become healthy after {max_retries * 0.5}s")
        # Cleanup failed server
        if _mesh_server_process:
            try:
                if sys.platform != 'win32':
                    try:
                        pgid = os.getpgid(_mesh_server_process.pid)
                        if pgid != os.getpgid(0):
                            os.killpg(pgid, signal.SIGTERM)
                        else:
                            _mesh_server_process.terminate()
                    except (ProcessLookupError, OSError):
                        pass
                else:
                    _mesh_server_process.terminate()
                _mesh_server_process.wait(timeout=5)
            except Exception as e:
                print(f"⚠️ Error during failed server cleanup: {e}")
        raise RuntimeError(f"Mesh server did not become healthy in time (tried {max_retries * 0.5}s)")
    
    # Configure mesh_client environment to use test server
    os.environ['MESH_API_ENDPOINT'] = MESH_TEST_ENDPOINT
    os.environ['MESH_SHARED_SECRET'] = 'test-mesh-secret'
    os.environ['BOT_CONTROL_SHARED_SECRET'] = 'test-bot-secret'
    
    print(f"🔧 Configured mesh_client to use test endpoint: {MESH_TEST_ENDPOINT}")    
    yield  # Tests run here
    
    # Cleanup
    print(f"\n🧹 Shutting down Mesh test server (PID: {_mesh_server_process.pid})...")
    if _mesh_server_process:
        try:
            # Send SIGTERM to entire process group (graceful shutdown)
            # Use negative PID to target the process group safely
            if sys.platform != 'win32':
                try:
                    pgid = os.getpgid(_mesh_server_process.pid)
                    # Only kill the process group if it's different from our own
                    if pgid != os.getpgid(0):
                        os.killpg(pgid, signal.SIGTERM)
                    else:
                        # Fallback to killing just the process
                        _mesh_server_process.terminate()
                except (ProcessLookupError, OSError):
                    # Process may have already exited
                    pass
            else:
                _mesh_server_process.terminate()
            
            # Wait for graceful shutdown
            try:
                _mesh_server_process.wait(timeout=5)
                print("✅ Mesh server stopped gracefully")
            except subprocess.TimeoutExpired:
                print("⚠️ Graceful shutdown timed out, forcing kill...")
                # Force kill if graceful shutdown fails
                if sys.platform != 'win32':
                    try:
                        pgid = os.getpgid(_mesh_server_process.pid)
                        if pgid != os.getpgid(0):
                            os.killpg(pgid, signal.SIGKILL)
                        else:
                            _mesh_server_process.kill()
                    except (ProcessLookupError, OSError):
                        pass
                else:
                    _mesh_server_process.kill()
        except Exception as e:
            print(f"⚠️ Error during server cleanup: {e}")

    # Final cleanup of ports to ensure nothing is left behind
    cleanup_ports([MESH_TEST_PORT, 5001])


@pytest.fixture
async def clean_db():
    """
    Optional fixture for tests that need guaranteed clean database state.
    
    Currently a no-op since tests use unique tenant/user IDs for isolation.
    Can be extended to reset DB state if needed.
    """
    yield
    # Post-test cleanup if needed

@pytest.fixture
def unique_tenant_id(request):
    """
    Provide a unique tenant ID per test for complete isolation.
    
    Uses UUID format to pass validation checks.
    """
    import uuid
    # Generate a deterministic UUID based on test name for reproducibility
    test_name = request.node.name
    namespace = uuid.UUID('12345678-1234-5678-1234-567812345678')
    tenant_id = str(uuid.uuid5(namespace, f"tenant-{test_name}"))
    logger.info(f"[mesh_test_server] calling ensure_mesh_definitions_for_tenant {tenant_id}")
    ensure_mesh_definitions_for_tenant(tenant_id)
    return tenant_id

@pytest.fixture
def unique_user_id(request):
    """
    Provide a unique user ID per test for complete isolation.
    
    Uses UUID format to pass validation checks.
    """
    import uuid
    # Generate a deterministic UUID based on test name for reproducibility
    test_name = request.node.name
    namespace = uuid.UUID('12345678-1234-5678-1234-567812345678')
    return str(uuid.uuid5(namespace, f"user-{test_name}"))


# ---------------------------------------------------------------------------
# Mesh record cleanup helpers
# ---------------------------------------------------------------------------


RecordPayload = Union[str, dict]


@dataclass(frozen=True)
class MeshRecordRef:
    content_type: str
    record_id: str
    tenant_id: str


class MeshRecordTracker:
    """Track Mesh content records created during a test and clean them up afterward."""

    def __init__(self) -> None:
        from actions import html_actions, notes_actions

        self._records: list[MeshRecordRef] = []
        self._seen: set[MeshRecordRef] = set()
        self._deleters: dict[str, Callable[[str, str], Awaitable[bool]]] = {
            # "Notes": notes_actions.delete_note,
            # "HtmlGeneration": html_actions.delete_html_generation,
        }

    def register(self, content_type: str, record: RecordPayload, tenant_id: str) -> str:
        """Register a Mesh record for post-test cleanup."""
        if record is None:
            raise ValueError("Cannot register a Mesh record of None")

        record_id = self._resolve_record_id(record)
        if not content_type:
            raise ValueError("content_type is required to register a Mesh record")
        if not tenant_id:
            raise ValueError("tenant_id is required to register a Mesh record")

        key = MeshRecordRef(content_type, record_id, tenant_id)
        if key not in self._seen:
            self._records.append(key)
            self._seen.add(key)
        return record_id

    def mark_deleted(self, content_type: str, record: RecordPayload, tenant_id: str) -> None:
        """Remove a record from tracking when a test deletes it explicitly."""
        record_id = self._resolve_record_id(record)
        key = MeshRecordRef(content_type, record_id, tenant_id)
        if key in self._seen:
            self._seen.remove(key)
            self._records = [existing for existing in self._records if existing != key]

    async def cleanup(self) -> None:
        """Delete all tracked records in reverse creation order."""
        while self._records:
            record = self._records.pop()
            self._seen.discard(record)

            deleter = self._deleters.get(record.content_type)
            try:
                if deleter is not None:
                    success = await deleter(record.tenant_id, record.record_id)
                else:
                    success = await self._delete_generic(record.content_type, record.record_id, record.tenant_id)

                if not success:
                    logger.warning(
                        "Mesh cleanup incomplete for %s/%s (tenant=%s)",
                        record.content_type,
                        record.record_id,
                        record.tenant_id,
                    )
            except Exception:
                logger.exception(
                    "Mesh cleanup error for %s/%s (tenant=%s)",
                    record.content_type,
                    record.record_id,
                    record.tenant_id,
                )

    @staticmethod
    def _resolve_record_id(record: RecordPayload) -> str:
        if isinstance(record, str):
            if not record:
                raise ValueError("Record ID cannot be empty")
            return record

        if isinstance(record, dict):
            for key in ("page_id", "_id", "id"):
                value = record.get(key)
                if value:
                    return str(value)
        raise ValueError("Unable to resolve Mesh record ID from payload")

    async def _delete_generic(self, content_type: str, record_id: str, tenant_id: str) -> bool:
        """Fallback deletion for content types without a dedicated helper."""
        try:
            from services import mesh as mesh_client
            response = await mesh_client.request(
                "DELETE",
                f"/content/{content_type}/{record_id}",
                params={"tenant": tenant_id},
            )
        except Exception:
            logger.exception(
                "Generic Mesh delete failed for %s/%s (tenant=%s)",
                content_type,
                record_id,
                tenant_id,
            )
            return False

        if response and response.get("success"):
            logger.info(
                "Generic Mesh delete succeeded for %s/%s (tenant=%s)",
                content_type,
                record_id,
                tenant_id,
            )
            return True

        logger.warning(
            "Generic Mesh delete returned failure for %s/%s (tenant=%s): %s" % (
            content_type,
            record_id,
            tenant_id,
            response.get("error") if isinstance(response, dict) else response)
        )
        return False


@pytest_asyncio.fixture
async def mesh_record_tracker(mesh_test_server):
    """Provide a per-test tracker that cleans up Mesh records after execution."""
    tracker = MeshRecordTracker()
    yield tracker
    await tracker.cleanup()


@pytest_asyncio.fixture
async def register_mesh_record(mesh_record_tracker: MeshRecordTracker):
    """Convenience fixture to register Mesh records for automatic cleanup."""

    def _register(content_type: str, record: RecordPayload, tenant_id: str) -> Union[str, None]:
        if record is None:
            return None
        return mesh_record_tracker.register(content_type, record, tenant_id)

    return _register


# =============================================================================
# Pytest Hooks - Display Mesh Server Output on Failure
# =============================================================================

def pytest_sessionfinish(session, exitstatus):
    """
    Print Mesh server output at the end of the test session if any tests failed.
    """
    global _mesh_server_stdout
    
    # exitstatus != 0 means tests failed or there were errors
    if _mesh_server_stdout and os.environ.get("DEBUG_MESH") == "true":
        print("\n" + "=" * 80)
        print("🔍 MESH SERVER STDOUT (last 5000 lines)")
        print("=" * 80)
        for line in _mesh_server_stdout:
            print(line)
        print()

    print("=" * 80)


