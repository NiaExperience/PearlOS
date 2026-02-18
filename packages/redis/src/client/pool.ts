/**
 * Redis connection pool management
 */

import Redis from 'ioredis';

import { Environment } from '../types/config';

import { RedisConnection } from './connection';

export interface PoolStats {
  activeConnections: number;
  totalConnections: number;
  environment: string;
  created: number;
  lastUsed: number;
}

export class RedisPool {
  private static pools: Map<string, Redis[]> = new Map();
  private static stats: Map<string, PoolStats> = new Map();
  private static maxPoolSize = 10;

  /**
   * Get Redis connection from pool
   */
  static async getConnection(env?: Environment): Promise<Redis> {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const poolKey = `pool-${environment}`;
    
    let pool = this.pools.get(poolKey);
    if (!pool) {
      pool = [];
      this.pools.set(poolKey, pool);
      this.initStats(poolKey, environment);
    }

    // Try to get existing connection from pool
    if (pool.length > 0) {
      const redis = pool.pop()!;
      this.updateStats(poolKey, 'used');
      return redis;
    }

    // Create new connection if pool is empty and under limit
    if (this.getTotalConnections(poolKey) < this.maxPoolSize) {
      const redis = await RedisConnection.getInstance(environment);
      this.updateStats(poolKey, 'created');
      return redis;
    }

    // If pool is at limit, wait and retry
    await this.waitForConnection();
    return this.getConnection(env);
  }

  /**
   * Return connection to pool
   */
  static returnConnection(redis: Redis, env?: Environment): void {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const poolKey = `pool-${environment}`;
    
    const pool = this.pools.get(poolKey);
    if (pool && pool.length < this.maxPoolSize) {
      pool.push(redis);
      this.updateStats(poolKey, 'returned');
    } else {
      // Pool is full, close the connection
      redis.disconnect();
    }
  }

  /**
   * Get pool statistics
   */
  static getStats(env?: Environment): PoolStats | undefined {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const poolKey = `pool-${environment}`;
    return this.stats.get(poolKey);
  }

  /**
   * Set maximum pool size
   */
  static setMaxPoolSize(size: number): void {
    this.maxPoolSize = Math.max(1, size);
  }

  /**
   * Clear all pools
   */
  static async clearAll(): Promise<void> {
    for (const [poolKey, pool] of this.pools.entries()) {
      await Promise.all(pool.map(redis => redis.disconnect()));
      pool.length = 0;
    }
    
    this.pools.clear();
    this.stats.clear();
    console.log('✓ All Redis pools cleared');
  }

  /**
   * Initialize pool statistics
   */
  private static initStats(poolKey: string, environment: string): void {
    this.stats.set(poolKey, {
      activeConnections: 0,
      totalConnections: 0,
      environment,
      created: Date.now(),
      lastUsed: Date.now()
    });
  }

  /**
   * Update pool statistics
   */
  private static updateStats(poolKey: string, action: 'created' | 'used' | 'returned'): void {
    const stats = this.stats.get(poolKey);
    if (stats) {
      stats.lastUsed = Date.now();
      
      switch (action) {
        case 'created':
          stats.totalConnections++;
          stats.activeConnections++;
          break;
        case 'used':
          stats.activeConnections++;
          break;
        case 'returned':
          stats.activeConnections = Math.max(0, stats.activeConnections - 1);
          break;
      }
    }
  }

  /**
   * Get total connections for a pool
   */
  private static getTotalConnections(poolKey: string): number {
    const stats = this.stats.get(poolKey);
    return stats?.totalConnections || 0;
  }

  /**
   * Wait for connection availability
   */
  private static async waitForConnection(): Promise<void> {
    return new Promise(resolve => {
      setTimeout(resolve, 100); // Wait 100ms before retry
    });
  }
}