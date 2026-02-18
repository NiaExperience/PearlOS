"""
Redis Client Module

Direct Python Redis client to replace Node.js subprocess bridge.
Provides async Redis operations for heartbeat, identity, and admin messaging.
Much faster and more reliable than subprocess calls.
"""

import asyncio
import json
import os
import threading
from datetime import datetime
from typing import Any

import redis.asyncio as redis
from loguru import logger


def _redis_enabled() -> bool:
    """Return True only when USE_REDIS explicitly enables Redis."""
    return os.getenv('USE_REDIS', 'false').lower() == 'true'


class RedisClient:
    """Async Redis client for bot processes."""

    def __init__(self):
        self._redis: redis.Redis | None = None
        self._subscriber: redis.Redis | None = None

    async def _get_redis(self) -> redis.Redis:
        """Get or create Redis connection with connection pooling."""
        if not _redis_enabled():
            logger.debug("[redis] USE_REDIS not true; skipping Redis connection")
            raise RuntimeError("Redis disabled by USE_REDIS")
        if self._redis is None:
            redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')

            # Check if Redis authentication is required
            redis_auth_required = os.getenv('REDIS_AUTH_REQUIRED', 'false').lower() == 'true'
            redis_password = None

            if redis_auth_required:
                redis_password = os.getenv('REDIS_SHARED_SECRET')
                if not redis_password:
                    logger.warning("[redis] REDIS_AUTH_REQUIRED=true but REDIS_SHARED_SECRET not set")
                    raise ValueError("Redis authentication required but no password provided")
                logger.debug("[redis] Redis authentication enabled")
            else:
                logger.debug("[redis] Redis authentication disabled")

            self._redis = redis.from_url(
                redis_url,
                password=redis_password,
                decode_responses=True,
                retry_on_timeout=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                health_check_interval=30
            )
        return self._redis

    async def ping(self) -> bool:
        """Test Redis connectivity."""
        try:
            client = await self._get_redis()
            await client.ping()
            return True
        except Exception as e:
            logger.debug(f"[redis] Ping failed: {e}")
            return False

    # Identity Operations
    async def write_identity(self, room_url: str, participant_id: str, identity_data: dict[str, Any]) -> None:
        """Write identity to Redis."""
        if not _redis_enabled():
            logger.debug("[redis-identity] Skipping write; USE_REDIS not true")
            return
        try:
            client = await self._get_redis()
            identity_key = f"identity:{room_url}:{participant_id}"

            # Store identity data
            await client.hset(identity_key, mapping={
                "participant_id": participant_id,
                "room_url": room_url,
                "timestamp": datetime.now().isoformat(),
                "data": json.dumps(identity_data)
            })

            # Set TTL (24 hours)
            await client.expire(identity_key, 86400)

            logger.debug(f"[redis-identity] Stored identity for participant {participant_id}")

        except Exception as e:
            logger.error(f"[redis-identity] Failed to write identity for {participant_id}: {e}")
            raise

    async def read_identity(self, room_url: str, participant_id: str) -> dict[str, Any] | None:
        """Read identity from Redis."""
        if not _redis_enabled():
            logger.debug("[redis-identity] Skipping read; USE_REDIS not true")
            return None
        try:
            client = await self._get_redis()
            identity_key = f"identity:{room_url}:{participant_id}"
            identity_data = await client.hgetall(identity_key)

            if identity_data and 'data' in identity_data:
                parsed_data = json.loads(identity_data['data'])
                return {
                    "participant_id": identity_data['participant_id'],
                    "room_url": identity_data['room_url'],
                    "timestamp": identity_data['timestamp'],
                    **parsed_data
                }
            return None

        except Exception as e:
            logger.debug(f"[redis-identity] Failed to read identity for {participant_id}: {e}")
            return None

    async def scan_identities(self, room_url: str) -> list[dict[str, Any]]:
        """Scan all identities for a room."""
        if not _redis_enabled():
            logger.debug("[redis-identity] Skipping scan; USE_REDIS not true")
            return []
        try:
            client = await self._get_redis()
            pattern = f"identity:{room_url}:*"
            identities = []

            async for key in client.scan_iter(match=pattern):
                identity_data = await client.hgetall(key)
                if identity_data and 'data' in identity_data:
                    parsed_data = json.loads(identity_data['data'])
                    identities.append({
                        "participant_id": identity_data['participant_id'],
                        "room_url": identity_data['room_url'],
                        "timestamp": identity_data['timestamp'],
                        **parsed_data
                    })

            return identities

        except Exception as e:
            logger.error(f"[redis-identity] Failed to scan identities for room {room_url}: {e}")
            return []

    async def cleanup_expired_identities(self, room_url: str) -> int:
        """Clean up expired identity keys for a room."""
        if not _redis_enabled():
            logger.debug("[redis-identity] Skipping cleanup; USE_REDIS not true")
            return 0
        try:
            client = await self._get_redis()
            pattern = f"identity:{room_url}:*"
            deleted_count = 0

            async for key in client.scan_iter(match=pattern):
                ttl = await client.ttl(key)
                if ttl == -1:  # Key exists but no TTL set
                    await client.expire(key, 86400)  # Set 24 hour TTL
                elif ttl == -2:  # Key doesn't exist (expired)
                    deleted_count += 1

            return deleted_count

        except Exception as e:
            logger.error(f"[redis-identity] Failed to cleanup identities for room {room_url}: {e}")
            return 0

    # Admin Operations
    async def send_admin_message(self, room_key: str, message: str) -> None:
        """Send admin message to a room-scoped channel/queue."""
        if not _redis_enabled():
            logger.debug("[redis-admin] Skipping send; USE_REDIS not true")
            return
        try:
            client = await self._get_redis()
            admin_message = {
                "id": f"admin_{int(datetime.now().timestamp() * 1000)}_{os.urandom(4).hex()}",
                "type": "admin_message", 
                "timestamp": datetime.now().isoformat(),
                "room_url": room_key,
                "message": message
            }

            # Use both pub/sub for real-time and queue for persistence
            channel = f"admin:bot:{room_key}"
            await client.publish(channel, json.dumps(admin_message))

            # Also queue the message for polling-based retrieval
            queue_key = f"admin:queue:{room_key}"
            await client.rpush(queue_key, json.dumps(admin_message))
            await client.expire(queue_key, 3600)  # 1 hour TTL

            logger.debug(f"[redis-admin] Sent admin message to room key {room_key}")

        except Exception as e:
            logger.error(f"[redis-admin] Failed to send admin message to room key {room_key}: {e}")
            raise

    async def get_admin_messages(self, room_key: str) -> list[dict[str, Any]]:
        """Get queued admin messages for a room-scoped key."""
        if not _redis_enabled():
            logger.debug("[redis-admin] Skipping get messages; USE_REDIS not true")
            return []
        try:
            client = await self._get_redis()
            queue_key = f"admin:queue:{room_key}"

            messages = []
            while True:
                message_json = await client.lpop(queue_key)
                if not message_json:
                    break
                try:
                    message = json.loads(message_json)
                    messages.append(message)
                except json.JSONDecodeError:
                    logger.warning(f"[redis-admin] Invalid JSON in admin queue: {message_json}")

            return messages

        except Exception as e:
            logger.error(f"[redis-admin] Failed to get admin messages for room key {room_key}: {e}")
            return []

    async def close(self):
        """Close Redis connections."""
        if self._redis:
            try:
                await self._redis.aclose()
            finally:
                self._redis = None
        if self._subscriber:
            try:
                await self._subscriber.aclose()
            finally:
                self._subscriber = None


# Global Redis client instances cached per thread/event loop to avoid loop sharing
_redis_clients_lock = threading.Lock()
_redis_clients: dict[tuple[int, int | None], RedisClient] = {}


def _get_client_cache_key() -> tuple[int, int | None]:
    """Generate a cache key for the current thread and, if available, the running loop."""
    thread_id = threading.get_ident()
    try:
        loop = asyncio.get_running_loop()
        return thread_id, id(loop)
    except RuntimeError:
        # If there's no running loop (sync context), fall back to thread-only key
        return thread_id, None


async def get_redis_client() -> RedisClient:
    """Get a Redis client instance scoped to the current thread/event loop."""
    key = _get_client_cache_key()
    with _redis_clients_lock:
        client = _redis_clients.get(key)
        if client is None:
            client = RedisClient()
            _redis_clients[key] = client
    return client

async def check_redis_available() -> bool:
    """Check if Redis is available without mutating the global client state."""
    if not _redis_enabled():
        return False

    temp_client = RedisClient()
    try:
        return await temp_client.ping()
    except Exception:
        return False
    finally:
        await temp_client.close()