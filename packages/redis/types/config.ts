/**
 * Configuration type definitions for Redis package
 */

import type { RedisOptions } from 'ioredis';

/** Environment types */
export type Environment = 'development' | 'test' | 'staging' | 'production';

/** Redis connection configuration */
export interface RedisConfig {
  /** Redis connection URL */
  url?: string;
  /** Redis host */
  host?: string;
  /** Redis port */
  port?: number;
  /** Redis database number */
  db?: number;
  /** Redis password */
  password?: string;
  /** Connection pool size */
  poolSize?: number;
  /** Environment */
  environment: Environment;
  /** Additional Redis options */
  options?: Partial<RedisOptions>;
}

/** Redis cluster configuration */
export interface RedisClusterConfig {
  /** Cluster nodes */
  nodes: Array<{ host: string; port: number }>;
  /** Cluster options */
  options?: {
    enableReadyCheck?: boolean;
    redisOptions?: Partial<RedisOptions>;
    maxRetriesPerRequest?: number;
  };
}

/** Redis Sentinel configuration */
export interface RedisSentinelConfig {
  /** Sentinel nodes */
  sentinels: Array<{ host: string; port: number }>;
  /** Master name */
  name: string;
  /** Sentinel options */
  options?: Partial<RedisOptions>;
}

/** Pub/Sub configuration */
export interface PubSubConfig {
  /** Default message TTL in seconds */
  defaultTTL?: number;
  /** Maximum message size in bytes */
  maxMessageSize?: number;
  /** Enable message compression */
  compression?: boolean;
  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts */
    maxAttempts: number;
    /** Base delay in milliseconds */
    baseDelay: number;
    /** Maximum delay in milliseconds */
    maxDelay: number;
    /** Exponential backoff multiplier */
    multiplier: number;
  };
}

/** Health check configuration */
export interface HealthConfig {
  /** Health check interval in milliseconds */
  interval: number;
  /** Health check timeout in milliseconds */
  timeout: number;
  /** Maximum failed checks before marking unhealthy */
  maxFailures: number;
}

/** Metrics configuration */
export interface MetricsConfig {
  /** Enable metrics collection */
  enabled: boolean;
  /** Metrics collection interval in milliseconds */
  interval: number;
  /** Metrics retention period in seconds */
  retention: number;
}

/** Complete Redis package configuration */
export interface CompleteRedisConfig {
  connection: RedisConfig;
  cluster?: RedisClusterConfig;
  sentinel?: RedisSentinelConfig;
  pubsub: PubSubConfig;
  health: HealthConfig;
  metrics: MetricsConfig;
}