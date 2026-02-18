/**
 * Environment-specific Redis configurations
 */

import type { RedisConfig, Environment, CompleteRedisConfig } from '../types/config';

/**
 * Get Redis configuration for specific environment
 */
const environments = {
  development: 'development' as Environment,
  test: 'test' as Environment, 
  staging: 'staging' as Environment,
  production: 'production' as Environment
};

export function getRedisConfig(environment: Environment): RedisConfig {
  const baseConfig: RedisConfig = {
    host: 'localhost',
    port: 6379,
    environment,
    poolSize: parseInt(process.env.REDIS_POOL_SIZE || '10'),
    options: {
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    }
  };

  switch (environment) {
    case 'development':
      return {
        ...baseConfig,
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        db: 0,
        options: {
          ...baseConfig.options,
          // Development: More verbose logging
          showFriendlyErrorStack: true,
        }
      };

    case 'test':
      return {
        ...baseConfig,
        url: process.env.REDIS_TEST_URL || 'redis://localhost:6380',
        db: parseInt(process.env.REDIS_TEST_DB || '0'),
        options: {
          ...baseConfig.options,
          // Test: Faster timeouts, no persistence
          connectTimeout: 1000,
          commandTimeout: 1000,
        }
      };

    case 'staging':
      return {
        ...baseConfig,
        url: process.env.REDIS_URL || 'redis://redis-staging:6379',
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        poolSize: 15,
        options: {
          ...baseConfig.options,
          // Staging: Balanced performance and reliability
          connectTimeout: 5000,
          commandTimeout: 3000,
        }
      };

    case 'production':
      return {
        ...baseConfig,
        url: process.env.REDIS_URL || 'redis://redis-cluster:6379',
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        poolSize: 20,
        options: {
          ...baseConfig.options,
          // Production: Optimized for reliability
          connectTimeout: 10000,
          commandTimeout: 5000,
          retryDelayOnFailover: 200,
          maxRetriesPerRequest: 5,
          enableOfflineQueue: false, // Fail fast in production
        }
      };

    default:
      throw new Error(`Unknown environment: ${environment}`);
  }
}

/**
 * Get complete Redis configuration with all settings
 */
export function getCompleteRedisConfig(environment: Environment): CompleteRedisConfig {
  const connection = getRedisConfig(environment);
  
  return {
    ...connection, // Spread all connection properties (host, port, etc.)
    environment,
    connection,
    pubsub: {
      defaultTTL: environment === 'production' ? 3600 : 300, // 1 hour prod, 5 min others
      maxMessageSize: 1024 * 64, // 64KB
      compression: environment === 'production', // Compress in production only
      retry: {
        maxAttempts: environment === 'production' ? 5 : 3,
        baseDelay: 1000,
        maxDelay: 30000,
        multiplier: 2
      }
    },
    health: {
      interval: environment === 'production' ? 30000 : 10000, // 30s prod, 10s others
      timeout: 5000,
      maxFailures: 3
    },
    metrics: {
      enabled: environment !== 'test', // Disable metrics in tests
      interval: 60000, // 1 minute
      retention: environment === 'production' ? 86400 : 3600 // 24h prod, 1h others
    }
  };
}

/**
 * Validate Redis configuration
 */
export function validateRedisConfig(config: RedisConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!config.url && (!config.host || !config.port)) {
    errors.push('Either url or host+port must be provided');
  }
  
  if (config.poolSize && (config.poolSize < 1 || config.poolSize > 100)) {
    errors.push('Pool size must be between 1 and 100');
  }
  
  if (config.db && (config.db < 0 || config.db > 15)) {
    errors.push('Database number must be between 0 and 15');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get Redis URL for environment (for external tools)
 */
export function getRedisUrl(environment: Environment): string {
  const config = getRedisConfig(environment);
  
  if (config.url) {
    return config.url;
  }
  
  const host = config.host || 'localhost';
  const port = config.port || 6379;
  const db = config.db || 0;
  const auth = config.password ? `:${config.password}@` : '';
  
  return `redis://${auth}${host}:${port}/${db}`;
}

// Export environments object
export { environments };