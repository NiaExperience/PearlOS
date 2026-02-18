/**
 * Configuration type definitions for Redis connections
 */

/**
 * Environment types
 */
export type Environment = 'development' | 'test' | 'staging' | 'production';

/**
 * Basic Redis configuration
 */
export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  connectTimeout?: number;
  lazyConnect?: boolean;
  retryDelayOnFailover?: number;
  maxRetriesPerRequest?: number;
  enableAutoPipelining?: boolean;
  // Additional properties needed by implementation
  url?: string;
  environment?: Environment;
  poolSize?: number;
  options?: {
    retryDelayOnFailover?: number;
    enableReadyCheck?: boolean;
    maxRetriesPerRequest?: number;
    lazyConnect?: boolean;
    connectTimeout?: number;
    commandTimeout?: number;
    enableOfflineQueue?: boolean;
    showFriendlyErrorStack?: boolean;
  };
}

/**
 * Complete Redis configuration with environment-specific settings
 */
export interface CompleteRedisConfig extends RedisConfig {
  environment: Environment;
  connection: RedisConfig;
  pubsub?: {
    defaultTTL?: number;
    maxMessageSize?: number;
    compression?: boolean;
    retry?: {
      maxAttempts?: number;
      baseDelay?: number;
      maxDelay?: number;
      multiplier?: number;
    };
  };
  enableHealthCheck?: boolean;
  healthCheckInterval?: number;
  enableMetrics?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  health?: {
    interval?: number;
    timeout?: number;
    maxFailures?: number;
  };
  metrics?: {
    enabled?: boolean;
    interval?: number;
    retention?: number;
  };
}

/**
 * Redis connection pool configuration
 */
export interface PoolConfig {
  min: number;
  max: number;
  acquireTimeoutMillis?: number;
  createTimeoutMillis?: number;
  destroyTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  reapIntervalMillis?: number;
}