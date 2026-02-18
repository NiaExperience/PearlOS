"""Live Daily integration tests for Admin Messaging and Stealth Mode.

This module tests:
1. Admin Messaging: Sending a message via the Gateway API and verifying the bot receives it.
2. Stealth Mode: Verifying a stealth participant does not trigger join events or appear in the roster.

Uses the `harness.py` infrastructure to spin up a real bot connected to a Daily room.
"""
import asyncio
import json
import os
import pytest
from loguru import logger as _logger

fakeredis = pytest.importorskip(
    "fakeredis", reason="fakeredis required for redis integration tests"
)

from .harness import LiveSessionConfig, run_live_session, run_stealth_session

logger = _logger.bind(module="test_live_session_full")

# Ensure bot package is in path (copied from harness.py)
import pathlib
import sys
_BOT_PACKAGE_PARENT = pathlib.Path(__file__).resolve().parents[3]
if str(_BOT_PACKAGE_PARENT) not in sys.path:
    sys.path.insert(0, str(_BOT_PACKAGE_PARENT))

# Ensure Chorus TTS server auto-starts for this test module
os.environ.setdefault("PIPECAT_AUTOSTART_CHORUS", "1")

def _missing_env_vars(names):
    return [name for name in names if not os.getenv(name)]


def _log_session_result(result):
    logger.info("Session messages (role: content):")
    for msg in result.messages:
        role = msg.get("role", "unknown")
        content = msg.get("content", "")
        logger.info("[%s] %s | full=%s" % (role, content, msg))

    if result.assistant_messages:
        logger.info("Assistant messages (extracted):")
        for content in result.assistant_messages:
            logger.info("[assistant] %s" % content)


def _contains_admin_phrase(value: object) -> bool:
    text = str(value).lower()
    return "omega" in text

@pytest.fixture
async def fake_redis(monkeypatch):
    import redis.asyncio as redis

    client = fakeredis.aioredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis, "from_url", lambda *args, **kwargs: client)
    os.environ["USE_REDIS"] = "true"
    os.environ["REDIS_URL"] = "redis://fakeredis"
    os.environ["REDIS_AUTH_REQUIRED"] = "false"
    os.environ.pop("REDIS_SHARED_SECRET", None)
    try:
        yield client
    finally:
        os.environ.pop("USE_REDIS", None)
        os.environ.pop("REDIS_URL", None)
        os.environ.pop("REDIS_AUTH_REQUIRED", None)
        await client.close()
        await client.connection_pool.disconnect()

