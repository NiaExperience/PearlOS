/**
 * Redis connection management with environment awareness
 */

import Redis, { RedisOptions } from 'ioredis';

import { getRedisConfig } from '../config/environments';
import { RedisConfig, Environment } from '../types/config';

export class RedisConnection {
  private static instances: Map<string, Redis> = new Map();
  private static configs: Map<string, RedisConfig> = new Map();

  /**
   * Get Redis instance for specific environment
   */
  static async getInstance(env?: Environment): Promise<Redis> {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const cacheKey = `redis-${environment}`;

    if (this.instances.has(cacheKey)) {
      return this.instances.get(cacheKey)!;
    }

    const config = getRedisConfig(environment);
    const redis = await this.createConnection(config);
    
    this.instances.set(cacheKey, redis);
    this.configs.set(cacheKey, config);
    
    return redis;
  }

  /**
   * Create new Redis connection with configuration
   */
  private static async createConnection(config: RedisConfig): Promise<Redis> {
    const options: RedisOptions = {
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      ...config.options
    };

    let redis: Redis;

    if (config.url) {
      redis = new Redis(config.url, options);
    } else {
      redis = new Redis({
        host: config.host || 'localhost',
        port: config.port || 6379,
        db: config.db || 0,
        password: config.password,
        ...options
      });
    }

    // Setup connection event handlers
    redis.on('connect', () => {
      console.log(`✓ Redis connected [${config.environment}]`);
    });

    redis.on('error', (error) => {
      console.error(`❌ Redis connection error [${config.environment}]:`, error.message);
    });

    redis.on('reconnecting', () => {
      console.log(`🔄 Redis reconnecting [${config.environment}]`);
    });

    // Test connection
    await redis.connect();
    await redis.ping();

    return redis;
  }

  /**
   * Get health status of Redis connection
   */
  static async getHealthStatus(env?: Environment): Promise<{
    healthy: boolean;
    latency?: number;
    error?: string;
  }> {
    try {
      const redis = await this.getInstance(env);
      const start = Date.now();
      await redis.ping();
      const latency = Date.now() - start;
      
      return { healthy: true, latency };
    } catch (error) {
      return { 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Close all Redis connections
   */
  static async closeAll(): Promise<void> {
    const promises = Array.from(this.instances.values()).map(redis => {
      return redis.disconnect();
    });
    
    await Promise.all(promises);
    this.instances.clear();
    this.configs.clear();
    
    console.log('✓ All Redis connections closed');
  }

  /**
   * Get connection configuration
   */
  static getConfig(env?: Environment): RedisConfig | undefined {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const cacheKey = `redis-${environment}`;
    return this.configs.get(cacheKey);
  }

  /**
   * Get all active connections
   */
  static getActiveConnections(): string[] {
    return Array.from(this.instances.keys());
  }
}