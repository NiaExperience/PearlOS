/**
 * @nia/redis - Redis client abstraction and messaging services
 * 
 * This package provides:
 * - Redis connection management with environment-aware configuration
 * - Pub/Sub abstractions with type safety and validation
 * - Domain-specific messaging services (admin, chat, heartbeat, events)
 * - Comprehensive utilities for serialization, retry, metrics, and validation
 * - Infrastructure scripts and health monitoring
 */

// Core client exports
export { RedisConnection } from './client/connection';
export { RedisPool } from './client/pool';
export { RedisHealth } from './client/health';

// Pub/Sub exports
export { RedisPublisher } from './pubsub/publisher';
export { RedisSubscriber } from './pubsub/subscriber';
export { ChannelManager } from './pubsub/channels';

// Messaging services
export { AdminMessagingService } from './messaging/admin';
export { ChatMessagingService } from './messaging/chat';
export { HeartbeatMessagingService } from './messaging/heartbeat';
export { EventMessagingService } from './messaging/events';

// Configuration
export { getRedisConfig, environments } from './config/environments';
export { MessageSchemas } from './config/schemas';
// Utilities
export {
  serializeMessage,
  deserializeMessage,
  safeSerialize,
  safeDeserialize,
  MessageSerializer
} from './utils/serialization';

export {
  withRetry,
  CircuitBreaker,
  CircuitState,
  DEFAULT_RETRY_OPTIONS,
  RetryManager
} from './utils/retry';

export {
  RedisMetrics,
  redisMetrics,
  trackOperation,
  Timer
} from './utils/metrics';

export {
  validateMessage,
  validateChannelName,
  validateConnectionConfig,
  sanitizeMessage,
  isBaseMessage,
  isAdminMessage,
  isChatMessage,
  isHeartbeatMessage,
  isEventMessage,
  MessageValidator
} from './utils/validation';

// Type definitions
// Type definitions - careful about duplicate exports
export type {
  BaseMessage,
  AdminMessage,
  ChatMessage,
  HeartbeatMessage,
  EventMessage,
  RedisMessage
} from './types/messages';

export type {
  ChannelName,
  ChannelSubscription,
  ChannelStats,
  ChannelMessage
} from './types/channels';

export type {
  RedisConfig,
  Environment,
  CompleteRedisConfig,
  PoolConfig
} from './types/config';

export { ChannelNames } from './types/channels';

// Message handler types
export type {
  AdminMessageHandler,
  AdminServiceConfig
} from './messaging/admin';

export type {
  ChatMessageHandler,
  ChatServiceConfig
} from './messaging/chat';

export type {
  HeartbeatMessageHandler,
  HeartbeatServiceConfig
} from './messaging/heartbeat';

export type {
  EventMessageHandler,
  EventServiceConfig
} from './messaging/events';

// Utility types
export type {
  SerializationResult
} from './utils/serialization';

export type {
  RetryOptions,
  RetryResult,
  CircuitBreakerOptions
} from './utils/retry';

export type {
  OperationMetrics,
  AggregatedMetrics
} from './utils/metrics';

export type {
  ValidationResult
} from './utils/validation';

// Re-export commonly used Redis types
export type { Redis, RedisOptions } from 'ioredis';

// Package version
export const VERSION = '1.0.0';