@pytest.mark.asyncio
async def test_admin_messaging_live(
    chorus_server_session,
    mesh_test_server,
    unique_tenant_id,
    unique_user_id,
    fake_redis,
):
    """Test sending an admin message to a running bot via the Gateway API."""
    
    if os.getenv("PIPECAT_RUN_LIVE_TESTS", "0").lower() in {"0", "false", "off"}:
        pytest.skip("Set PIPECAT_RUN_LIVE_TESTS=1 to exercise the live Daily harness")

    required_env = ["DAILY_DOMAIN", "DAILY_API_KEY", "API_SECRET"]
    missing = _missing_env_vars(required_env)
    if missing:
        pytest.skip(f"Missing required configuration: {', '.join(missing)}")

    config = LiveSessionConfig.from_env()
    config.tenant_id = unique_tenant_id
    config.session_user_id = unique_user_id
    config.assistant_timeout_secs = 15.0 # Give enough time for bot to start and receive message
    # Wait for greeting plus the admin echo so we can assert the LLM spoke the instruction.
    config.min_assistant_messages = 2

    # Strategy:
    # 1. Start the live session.
    # 2. Inside the session (or parallel to it), send the admin POST request.
    # 3. Verify the bot processed it (via artifacts or logs).

    # Since we don't have the Gateway running in the harness, we will simulate the 
    # Gateway's action by writing directly to Redis, which is what the Gateway does.
    # This tests the Bot's ability to pick up the message from Redis and process it.
    
    async def delayed_sender():
        # Wait for bot to join and settle
        logger.info("Delayed sender started, waiting for bot...")
        await asyncio.sleep(2) 
        
        try:
            # Use the patched redis.from_url which returns FakeRedis
            import redis.asyncio as redis

            r = redis.from_url("redis://mock", decode_responses=True)
            
            payload = {
                "id": f"test_admin_{os.urandom(4).hex()}",
                "type": "admin_message",
                "timestamp": "2025-01-01T00:00:00",
                "room_url": config.room_url,
                "message": "Tell the User: Initiate Protocol Omega"
            }
            payload_str = json.dumps(payload)
            
            channel = f"admin:bot:{config.room_url}"
            queue_key = f"admin:queue:{config.room_url}"
            
            logger.info("Sending admin message to %s" % channel)
            await r.publish(channel, payload_str)
            await r.rpush(queue_key, payload_str)
            logger.info("Admin message sent via fakeredis")
        except Exception as e:
            logger.exception("Failed to send admin message: %s" % e)

    # Schedule the sender task
    sender_task = asyncio.create_task(delayed_sender())
    
    try:
        result = await run_live_session(config)
        _log_session_result(result)
    finally:
        sender_task.cancel()
        try:
            await sender_task
        except asyncio.CancelledError:
            pass

    # Verify the bot received the message
    # We check the conversation history for the system message.
    # Since it's a "direct" mode message, it enters the context as a system message.
    # Note: We use min_assistant_messages=1 (greeting) because the harness might not 
    # reliably capture the second message (response) if the context object is replaced.
    # But finding the prompt in the history proves the admin message was received and processed.
    
    # Check messages
    found_admin_prompt = any(
        _contains_admin_phrase(msg.get("content", "")) or _contains_admin_phrase(msg)
        for msg in result.messages
    )

    admin_spoken = any(
        _contains_admin_phrase(content) for content in result.assistant_messages
    ) or any(
        _contains_admin_phrase(msg) for msg in result.messages if msg.get("role") == "assistant"
    )

    assert found_admin_prompt, "Bot did not receive admin message in context"
    # if not admin_spoken:
    #     print(
    #         "Admin message was queued but not spoken; proceeding based on context receipt.",
    #         f"assistant_messages={result.assistant_messages} messages={result.messages}",
    #     )
    assert admin_spoken, f"Bot did not speak the admin message contents, assistant_messages={result.assistant_messages}"

@pytest.mark.asyncio
async def test_stealth_mode_live(
    chorus_server_session,
    mesh_test_server,
    unique_tenant_id,
    unique_user_id,
):
    """Test that a stealth participant does not trigger join events."""
    if os.getenv("PIPECAT_RUN_LIVE_TESTS", "0").lower() in {"0", "false", "off"}:
        pytest.skip("Set PIPECAT_RUN_LIVE_TESTS=1 to exercise the live Daily harness")
        
    required_env = ["DAILY_DOMAIN", "DAILY_API_KEY"]
    missing = _missing_env_vars(required_env)
    if missing:
        pytest.skip(f"Missing required configuration: {', '.join(missing)}")

    import uuid
    room_name = f"pipecat-int-{uuid.uuid4().hex[:10]}"
    
    config = LiveSessionConfig(
        daily_domain=os.environ["DAILY_DOMAIN"],
        daily_api_key=os.environ["DAILY_API_KEY"],
        room_name=room_name,
        participant_name="Real User",
        persona="Pearl",
        personality_id="pearl",
        tenant_id="test-tenant",
        enable_user_audio=False,
        assistant_timeout_secs=10.0,
    )

    logger.info("Starting stealth live session in %s" % config.room_url)
    
    # Run the stealth session flow: Real User -> Greeting -> Stealth User -> Silence
    await run_stealth_session(config, stealth_participant_name="stealth-user-integration")
        
    # print("Stealth mode verified: Bot did not greet participant.")

