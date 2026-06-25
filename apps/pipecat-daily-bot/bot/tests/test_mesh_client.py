import json

import pytest
from aiohttp import web

from actions.personality_actions import (
    get_personality_by_id,
    get_personality_by_name,
    get_sprite_by_id,
    list_personalities,
)
from services.mesh import MeshClientError, _secret


@pytest.mark.asyncio
async def test_fetch_personalities_basic(monkeypatch):
    items = [
        {"name": "pearl", "id": "p1", "tenantId": "t1", "parent_id": "t1"},
        {"name": "onyx", "id": "p2", "tenantId": "t1", "parent_id": "t1"},
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

    result = await list_personalities("t1")
    assert len(result) == 2

    # By name
    one = await get_personality_by_name('t1', 'pearl')
    assert one and one['id'] == 'p1'

    await runner.cleanup()

@pytest.mark.asyncio
async def test_personality_id_lookup_rejects_cross_tenant_records(monkeypatch):
    seen_where = []

    async def handle(request: web.Request):
        seen_where.append(json.loads(request.query["where"]))
        return web.json_response({
            "success": True,
            "data": [{"name": "other", "id": "p1", "tenantId": "t2", "parent_id": "t2"}],
            "total": 1,
            "hasMore": False,
        })

    app = web.Application()
    app.router.add_get('/content/Personality', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    monkeypatch.setenv('MESH_API_ENDPOINT', f'http://127.0.0.1:{port}')

    result = await get_personality_by_id('t1', 'p1')

    assert result is None
    assert seen_where[0] == {
        "parent_id": {"eq": "t1"},
        "page_id": {"eq": "p1"},
    }

    await runner.cleanup()


@pytest.mark.asyncio
async def test_sprite_lookup_is_tenant_scoped(monkeypatch):
    seen_where = []

    async def handle(request: web.Request):
        seen_where.append(json.loads(request.query["where"]))
        return web.json_response({
            "success": True,
            "data": [{"_id": "sprite-1", "tenantId": "t1", "name": "Tenant sprite"}],
            "total": 1,
            "hasMore": False,
        })

    app = web.Application()
    app.router.add_get('/content/Sprite', handle)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '127.0.0.1', 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    monkeypatch.setenv('MESH_API_ENDPOINT', f'http://127.0.0.1:{port}')

    result = await get_sprite_by_id('t1', 'sprite-1')

    assert result and result["_id"] == "sprite-1"
    assert seen_where[0] == {
        "page_id": {"eq": "sprite-1"},
        "indexer": {"path": "tenantId", "equals": "t1"},
    }

    await runner.cleanup()

@pytest.mark.asyncio
async def test_missing_env(monkeypatch):
    """Ensure mesh_client errors cleanly when endpoint env is unset."""
    monkeypatch.delenv('MESH_API_ENDPOINT', raising=False)
    with pytest.raises(MeshClientError):
        await list_personalities("t1")


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
