# Redis Implementation Guide

## Overview

Nia Universal uses Redis for high-performance inter-process communication and data sharing across bot processes. The Redis integration provides **real-time messaging**, **process heartbeats**, **identity sharing**, and **admin messaging** capabilities with automatic fallback to file-based systems.

## Architecture

### Redis Client
The platform uses a native Python Redis client (`redis[hiredis]>=4.2.0`) with async/await support for optimal performance. Connection pooling and automatic retry logic ensure reliability and efficiency.

### Key Components

#### 1. Native Python Redis Client
- **Location**: `apps/pipecat-daily-bot/bot/redis_client.py`
- **Features**: Async operations, connection pooling, automatic TTL management
- **Performance**: Sub-millisecond operations with connection reuse

#### 2. Migration Modules
Three specialized modules provide Redis-based replacements for file-based operations:

- **Heartbeat Migration** (`redis_heartbeat_migration.py`): Process health monitoring
- **Identity Migration** (`redis_identity_migration.py`): Cross-process participant identity sharing  
- **Admin Migration** (`redis_admin_migration.py`): Real-time admin messaging to bot processes

#### 3. Automatic Fallback
All Redis operations include automatic fallback to file-based systems when Redis is unavailable, ensuring zero downtime during migrations or Redis maintenance.

## Configuration

### Environment Variables

```bash
# Enable Redis operations (default: false)
USE_REDIS=true

# Redis connection string (default: redis://localhost:6379)
REDIS_URL=redis://localhost:6379

# Optional: Redis database number (default: 0)
REDIS_DB=0
```

### Dependencies

```toml
# pyproject.toml
redis = {version = ">=4.2.0", extras = ["hiredis"]}
```

## Redis Operations

### Heartbeat System
Bot processes send periodic heartbeats to Redis for health monitoring and zombie detection.

**Key Pattern**: `heartbeat:{pid}`  
**TTL**: 30 seconds  
**Operations**:
- `send_heartbeat(pid, room_url, participants)` - Send process health data
- `get_heartbeat(pid)` - Retrieve process health for monitoring

### Identity Management
Participant identities are shared across processes via Redis for seamless handoffs.

**Key Pattern**: `identity:{room_url}:{participant_id}`  
**TTL**: 24 hours  
**Operations**:
- `write_identity(room_url, participant_id, data)` - Store participant data
- `read_identity(room_url, participant_id)` - Retrieve participant data
- `scan_identities(room_url)` - List all participants in a room
- `cleanup_expired_identities(room_url)` - Remove stale identity data

### Admin Messaging
Real-time messaging from admin interfaces to bot processes.

**Key Patterns**: 
- Channel: `admin:bot:{pid}` (pub/sub)
- Queue: `admin:queue:{pid}` (persistent)

**TTL**: 1 hour  
**Operations**:
- `send_admin_message(bot_pid, message)` - Send message to specific bot
- `get_admin_messages(bot_pid)` - Retrieve queued messages

## Usage Examples

### Basic Redis Client
```python
from redis_client import get_redis_client

# Async context
async def example():
    client = await get_redis_client()
    
    # Send heartbeat
    await client.send_heartbeat(12345, "https://room.url", ["user1", "user2"])
    
    # Get heartbeat data
    data = await client.get_heartbeat(12345)
    
    # Store identity
    await client.write_identity("room_url", "participant_id", {"name": "John"})
    
    # Send admin message
    await client.send_admin_message(12345, "Hello bot!")

# Sync context (for compatibility with existing code)
def sync_example():
    from redis_heartbeat_migration import get_heartbeat_sender
    sender = get_heartbeat_sender()  # Returns function or None
    if sender:
        sender(12345, "https://room.url", ["user1", "user2"])
```

### Migration Modules
```python
# Heartbeat operations
from redis_heartbeat_migration import get_heartbeat_sender, get_heartbeat_reader

heartbeat_sender = get_heartbeat_sender()  # Redis or None (file fallback)
heartbeat_reader = get_heartbeat_reader()  # Redis or None (file fallback)

# Identity operations  
from redis_identity_migration import get_identity_writer, get_identity_scanner

identity_writer = get_identity_writer()    # Redis or None (file fallback)
identity_scanner = get_identity_scanner()  # Redis or None (file fallback)

# Admin operations
from redis_admin_migration import get_write_admin_message, get_admin_message_polling_loop

admin_writer = get_write_admin_message()           # Redis or None (file fallback)
admin_poller = get_admin_message_polling_loop()    # Redis or None (file fallback)
```

