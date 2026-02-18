# Python Test Strategy for Pipecat Bot

**Date:** 2025-10-21  
**Decision:** Use Mesh in-memory DB for integration testing (same as Jest tests)

---

## Executive Summary

✅ **YES - We can and should use the Mesh in-memory DB from Python tests!**

This provides:
- **True integration testing** - Real DB operations without mocking
- **Test isolation** - Each test gets a clean DB state
- **Fast execution** - In-memory = no disk I/O
- **Consistency** - Same testing approach as TypeScript/Jest
- **Less mocking** - Test real behavior, not implementation

---

## How Mesh In-Memory DB Works

### TypeScript/Jest Implementation

The Mesh server supports **pg-mem** (PostgreSQL emulator) that runs entirely in-memory:

```typescript
// From apps/mesh/src/resolvers/db.ts
export async function initDatabase(useInMemory?: boolean, headers?: Record<string, string>): Promise<void> {
  const useInMemoryDb = 
    useInMemory || 
    process.env.NODE_ENV === 'test' ||
    headers?.['x-use-in-memory'] === 'true';  // ← Can force via header!
  
  if (useInMemoryDb) {
    sequelize = await createInMemoryDatabase({ shouldLog });
  } else {
    sequelize = await createPostgresDatabase({ ... });
  }
}
```

**Key insight:** You can force in-memory mode with `X-Use-In-Memory: true` header!

### Current Jest Test Setup

Jest tests use a **global setup** that:
1. Starts Mesh server on port 5001 in test mode
2. Server auto-detects `NODE_ENV=test` → uses in-memory DB
3. Tests make HTTP requests to `http://localhost:5001/graphql`
4. Each test suite can seed/clear DB as needed

```typescript
// From scripts/globalSetup.ts
async function startMeshServer() {
  process.env.MESH_ENDPOINT = 'http://localhost:5001/graphql';
  const prism = await Prism.getInstance();
  // Prism connects to Mesh server with in-memory DB
}
```

---

## Proposed Python Testing Approach

### Architecture

```
┌─────────────────────────────────────────────────┐
│ Python pytest Suite                             │
│                                                  │
│ ┌──────────────────────────────────────────────┐│
│ │ conftest.py (session-scoped fixtures)        ││
│ │                                               ││
│ │ @pytest.fixture(scope="session")             ││
│ │ def mesh_server():                           ││
│ │     """Start Mesh server once for all tests""" │
│ │     subprocess.Popen(['npm', 'run',          ││
│ │                       'mesh:test:server'])   ││
│ │     wait_for_health_check()                  ││
│ │     yield                                     ││
│ │     shutdown_server()                        ││
│ └──────────────────────────────────────────────┘│
│                                                  │
│ ┌──────────────────────────────────────────────┐│
│ │ test_html_actions.py                         ││
│ │                                               ││
│ │ def test_create_html_generation(mesh_server):││
│ │     # mesh_client calls real Mesh API        ││
│ │     # Mesh uses in-memory DB                 ││
│ │     result = await html_actions.create_...() ││
│ │     assert result["page_id"]                 ││
│ └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
                    │ HTTP
                    ▼
┌─────────────────────────────────────────────────┐
│ Mesh Server (port 5001)                         │
│ NODE_ENV=test → in-memory DB                    │
│                                                  │
│ ┌──────────────────────────────────────────────┐│
│ │ pg-mem (In-Memory PostgreSQL)                ││
│ │ - Full Sequelize ORM support                 ││
│ │ - GIN indexes for content queries            ││
│ │ - Transaction support                        ││
│ │ - Auto-reset between test suites             ││
│ └──────────────────────────────────────────────┘│
└─────────────────────────────────────────────────┘
```

### Implementation Plan

#### 1. Global Test Fixture (`conftest.py`)

