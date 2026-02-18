"""
Redis Admin Messaging Service
Implementation of Redis-based admin messaging system (room-keyed only).

This module provides Redis-based equivalents for admin messaging functions.
Uses direct Python Redis client for performance.
"""

import asyncio
import json
import os
from collections.abc import Callable
from typing import Any

from bot.loguru import get_logger

logger = get_logger(__name__, tag="redis-admin")

def check_redis_available() -> bool:
    """
    Check if Redis is available by pinging it via the Python client.

    Returns:
        bool: True if Redis is available and responding
    """
    try:
        # Import here to avoid circular imports
        from services.redis import check_redis_available as async_check
        
        # Run async function in sync context safely
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # Schedule check and return optimistic result
                # Cannot synchronously wait in running event loop
                logger.info("[redis-admin] Deferring Redis availability check (event loop running)")
                return True  # Optimistic - will fail gracefully if Redis unavailable
            else:
                return loop.run_until_complete(async_check())
        except RuntimeError:
            # No event loop, create a new one
            return asyncio.run(async_check())
    except Exception as e:
        logger.warning(f"[redis-admin] Redis availability check failed: {e}")
        return False


def _write_admin_message_redis(room_key: str, admin_event: dict[str, Any]) -> bool:
    """
    Send admin messages keyed by room (admin:queue:<room>, admin:bot:<room>).

    Args:
        room_key: Target room identifier (canonical room URL or pre-spawn key)
        admin_event: Admin message data (note_context event or admin prompt event)

    Returns:
        bool: True if message was sent successfully, False if Redis operation failed
    """
    try:
        # Import here to avoid circular imports
        from services.redis import get_redis_client

        # For note context events, send the whole event as JSON
        # For admin prompt events, extract the prompt text
        event_type = admin_event.get('type', 'admin')
        if event_type == 'note_context':
            # Send the entire note context event as JSON
            message = json.dumps(admin_event)
        else:
            # For admin prompts, extract the prompt text
            message = admin_event.get('prompt', '')

        # Run async function in sync context safely
        async def _async_send():
            client = await get_redis_client()
            await client.send_admin_message(room_key, message)

        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # If loop is already running, schedule the coroutine
                asyncio.create_task(_async_send())
                # We can't await here since this is a sync function, so we schedule it
                # The task will run in the background - this is fire-and-forget
                logger.info(f"[redis-admin] Scheduled admin message task for room {room_key} (fire-and-forget)")
                return True  # Optimistic success - task scheduled
            else:
                loop.run_until_complete(_async_send())
                logger.info(f"[redis-admin] Sent admin message to room {room_key} via Redis")
                return True
        except RuntimeError:
            # No event loop, create a new one
            asyncio.run(_async_send())
            logger.info(f"[redis-admin] Sent admin message to room {room_key} via Redis (new event loop)")
            return True

    except Exception as e:
        logger.warning(f"[redis-admin] Failed to send admin message to room {room_key} via Redis: {e}")
        return False


def _extract_admin_event_from_redis_message(message_data: dict, room_key: str | None) -> dict:
    """Extract admin_event from Redis message data (room-keyed)."""
    message_content = message_data.get('message', '')
    room_from_message = (
        message_data.get('room_url')
        or message_data.get('room_key')
        or room_key
    )

    # Check if message is a JSON-serialized note_context event or admin_message
    if message_content.strip().startswith('{'):
        try:
            parsed_event = json.loads(message_content)
            msg_type = parsed_event.get('type')
            
            if msg_type == 'note_context':
                # Return the note_context event directly (already has all needed fields)
                parsed_event.setdefault('room_url', room_from_message)
                return parsed_event
            elif msg_type == 'admin_message':
                # Handle structured admin message from Gateway
                admin_event = {
                    'prompt': parsed_event.get('message', ''),
                    'senderId': parsed_event.get('sender_id') or parsed_event.get('sender') or 'admin',
                    'senderName': parsed_event.get('sender_name') or parsed_event.get('sender') or 'Admin',
                    'mode': 'direct',
                    'timestamp': parsed_event.get('timestamp'),
                    'room_url': parsed_event.get('room_url') or room_from_message,
                    'type': 'admin' # Normalize type for internal processing
                }
                # Pass through context for user text attribution (sourceType, userName, etc.)
                if parsed_event.get('context'):
                    admin_event['context'] = parsed_event['context']
                return admin_event
        except (json.JSONDecodeError, AttributeError):
            # Not valid JSON or not a known event type, treat as regular admin prompt
            pass
    
    # Regular admin prompt - wrap in admin event structure
    return {
        'prompt': message_content,
        'senderId': 'admin',
        'senderName': 'Admin',
        'mode': 'direct',
        'timestamp': message_data.get('timestamp'),
        'room_url': room_from_message
    }


