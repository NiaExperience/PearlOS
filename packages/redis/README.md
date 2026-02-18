# @nia/redis

Redis client abstraction and messaging services for NIA Universal platform.

## Overview

This package provides a comprehensive Redis integration layer that supports:

- **Connection Management**: Automatic connection pooling, health monitoring, and reconnection
- **Pub/Sub Messaging**: Type-safe publish/subscribe with message validation
- **Domain Services**: Pre-built messaging services for admin, chat, heartbeat, and events
- **Multi-Environment**: Development, test, staging, and production configurations
- **Monitoring**: Built-in metrics collection and health checking

## Quick Start

```typescript
import { RedisConnection, AdminMessaging, ChatMessaging } from '@nia/redis';

// Initialize Redis connection
const redis = await RedisConnection.getInstance();

// Send admin message
const adminService = new AdminMessaging(redis);
await adminService.sendMessage({
  message: "System maintenance in 5 minutes",
  mode: "immediate",
  sender_id: "admin",
  room_url: "https://daily.co/room",
  timestamp: Date.now()
});

// Subscribe to chat messages
const chatService = new ChatMessaging(redis);
await chatService.subscribe("room-123", (message) => {
  console.log(`New chat: ${message.message}`);
});
```

## Architecture

### Connection Layer
- `RedisConnection`: Environment-aware connection management
- `RedisPool`: Connection pooling and reuse
- `RedisHealth`: Health monitoring and diagnostics

### Pub/Sub Layer
- `RedisPublisher`: Type-safe message publishing
- `RedisSubscriber`: Subscription management
- `ChannelManager`: Channel naming and routing

### Messaging Services
- `AdminMessaging`: Admin command distribution
- `ChatMessaging`: Real-time chat messaging
- `HeartbeatMessaging`: Bot health monitoring
- `EventMessaging`: Event bus integration

## Configuration

Redis configuration is environment-aware:

```typescript
// Development (default)
REDIS_URL=redis://localhost:6379

// Production
REDIS_URL=redis://redis-cluster:6379
REDIS_PASSWORD=secretpassword
REDIS_POOL_SIZE=20
```

## Message Types

All messages are type-safe and validated:

```typescript
interface AdminMessage {
  message: string;
  mode: 'immediate' | 'queued';
  sender_id: string;
  sender_name?: string;
  room_url?: string;
  timestamp: number;
}

interface ChatMessage {
  message: string;
  type?: 'text' | 'system';
  sender_id: string;
  room_url: string;
  timestamp: number;
}
```

## Development

```bash
# Start Redis for development
npm run redis:dev:start

# Build package
cd packages/redis
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

## Testing

The package includes comprehensive tests:

- **Unit Tests**: Individual component testing
- **Integration Tests**: End-to-end message flows
- **Performance Tests**: Load and latency testing

```bash
# Run all tests
npm test

# Run specific test suite
npm test -- --testPathPattern=messaging

# Run with coverage
npm test -- --coverage
```

## Monitoring

Built-in monitoring and metrics:

```typescript
import { RedisMetrics, RedisHealth } from '@nia/redis';

// Check Redis health
const health = await RedisHealth.getStatus();
console.log('Redis healthy:', health.healthy);

// Get performance metrics
const metrics = await RedisMetrics.getMetrics();
console.log('Messages/sec:', metrics.messagesPerSecond);
```

## Production Considerations

- **High Availability**: Use Redis Sentinel or Cluster in production
- **Security**: Enable TLS, authentication, and network policies
- **Monitoring**: Integrate with Prometheus/Grafana for observability
- **Backup**: Configure Redis persistence and backup strategies
- **Scaling**: Monitor connection counts and message throughput

## License

Unlicensed - Internal NIA Universal package