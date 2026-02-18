import json

import pytest
from aiohttp import web

from actions.personality_actions import get_personality_by_name, list_personalities
from services.mesh import MeshClientError, _secret


@pytest.mark.asyncio
async def test_fetch_personalities_basic(monkeypatch):
    items = [
        {"name": "pearl", "id": "p1"},
        {"name": "onyx", "id": "p2"},
    ]

    async def handle(request: web.Request):
        return web.json_response({"success": True, "data": items, "total": len(items), "hasMore": False})

    app = web.Application()
    app.router.add_get('/content/Personality', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    base = f'http://127.0.0.1:{port}'
    monkeypatch.setenv('MESH_API_ENDPOINT', base)

    result = await list_personalities()
    assert len(result) == 2

    # By name
    one = await get_personality_by_name('t1', 'pearl')
    assert one and one['id'] == 'p1'

    await runner.cleanup()

@pytest.mark.asyncio
async def test_missing_env(monkeypatch):
    """Ensure mesh_client errors cleanly when endpoint env is unset."""
    monkeypatch.delenv('MESH_API_ENDPOINT', raising=False)
    with pytest.raises(MeshClientError):
        await list_personalities()


def test_secret_strips_whitespace(monkeypatch):
    """Test that _secret() properly strips whitespace from environment variable"""
    # Test with trailing newline (the actual issue)
    monkeypatch.setenv('MESH_SHARED_SECRET', 'test-secret\n')
    assert _secret() == 'test-secret'
    
    # Test with leading/trailing spaces
    monkeypatch.setenv('MESH_SHARED_SECRET', '  test-secret  ')
    assert _secret() == 'test-secret'
    
    # Test with carriage return
    monkeypatch.setenv('MESH_SHARED_SECRET', 'test-secret\r\n')
    assert _secret() == 'test-secret'
    
    # Test with no secret set
    monkeypatch.delenv('MESH_SHARED_SECRET', raising=False)
    assert _secret() is None