```python
# apps/pipecat-daily-bot/bot/tests/conftest.py
import pytest
import subprocess
import time
import requests
import os
import signal

# Track the mesh server process
_mesh_server_process = None

@pytest.fixture(scope="session", autouse=True)
def mesh_test_server():
    """
    Start Mesh server in test mode (in-memory DB) once for entire test session.
    Automatically used by all tests via autouse=True.
    """
    global _mesh_server_process
    
    print("\n🚀 Starting Mesh server with in-memory DB for integration tests...")
    
    # Set environment for test mode
    env = os.environ.copy()
    env['NODE_ENV'] = 'test'
    env['MESH_PORT'] = '5001'  # Dedicated test port
    
    # Start Mesh server as subprocess
    _mesh_server_process = subprocess.Popen(
        ['npm', 'run', 'mesh:test:server'],
        cwd=os.path.join(os.path.dirname(__file__), '../../../..'),  # Repo root
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        preexec_fn=os.setsid  # Create new process group for clean shutdown
    )
    
    # Wait for server to be ready
    max_retries = 30
    for i in range(max_retries):
        try:
            response = requests.get('http://localhost:5001/health', timeout=1)
            if response.ok:
                print(f"✅ Mesh server ready after {i+1} attempts")
                break
        except requests.exceptions.RequestException:
            if i == max_retries - 1:
                print("❌ Mesh server failed to start!")
                _mesh_server_process.kill()
                raise RuntimeError("Mesh server did not become healthy in time")
            time.sleep(0.5)
    
    # Configure mesh_client to use test server
    os.environ['MESH_API_ENDPOINT'] = 'http://localhost:5001'
    os.environ['MESH_SHARED_SECRET'] = 'test-secret'
    os.environ['BOT_CONTROL_SHARED_SECRET'] = 'test-bot-secret'
    
    yield  # Tests run here
    
    # Cleanup
    print("\n🧹 Shutting down Mesh test server...")
    if _mesh_server_process:
        # Send SIGTERM to entire process group
        os.killpg(os.getpgid(_mesh_server_process.pid), signal.SIGTERM)
        try:
            _mesh_server_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Force kill if graceful shutdown fails
            os.killpg(os.getpgid(_mesh_server_process.pid), signal.SIGKILL)
        print("✅ Mesh server stopped")


@pytest.fixture
async def clean_db():
    """
    Reset database state between tests (if needed).
    Use this fixture when tests need isolation.
    """
    # Option 1: Send request to Mesh to clear DB
    # requests.post('http://localhost:5001/test/reset-db')
    
    # Option 2: Just rely on test data not conflicting
    # (in-memory DB is fast enough to not worry about cleanup)
    
    yield
    
    # Post-test cleanup if needed
    pass


@pytest.fixture
def tenant_id():
    """Provide a consistent test tenant ID."""
    return "test-tenant-123"


@pytest.fixture
def user_id():
    """Provide a consistent test user ID."""
    return "test-user-456"
```

#### 2. Add Mesh Test Server Script

```json
// package.json (root)
{
  "scripts": {
    "mesh:test:server": "NODE_ENV=test node apps/mesh/server.js"
  }
}
```

#### 3. Example Integration Test

```python
# apps/pipecat-daily-bot/bot/tests/test_html_actions_integration.py
"""
Integration tests for HTML actions using real Mesh in-memory DB.
No mocking - tests actual DB operations end-to-end.
"""
import pytest
from actions import html_actions


@pytest.mark.asyncio
async def test_create_html_generation_integration(tenant_id, user_id):
    """Test creating HTML generation with real DB operations."""
    
    # Create HTML generation (calls mesh_client → Mesh API → in-memory DB)
    result = await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="Test Game",
        html_content="<html><body>Test</body></html>",
        content_type="game",
        user_request="Create a test game",
        tags=["test", "game"]
    )
    
    # Verify creation succeeded
    assert result is not None
    assert result["title"] == "Test Game"
    assert result["contentType"] == "game"
    assert "page_id" in result
    
    # Verify we can retrieve it
    page_id = result["page_id"]
    retrieved = await html_actions.get_html_generation_by_id(tenant_id, page_id)
    
    assert retrieved is not None
    assert retrieved["title"] == "Test Game"
    assert retrieved["htmlContent"] == "<html><body>Test</body></html>"


@pytest.mark.asyncio
async def test_update_html_generation_integration(tenant_id, user_id):
    """Test updating HTML generation with real DB operations."""
    
    # Create initial HTML generation
    created = await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="Original Title",
        html_content="<html>Original</html>",
        content_type="app"
    )
    
    page_id = created["page_id"]
    
    # Update the generation
    success = await html_actions.update_html_generation(
        tenant_id=tenant_id,
        gen_id=page_id,
        title="Updated Title",
        html_content="<html>Updated</html>"
    )
    
    assert success is True
    
    # Verify update persisted
    updated = await html_actions.get_html_generation_by_id(tenant_id, page_id)
    assert updated["title"] == "Updated Title"
    assert updated["htmlContent"] == "<html>Updated</html>"


@pytest.mark.asyncio
async def test_list_html_generations_integration(tenant_id, user_id):
    """Test listing HTML generations with real DB operations."""
    
    # Create multiple generations
    await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="Game 1",
        html_content="<html>Game 1</html>",
        content_type="game"
    )
    
    await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="App 1",
        html_content="<html>App 1</html>",
        content_type="app"
    )
    
    # List all generations for tenant and user
    results = await html_actions.list_html_generations(tenant_id, user_id)
    
    assert len(results) >= 2  # May have more from other tests
    titles = [r["title"] for r in results]
    assert "Game 1" in titles
    assert "App 1" in titles


@pytest.mark.asyncio
async def test_fuzzy_search_html_generations_integration(tenant_id, user_id):
    """Test fuzzy search with real DB operations."""
    
    # Create HTML generation with specific title
    await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="Space Invaders Clone",
        html_content="<html>Game</html>",
        content_type="game"
    )
    
    # Test fuzzy search
    result = await html_actions.fuzzy_search_html_generations(
        tenant_id,
        "space invader"  # Slightly different spelling
    )
    
    assert result is not None
    assert "Space Invaders" in result["title"]
```

