# Integration Tests with Mesh In-Memory DB

This directory contains integration tests that use a real Mesh server with an in-memory PostgreSQL database (via pg-mem).

## Overview

Unlike unit tests that mock dependencies, these integration tests:
- ✅ Test real DB operations end-to-end
- ✅ Validate Mesh API contracts
- ✅ Catch query bugs (wrong where clauses, indexer issues, etc.)
- ✅ Use minimal boilerplate (no manual response mocking)
- ✅ Run fast (in-memory DB, no disk I/O)

## How It Works

### Architecture

```
pytest test suite
     ↓ uses
conftest.py mesh_test_server fixture
     ↓ starts
Mesh server on port 5002 (NODE_ENV=test)
     ↓ uses
pg-mem (in-memory PostgreSQL)
     ↑ queries
mesh_client.request()
     ↑ calls
actions layer (html_actions, notes_actions, etc.)
     ↑ uses
test code
```

### Setup (Automatic)

The `mesh_test_server` fixture in `conftest.py`:
1. Starts Mesh server on port 5002 with `NODE_ENV=test`
2. Waits for health check to pass
3. Configures `mesh_client` to use test endpoint
4. Runs once per test session (shared across all tests)
5. Cleans up on exit

### Test Isolation

Tests use unique tenant/user IDs to avoid conflicts:

```python
@pytest.mark.asyncio
async def test_something(unique_tenant_id, unique_user_id):
    # Each test gets unique IDs like:
    # unique_tenant_id = "pytest-tenant-test_something"
    # unique_user_id = "pytest-user-test_something"
    
    result = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        ...
    )
```

## Running Tests

All tests must be run using `poetry` to ensure the correct Python environment:

### Run All Integration Tests

```bash
cd apps/pipecat-daily-bot/bot
poetry run pytest tests/integration/ -v
```

### Run Specific Test File

```bash
poetry run pytest tests/integration/test_html_actions_integration.py -v
```

### Run Specific Test

```bash
poetry run pytest tests/integration/test_html_actions_integration.py::test_create_html_generation_integration -v
```

### Run with Output

```bash
poetry run pytest tests/integration/ -v -s  # -s shows print statements
```

### Run in Parallel (Faster!)

```bash
# Install pytest-xdist if not already installed
poetry add --group dev pytest-xdist

# Run tests in parallel (4 workers)
poetry run pytest tests/integration/ -v -n 4
```

## Writing Integration Tests

### Basic Pattern

```python
import pytest
from actions import html_actions

@pytest.mark.asyncio
async def test_create_html_generation(unique_tenant_id, unique_user_id):
    """Test creating HTML generation with real DB."""
    
    # Call action (no mocking!)
    result = await html_actions.create_html_generation(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test App",
        html_content="<html>Test</html>",
        content_type="app"
    )
    
    # Verify result
    assert result is not None
    assert result["title"] == "Test App"
    assert "page_id" in result
    
    # Verify persistence
    retrieved = await html_actions.get_html_generation_by_id(
        unique_tenant_id,
        result["page_id"]
    )
    assert retrieved["title"] == "Test App"
```

### Available Fixtures

From `conftest.py`:

- `mesh_test_server` (session, autouse) - Starts/stops Mesh server
- `test_tenant_id` - Basic tenant ID ("pytest-tenant-default")
- `test_user_id` - Basic user ID ("pytest-user-default")
- `unique_tenant_id` - Unique tenant ID per test (recommended)
- `unique_user_id` - Unique user ID per test (recommended)
- `clean_db` - Optional DB cleanup (currently no-op)

### Test Organization

```python
# Good: Test one workflow per function
async def test_create_and_retrieve_html():
    result = await create_html_generation(...)
    retrieved = await get_html_generation_by_id(...)
    assert retrieved == result

# Good: Test error cases
async def test_get_html_generation_not_found():
    result = await get_html_generation_by_id(tenant, "bad-id")
    assert result is None

# Good: Test edge cases
async def test_fuzzy_search_with_typo():
    created = await create_html_generation(..., title="Space Invaders")
    found = await fuzzy_search_html_generations(tenant, "space invader")
    assert found["page_id"] == created["page_id"]
```

## Debugging

### Server Won't Start

If tests fail with "Mesh server did not become healthy":

1. Check if port 5002 is already in use:
   ```bash
   lsof -i:5002
   ```

2. Kill any processes on that port:
   ```bash
   npm run cleanup-processes
   # or manually:
   kill -9 $(lsof -ti:5002)
   ```

3. Check Mesh server logs (if test fails early, logs are printed)

### Tests Failing

1. **Check isolation**: Are you using `unique_tenant_id` and `unique_user_id`?
2. **Check server**: Run `lsof -i:5002` to verify server is running
3. **Check endpoint**: Verify `MESH_API_ENDPOINT` is set to `http://localhost:5002`
4. **Run single test**: Isolate the failing test with `-k test_name`

### Server Cleanup Issues

If server doesn't shut down cleanly:

```bash
# Use cleanup script
npm run cleanup-processes

# Or manual cleanup
ps aux | grep "node.*mesh" | grep -v grep | awk '{print $2}' | xargs kill -9
```

## Troubleshooting

### Port 5002 Already in Use

```bash
# Find and kill process
lsof -ti:5002 | xargs kill -9

# Or use cleanup script
npm run cleanup-processes
```

### Tests Hang on Startup

Check if Mesh server is starting correctly:

```bash
# Manually start Mesh test server
NODE_ENV=test MESH_PORT=5002 npm run dev -w @nia/mesh

# In another terminal, check health
curl http://localhost:5002/health
```

### Import Errors

Make sure you're in the correct directory:

```bash
cd apps/pipecat-daily-bot/bot
pytest tests/integration/
```

## Benefits Over Mocking

### Before (Mock aiohttp)

```python
# 30+ lines of boilerplate per test
async def test_create_note():
    async def handle(request: web.Request):
        return web.json_response({"success": True, "data": {...}})
    
    app = web.Application()
    app.router.add_post('/content/Notes', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    
    monkeypatch.setenv('MESH_API_ENDPOINT', f'http://127.0.0.1:{port}')
    # ... finally test the actual code
```

### After (Integration test)

```python
# 5 lines of test code
async def test_create_note(unique_tenant_id, unique_user_id):
    result = await notes_actions.create_note(
        tenant_id=unique_tenant_id,
        user_id=unique_user_id,
        title="Test",
        content="Content"
    )
    assert result["page_id"]
```

**Improvements:**
- ✅ 83% less code
- ✅ Tests real behavior, not mocked responses
- ✅ Catches integration bugs
- ✅ Survives refactoring

## Performance

- **Startup**: ~2-5 seconds (one-time per session)
- **Per test**: ~50-200ms (in-memory DB is fast!)
- **Full suite**: Scales linearly with parallel execution

Example timings:
```
10 integration tests, single worker:  ~5s total
10 integration tests, 4 workers:      ~3s total
100 integration tests, 4 workers:     ~15s total
```

## References

- [Mesh In-Memory DB Documentation](../../../../apps/mesh/docs/in-memory-database.md)
- [Testing Strategy](../TESTING_STRATEGY.md)
- [Jest Integration Tests](../../../../__tests__/) (TypeScript equivalent)
