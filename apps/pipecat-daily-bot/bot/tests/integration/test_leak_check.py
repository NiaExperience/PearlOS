
import pytest
from .harness import LiveSessionConfig, run_live_session

@pytest.mark.asyncio
async def test_simple_greeting(chorus_server_session, mesh_test_server, unique_tenant_id, unique_user_id):
    config = LiveSessionConfig.from_env()
    config.tenant_id = unique_tenant_id
    config.session_user_id = unique_user_id
    config.enable_user_audio = False
    config.assistant_timeout_secs = 10.0
    
    result = await run_live_session(config)
    assert len(result.assistant_messages) >= 1