## Performance Characteristics

### Connection Management
- **Connection Pooling**: Automatic connection reuse across operations
- **Retry Logic**: Built-in retry with exponential backoff for failed operations
- **Health Checks**: Periodic connection health validation (30 second intervals)
- **Timeout Handling**: 5 second timeouts for connection and command operations

### Operation Performance
| Operation Type | Redis (Async) | File-Based | Improvement |
|---------------|---------------|------------|-------------|
| Heartbeat Send | ~1-2ms | ~10-50ms | 10-50x faster |
| Identity Read | ~1-2ms | ~5-20ms | 5-20x faster |
| Admin Message | ~1-2ms | ~100-500ms | 100-500x faster |

### Memory Usage
- **Efficient**: No JSON serialization overhead per operation
- **TTL Management**: Automatic expiration prevents memory accumulation
- **Connection Reuse**: Single connection pool reduces memory footprint

## Monitoring and Logging

### Log Levels
- **DEBUG**: Connection details, operation timings
- **INFO**: Successful operations, fallback activations  
- **WARNING**: Retry attempts, degraded performance
- **ERROR**: Failed operations, connection issues

### Log Examples
```
[redis-heartbeat] Sent heartbeat for bot 12345
[redis-identity] Stored identity for participant user1
[redis-admin] Sent admin message to bot 12345 via Redis
[redis-client] Ping failed: Connection refused - falling back to files
```

### Health Monitoring
```python
from redis_client import check_redis_available

# Check Redis availability
is_available = await check_redis_available()
```

## Error Handling

### Automatic Fallback
When Redis operations fail, the system automatically falls back to file-based operations:

```python
# Example: Heartbeat with fallback
redis_sender = get_heartbeat_sender()
if redis_sender:
    redis_sender(pid, room_url, participants)  # Redis path
else:
    # Automatic file-based fallback
    write_heartbeat_file(pid, room_url, participants)
```

### Connection Resilience
- **Automatic Reconnection**: Failed connections trigger reconnection attempts
- **Circuit Breaker**: Temporary fallback during Redis outages
- **Graceful Degradation**: File-based operations continue during Redis maintenance

### Error Recovery
```python
try:
    await client.send_heartbeat(pid, room_url, participants)
except Exception as e:
    logger.warning(f"Redis heartbeat failed, using file fallback: {e}")
    # Automatic fallback to file-based heartbeat
```

## Deployment Considerations

### Redis Requirements
- **Version**: Redis 5.0 or later
- **Memory**: Minimum 512MB, recommended 2GB+ for production
- **Persistence**: RDB snapshots recommended for data durability
- **Networking**: Accessible from all bot processes

### Environment Setup
```bash
# Development
USE_REDIS=true
REDIS_URL=redis://localhost:6379

# Production
USE_REDIS=true  
REDIS_URL=redis://redis-cluster:6379
REDIS_DB=0
```

### Migration Strategy
1. **Deploy Code**: Redis-enabled code with fallback to files
2. **Enable Redis**: Set `USE_REDIS=true` when Redis is ready
3. **Monitor**: Verify Redis operations and performance
4. **Cleanup**: Remove file-based code after Redis is stable

## Security

### Connection Security
```bash
# TLS/SSL connections
REDIS_URL=rediss://username:password@redis-host:6380

# Authentication
REDIS_URL=redis://:password@redis-host:6379
```

### Data Privacy
- **TTL Enforcement**: All keys automatically expire
- **No Persistent Storage**: Heartbeat and identity data is ephemeral
- **Access Control**: Redis AUTH and network isolation recommended

## Troubleshooting

### Common Issues

**Redis Connection Refused**
```bash
# Check Redis status
redis-cli ping

# Verify configuration
echo $REDIS_URL
```

**High Memory Usage**
```bash
# Check Redis memory
redis-cli INFO memory

# Monitor key expiration
redis-cli TTL heartbeat:12345
```

**Slow Performance**
- Verify `hiredis` is installed for C-based parsing
- Check network latency between bot processes and Redis
- Monitor Redis CPU usage and memory fragmentation

### Debug Mode
```python
import logging
logging.getLogger('redis_client').setLevel(logging.DEBUG)
```

This enables detailed logging of Redis operations, connection status, and performance metrics.