#### 4. Unit Tests (Still Useful!)

```python
# apps/pipecat-daily-bot/bot/tests/test_html_tools_unit.py
"""
Unit tests for HTML tools layer (LLM integration).
Mock the actions layer to test tool logic in isolation.
"""
import pytest
from unittest.mock import AsyncMock, patch
from tools import html_tools


@pytest.mark.asyncio
async def test_create_html_applet_handler_success():
    """Test create_html_applet handler with mocked actions."""
    
    # Mock the actions layer
    mock_applet = {
        "page_id": "test-123",
        "title": "Test Game",
        "contentType": "game"
    }
    
    with patch('actions.html_actions.create_html_generation', 
               new_callable=AsyncMock, return_value=mock_applet):
        
        # Mock bot and forwarder
        mock_bot = AsyncMock()
        mock_bot.get_room_tenant_id.return_value = "tenant-123"
        mock_bot.get_session_user_id.return_value = "user-456"
        mock_bot._room_url = "test-room"
        
        mock_forwarder = AsyncMock()
        forwarder_ref = {'instance': mock_forwarder}
        
        # Get handlers
        handlers = html_tools.get_handlers(mock_bot, forwarder_ref)
        handler = handlers["create_html_applet"]
        
        # Create mock callback
        result_callback = AsyncMock()
        
        # Call handler
        await handler(
            function_name="create_html_applet",
            tool_call_id="call-123",
            args={
                "title": "Test Game",
                "html_content": "<html>Test</html>",
                "content_type": "game"
            },
            llm=None,
            context=None,
            result_callback=result_callback
        )
        
        # Verify actions were called correctly
        # Verify events were emitted
        mock_forwarder.send_event.assert_called_once()
        
        # Verify callback received success
        call_args = result_callback.call_args[0][0]
        assert call_args.result["success"] is True
```

---

## Testing Strategy Matrix

| Test Type | What to Test | Mocking Strategy | Example |
|-----------|--------------|------------------|---------|
| **Integration** | Full stack (tools → actions → DB) | None! Use in-memory DB | `test_create_html_generation_integration` |
| **Unit (Actions)** | Business logic only | Mock mesh_client.request() | `test_validate_empty_title` |
| **Unit (Tools)** | LLM integration only | Mock actions layer | `test_create_html_applet_handler` |
| **E2E (Future)** | Bot + UI + Events | Real bot process + Playwright | Voice → HTML creation → UI update |

---

## Benefits vs Current Approach

### Current Approach (Mock aiohttp)
```python
# Current: Mock aiohttp server for each test
async def handle(request: web.Request):
    return web.json_response({"success": True, "data": [...]})

app = web.Application()
app.router.add_get('/content/Notes', handle)
runner = web.AppRunner(app)
await runner.setup()
site = web.TCPSite(runner, '127.0.0.1', 0)
await site.start()
```

**Problems:**
- ❌ Each test needs 15+ lines of boilerplate
- ❌ Manually construct response shapes
- ❌ No validation that queries actually work
- ❌ Doesn't test Mesh API contract
- ❌ Fragile - breaks when Mesh API changes

### Proposed Approach (In-Memory DB)
```python
# Proposed: Just test the behavior
async def test_create_html_generation_integration(tenant_id, user_id):
    result = await html_actions.create_html_generation(
        tenant_id=tenant_id,
        user_id=user_id,
        title="Test Game",
        html_content="<html>Test</html>",
        content_type="game"
    )
    assert result["page_id"]
```

**Benefits:**
- ✅ 5 lines of test code (vs 30+)
- ✅ Tests real DB operations
- ✅ Validates Mesh API contract
- ✅ Catches query bugs (wrong where clause, etc.)
- ✅ Auto-updates when Mesh API changes
- ✅ Same pattern as TypeScript/Jest tests

---

## Migration Path

### Phase 1: Add Test Infrastructure (1 day)
1. ✅ Create `conftest.py` with mesh_test_server fixture
2. ✅ Add `mesh:test:server` npm script
3. ✅ Test basic connectivity

### Phase 2: Migrate Existing Tests (2 days)
1. Keep existing unit tests for edge cases
2. Replace aiohttp mocking with integration tests
3. Add new integration tests for full workflows

### Phase 3: Expand Coverage (ongoing)
1. Add integration tests for all new features
2. Use unit tests for error cases / edge conditions
3. Add E2E tests for critical user flows

