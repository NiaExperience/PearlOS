/**
 * Redis health monitoring and diagnostics
 */

import { Environment } from '../types/config';

import { RedisConnection } from './connection';
import { RedisPool } from './pool';

export interface HealthStatus {
  healthy: boolean;
  environment: string;
  timestamp: number;
  connection: {
    status: 'connected' | 'disconnected' | 'error';
    latency?: number;
    error?: string;
  };
  pool?: {
    activeConnections: number;
    totalConnections: number;
  };
  memory?: {
    used: string;
    peak: string;
    percentage?: number;
  };
  performance?: {
    commandsPerSecond?: number;
    keyspaceHits?: number;
    keyspaceMisses?: number;
    hitRatio?: number;
  };
}

export class RedisHealth {
  private static healthHistory: Map<string, HealthStatus[]> = new Map();
  private static readonly maxHistorySize = 100;

  /**
   * Get comprehensive health status
   */
  static async getStatus(env?: Environment): Promise<HealthStatus> {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    const timestamp = Date.now();
    
    const status: HealthStatus = {
      healthy: false,
      environment,
      timestamp,
      connection: { status: 'disconnected' }
    };

    try {
      // Test connection
      const connectionHealth = await RedisConnection.getHealthStatus(environment);
      status.connection = {
        status: connectionHealth.healthy ? 'connected' : 'error',
        latency: connectionHealth.latency,
        error: connectionHealth.error
      };

      if (connectionHealth.healthy) {
        // Get pool stats
        const poolStats = RedisPool.getStats(environment);
        if (poolStats) {
          status.pool = {
            activeConnections: poolStats.activeConnections,
            totalConnections: poolStats.totalConnections
          };
        }

        // Get Redis info
        const redis = await RedisConnection.getInstance(environment);
        const info = await redis.info();
        
        // Parse memory info
        status.memory = this.parseMemoryInfo(info);
        
        // Parse performance stats
        status.performance = this.parsePerformanceInfo(info);
        
        status.healthy = true;
      }
    } catch (error) {
      status.connection = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    // Store in history
    this.storeHealthHistory(environment, status);
    
    return status;
  }

  /**
   * Get health history for environment
   */
  static getHistory(env?: Environment): HealthStatus[] {
    const environment = env || (process.env.NODE_ENV as Environment) || 'development';
    return this.healthHistory.get(environment) || [];
  }

  /**
   * Check if Redis is healthy with timeout
   */
  static async isHealthy(env?: Environment, timeoutMs = 5000): Promise<boolean> {
    try {
      const timeoutPromise = new Promise<HealthStatus>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), timeoutMs);
      });
      
      const healthPromise = this.getStatus(env);
      const status = await Promise.race([healthPromise, timeoutPromise]);
      
      return status.healthy;
    } catch {
      return false;
    }
  }

  /**
   * Get average latency from recent history
   */
  static getAverageLatency(env?: Environment, samples = 10): number {
    const history = this.getHistory(env);
    const recentSamples = history.slice(-samples);
    
    const latencies = recentSamples
      .map(status => status.connection.latency)
      .filter((latency): latency is number => typeof latency === 'number');
    
    if (latencies.length === 0) return 0;
    
    return latencies.reduce((sum, latency) => sum + latency, 0) / latencies.length;
  }

  /**
   * Clear health history
   */
  static clearHistory(env?: Environment): void {
    if (env) {
      this.healthHistory.delete(env);
    } else {
      this.healthHistory.clear();
    }
  }

  /**
   * Parse memory information from Redis INFO
   */
  private static parseMemoryInfo(info: string): HealthStatus['memory'] {
    const lines = info.split('\n');
    const memory: HealthStatus['memory'] = { used: '0B', peak: '0B' };
    
    for (const line of lines) {
      if (line.startsWith('used_memory_human:')) {
        memory.used = line.split(':')[1]?.trim() || '0B';
      } else if (line.startsWith('used_memory_peak_human:')) {
        memory.peak = line.split(':')[1]?.trim() || '0B';
      } else if (line.startsWith('used_memory_rss:') && line.includes('maxmemory:')) {
        // Calculate percentage if maxmemory is set
        const used = parseInt(line.split(':')[1] || '0');
        const maxLine = lines.find(l => l.startsWith('maxmemory:'));
        if (maxLine) {
          const max = parseInt(maxLine.split(':')[1] || '0');
          if (max > 0) {
            memory.percentage = Math.round((used / max) * 100);
          }
        }
      }
    }
    
    return memory;
  }

  /**
   * Parse performance information from Redis INFO
   */
  private static parsePerformanceInfo(info: string): HealthStatus['performance'] {
    const lines = info.split('\n');
    const performance: HealthStatus['performance'] = {};
    
    for (const line of lines) {
      if (line.startsWith('instantaneous_ops_per_sec:')) {
        performance.commandsPerSecond = parseInt(line.split(':')[1] || '0');
      } else if (line.startsWith('keyspace_hits:')) {
        performance.keyspaceHits = parseInt(line.split(':')[1] || '0');
      } else if (line.startsWith('keyspace_misses:')) {
        performance.keyspaceMisses = parseInt(line.split(':')[1] || '0');
      }
    }
    
    // Calculate hit ratio
    if (performance.keyspaceHits && performance.keyspaceMisses) {
      const total = performance.keyspaceHits + performance.keyspaceMisses;
      performance.hitRatio = Math.round((performance.keyspaceHits / total) * 100);
    }
    
    return performance;
  }

  /**
   * Store health status in history
   */
  private static storeHealthHistory(environment: string, status: HealthStatus): void {
    let history = this.healthHistory.get(environment);
    if (!history) {
      history = [];
      this.healthHistory.set(environment, history);
    }
    
    history.push(status);
    
    // Limit history size
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }
  }
}