async def _redis_polling_loop(
    room_key: str,
    process_admin_message: Callable[[dict[str, Any]], Any],
    room_url: str | None = None
) -> None:
    """
    Redis replacement for _admin_message_polling_loop().

    Uses direct Redis client for efficient message polling. Checks both:
    - admin:queue:{room_key} - messages for active room
    - admin:queue:pre-spawn:{canonical_room} - messages buffered before bot spawned

    Args:
        room_key: Room identifier for routing admin messages
        process_admin_message: Function to process received admin messages
        room_url: Room URL for checking pre-spawn messages (optional)
    """
    logger.info(f"[redis-admin-poll] Starting Redis queue polling loop for room {room_key}")

    heartbeat_counter = 0
    consecutive_errors = 0
    max_consecutive_errors = 10
    
    # Calculate canonical room for pre-spawn key
    canonical_room = None
    if room_url:
        try:
            from urllib.parse import urlparse
            
            # Canonicalize room URL (same as server._canonical_room_key)
            raw = (room_url or '').strip()
            parsed = urlparse(raw)
            scheme = (parsed.scheme or 'http').lower()
            hostname = (parsed.hostname or '').lower()
            port = parsed.port
            if (scheme == 'http' and port == 80) or (scheme == 'https' and port == 443):
                port_str = ''
            elif port is None:
                port_str = ''
            else:
                port_str = f':{port}'
            path = parsed.path or '/'
            path = path.rstrip('/') or '/'
            canonicalize_lower = os.getenv('BOT_CANONICALIZE_LOWER_PATH', '').strip().lower()
            if canonicalize_lower in ('1', 'true', 'yes', 'on'):
                path = path.lower()
            if not hostname:
                netloc = (parsed.netloc or '').lower()
            else:
                netloc = f'{hostname}{port_str}'
            canonical_room = f'{scheme}://{netloc}{path}'
            logger.debug(f"[redis-admin-poll] Will check pre-spawn messages for room: {canonical_room}")
        except Exception as e:
            logger.warning(f"[redis-admin-poll] Unable to calculate canonical room: {e}")

    try:
        # Import here to avoid circular imports
        from services.redis import get_redis_client
        
        # Initialize Redis client with retry logic
        client = None
        client_retries = 0
        max_client_retries = 3
        
        while client is None and client_retries < max_client_retries:
            try:
                client = await get_redis_client()
                logger.debug(f"[redis-admin-poll] Successfully connected to Redis for room {room_key}")
                break
            except Exception as client_error:
                client_retries += 1
                logger.warning(f"[redis-admin-poll] Redis client connection attempt {client_retries}/{max_client_retries} failed for room {room_key}: {client_error}")
                if client_retries >= max_client_retries:
                    logger.error(f"[redis-admin-poll] Failed to connect to Redis after {max_client_retries} attempts for room {room_key}")
                    raise
                await asyncio.sleep(1.0)

        while True:
            try:
                # Heartbeat message every 20 iterations (~10 seconds at 0.5s sleep per iteration)
                heartbeat_counter += 1
                if heartbeat_counter % 20 == 0:
                    logger.debug(f"[redis-admin-poll] Heartbeat: Redis queue polling active for room {room_key} (iteration {heartbeat_counter})")

                # Check for queued admin messages using Python Redis client
                messages = await client.get_admin_messages(room_key)
                
                # Also check for pre-spawn messages (buffered before bot started)
                if canonical_room:
                    try:
                        pre_spawn_messages = await client.get_admin_messages(f'pre-spawn:{canonical_room}')
                        if pre_spawn_messages:
                            logger.info(f"[redis-admin-poll] Found {len(pre_spawn_messages)} pre-spawn message(s) for room")
                            messages.extend(pre_spawn_messages)
                    except Exception as pre_spawn_error:
                        logger.warning(f"[redis-admin-poll] Error checking pre-spawn messages: {pre_spawn_error}")

                for message_data in messages:
                    admin_event = _extract_admin_event_from_redis_message(message_data, room_key)
                    msg_type = admin_event.get('type', 'admin')
                    logger.info(f"[redis-admin-poll] Processing queued Redis {msg_type} message")
                    await process_admin_message(admin_event)

                consecutive_errors = 0  # Reset error counter on success

            except Exception as poll_error:
                logger.warning(f"[redis-admin-poll] Error in polling iteration: {poll_error}")
                consecutive_errors += 1
                
                # Try to reconnect to Redis if connection issues
                if consecutive_errors % 5 == 0:  # Every 5 errors, try reconnecting
                    logger.info(f"[redis-admin-poll] Attempting Redis reconnection after {consecutive_errors} errors for room {room_key}")
                    try:
                        client = await get_redis_client()
                        logger.info(f"[redis-admin-poll] Successfully reconnected to Redis for room {room_key}")
                    except Exception as reconnect_error:
                        logger.warning(f"[redis-admin-poll] Redis reconnection failed for room {room_key}: {reconnect_error}")

            # If too many consecutive errors, increase sleep time and reset counter
            if consecutive_errors >= max_consecutive_errors:
                logger.error(f"[redis-admin-poll] Too many consecutive errors ({consecutive_errors}), backing off and resetting error counter for room {room_key}")
                await asyncio.sleep(5.0)
                consecutive_errors = 0  # Reset to continue trying
            else:
                # Normal polling interval
                await asyncio.sleep(0.5)

    except asyncio.CancelledError:
        logger.debug(f"[redis-admin-poll] Redis queue polling cancelled for room {room_key}")
        return
    except Exception as e:
        logger.error(f"[redis-admin-poll] Fatal error in Redis queue polling loop for room {room_key}: {e}")
        return