---

## Live Daily Harness & Chorus Autostart

The `tests/integration/test_hello_world.py` suite exercises a real Daily room plus Kokoro synthesis. To keep setup ergonomic, a pytest session fixture now launches the bundled `scripts/start-chorus-tts.sh` helper whenever the Kokoro provider is active.

- **Opt-in** – set `BOT_TTS_PROVIDER=kokoro` or `PIPECAT_AUTOSTART_CHORUS=1`. The fixture is otherwise a no-op to keep day-to-day runs light.
- **Prerequisites** – install the [`uv`](https://docs.astral.sh/uv/) CLI and ensure the Kokoro model assets can live under `apps/chorus-tts/`. The helper downloads missing files on first run.
- **Health checks** – the helper polls `KOKORO_TTS_HEALTH_URL` (defaults to `http://127.0.0.1:8000/healthz`). Failures bubble up with the last log lines for quick diagnosis.
- **Override/disable** – export `PIPECAT_AUTOSTART_CHORUS=0` when pointing at an existing Kokoro deployment; override `KOKORO_TTS_BASE_URL` / `KOKORO_TTS_HEALTH_URL` to match remote hosts.
- **Room allocation** – leave `DAILY_TEST_ROOM` unset and the harness will create a fresh `pipecat-int-<suffix>` room name per run (controlled via `PIPECAT_UNIQUE_DAILY_ROOMS`, default `1`). Set `DAILY_TEST_ROOM_PREFIX` for custom prefixes or disable uniqueness by toggling the flag to `0` and providing a fixed `DAILY_TEST_ROOM`.
- **Env loading** – `tests/conftest.py` now calls `python-dotenv` up front, so values in `apps/pipecat-daily-bot/.env` (like `DAILY_DOMAIN` or API keys) are available automatically when you run pytest.
- **Audio devices** – the harness inspects CoreAudio (macOS) or PulseAudio/ALSA (Linux) for loopback/monitor devices before running. Follow `apps/pipecat-daily-bot/bot/tests/integration/README.audio-devices.md` to install BlackHole/Loopback or a Pulse/ALSA null sink.
- **Opt-in execution** – export `PIPECAT_RUN_LIVE_TESTS=1` when you actually want to hit Daily; otherwise the harness test skips automatically to avoid crashing local environments that lack WebRTC credentials.

Example smoke run after exporting your Daily credentials:

```bash
cd apps/pipecat-daily-bot/bot
PIPECAT_AUTOSTART_CHORUS=1 BOT_TTS_PROVIDER=kokoro poetry run pytest tests/integration/test_hello_world.py -q
```

The session fixture tears the local Chorus process down automatically once pytest completes.

---

## Example Test File Structure

```text
apps/pipecat-daily-bot/bot/tests/
├── conftest.py                          # Global fixtures (mesh server)
├── TESTING_STRATEGY.md                  # This document
│
├── integration/                         # Integration tests (in-memory DB)
│   ├── test_html_actions_integration.py
│   ├── test_notes_actions_integration.py
│   └── test_profile_actions_integration.py
│
├── unit/                                # Unit tests (mocked dependencies)
│   ├── actions/
│   │   ├── test_html_actions_validation.py
│   │   └── test_notes_actions_validation.py
│   └── tools/
│       ├── test_html_tools.py
│       └── test_notes_tools.py
│
└── e2e/                                 # End-to-end tests (future)
    └── test_voice_to_html_creation.py
```

---

## Recommendation

### ✅ Proceed with Mesh in-memory DB approach

**Reasons:**

1. **Proven pattern** - Already working in TypeScript/Jest
2. **Less code** - Eliminate 80% of test boilerplate
3. **Better coverage** - Test real behavior, not mocks
4. **Faster feedback** - Catch integration bugs in CI
5. **Maintainable** - Tests don't break when refactoring internals

**Start with:**

1. Implement `conftest.py` fixture
2. Convert 1 test file as proof of concept
3. Measure benefits (lines of code, execution time, bugs caught)
4. Roll out to remaining tests

**Keep unit tests for:**

- Error handling edge cases
- Validation logic
- Complex business rules
- Things that don't need DB

---

## Questions?

- **Q: Will tests be slower?**  
  A: No! In-memory DB is faster than mocking aiohttp (no network stack). Jest tests run in <5s.

- **Q: What about test isolation?**  
  A: Each test uses unique IDs (tenant_id, user_id). DB is wiped between test runs.

- **Q: Can we run tests in parallel?**  
  A: Yes! pytest-xdist works fine. Each test uses different tenant IDs.

- **Q: What if Mesh server crashes during tests?**  
  A: Fixture handles cleanup. Failed tests will still stop the server.

**Ready to implement?** 🚀