def migrate_to_redis_messaging() -> bool:
    """
    Enable Redis-based admin messaging.

    Returns:
        bool: True if Redis is available, False otherwise
    """
    try:
        if check_redis_available():
            logger.info("[redis-admin] Migration to Redis admin messaging successful")
            return True
        else:
            return False
    except Exception as e:
        logger.warning(f"[redis-admin] Redis not available, keeping file-based system: {e}")
        return False


# Lazy evaluation functions to be called at runtime
def get_write_admin_message():
    """Get the admin message write function (Redis-only), keyed by room."""
    use_redis = os.getenv('USE_REDIS', 'false').lower() == 'true'
    if use_redis and migrate_to_redis_messaging():
        logger.info("[redis-admin] Redis-based admin messaging enabled for server (room-keyed, no file fallback)")
        
        def redis_writer(room_key: str, admin_event: dict[str, Any]) -> None:
            """Redis admin message writer (room-keyed). Raises if Redis send fails."""
            success = _write_admin_message_redis(room_key, admin_event)
            if not success:
                raise RuntimeError(f"Redis admin messaging failed for room {room_key}")
        
        return redis_writer
    else:
        logger.info("[redis-admin] Redis not available for server - admin messaging disabled (no file fallback)")
        return None

def get_message_polling_loop():
    """Get the admin message polling loop function (Redis-only), keyed by room."""
    use_redis = os.getenv('USE_REDIS', 'false').lower() == 'true'
    if use_redis and migrate_to_redis_messaging():
        logger.info("[redis-admin] Using Redis-based admin messaging for bot polling (room-keyed, with resilient error handling)")
        
        async def resilient_redis_polling_loop(room_key: str, process_admin_message, room_url: str | None = None):
            """Redis polling with enhanced error handling and logging, keyed by room."""
            max_startup_failures = 3
            startup_failures = 0
            
            while startup_failures < max_startup_failures:
                try:
                    await _redis_polling_loop(room_key, process_admin_message, room_url)
                    return  # Normal completion
                except Exception as e:
                    startup_failures += 1
                    logger.error(f"[redis-admin-poll] Redis polling startup failure {startup_failures}/{max_startup_failures} for room {room_key}: {e}")
                    
                    if startup_failures >= max_startup_failures:
                        logger.error(f"[redis-admin-poll] Redis polling failed to start after {max_startup_failures} attempts for room {room_key}")
                        logger.error(f"[redis-admin-poll] Redis messaging appears unavailable - room {room_key} will miss admin messages")
                        logger.error("[redis-admin-poll] Consider restarting the bot process to retry Redis connection")
                        return  # Give up - let the bot continue without admin messaging
                    
                    # Wait before retry
                    await asyncio.sleep(2.0)
        
        return resilient_redis_polling_loop
    else:
        logger.info("[redis-admin] Redis not available for bot polling - admin messaging disabled")
        return None

# Legacy compatibility - these will be evaluated lazily
write_admin_message = None
admin_message_polling_loop = None
