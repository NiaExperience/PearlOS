/**
 * Redis metrics collection and monitoring utilities
 */

import { performance } from 'perf_hooks';

/**
 * Operation metrics
 */
export interface OperationMetrics {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  success: boolean;
  error?: string;
}

/**
 * Aggregated metrics
 */
export interface AggregatedMetrics {
  operation: string;
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  successRate: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  lastError?: string;
  lastErrorTime?: number;
}

/**
 * Redis metrics collector
 */
export class RedisMetrics {
  private operations: Map<string, OperationMetrics[]> = new Map();
  private readonly maxHistorySize = 1000;
  
  /**
   * Start tracking an operation
   */
  startOperation(name: string): string {
    const operationId = `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const metric: OperationMetrics = {
      name,
      startTime: performance.now(),
      success: false
    };
    
    if (!this.operations.has(name)) {
      this.operations.set(name, []);
    }
    
    const operations = this.operations.get(name)!;
    operations.push(metric);
    
    // Keep only recent operations
    if (operations.length > this.maxHistorySize) {
      operations.shift();
    }
    
    return operationId;
  }
  
  /**
   * End tracking an operation
   */
  endOperation(name: string, success: boolean, error?: string): void {
    const operations = this.operations.get(name);
    if (!operations || operations.length === 0) {
      return;
    }
    
    // Find the most recent unfinished operation
    const metric = operations
      .slice()
      .reverse()
      .find(op => !op.endTime);
      
    if (metric) {
      metric.endTime = performance.now();
      metric.duration = metric.endTime - metric.startTime;
      metric.success = success;
      metric.error = error;
    }
  }
  
  /**
   * Get aggregated metrics for an operation
   */
  getMetrics(operation: string): AggregatedMetrics | null {
    const operations = this.operations.get(operation);
    if (!operations || operations.length === 0) {
      return null;
    }
    
    const completedOps = operations.filter(op => op.duration !== undefined);
    if (completedOps.length === 0) {
      return null;
    }
    
    const successOps = completedOps.filter(op => op.success);
    const failedOps = completedOps.filter(op => !op.success);
    const durations = completedOps.map(op => op.duration!);
    
    const lastFailedOp = failedOps[failedOps.length - 1];
    
    return {
      operation,
      totalCalls: completedOps.length,
      successCalls: successOps.length,
      failedCalls: failedOps.length,
      successRate: completedOps.length > 0 ? (successOps.length / completedOps.length) * 100 : 0,
      avgDuration: durations.reduce((sum, d) => sum + d, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastError: lastFailedOp?.error,
      lastErrorTime: lastFailedOp?.endTime
    };
  }
  
  /**
   * Get metrics for all operations
   */
  getAllMetrics(): AggregatedMetrics[] {
    return Array.from(this.operations.keys())
      .map(operation => this.getMetrics(operation))
      .filter((metrics): metrics is AggregatedMetrics => metrics !== null);
  }
  
  /**
   * Clear all metrics
   */
  reset(): void {
    this.operations.clear();
  }
  
  /**
   * Get current statistics
   */
  getStats(): {
    operationCount: number;
    totalOperations: number;
    memoryUsage: number;
  } {
    const totalOperations = Array.from(this.operations.values())
      .reduce((sum, ops) => sum + ops.length, 0);
      
    return {
      operationCount: this.operations.size,
      totalOperations,
      memoryUsage: totalOperations * 100 // Rough estimate
    };
  }
}

/**
 * Global metrics instance
 */
export const redisMetrics = new RedisMetrics();

/**
 * Decorator for tracking Redis operations
 */
export function trackOperation(operationName: string) {
  return function <T extends (...args: unknown[]) => Promise<unknown>>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    target: any,
    propertyName: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const method = descriptor.value!;
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = (async function (this: any, ...args: unknown[]) {
      const opName = `${operationName}.${propertyName}`;
      redisMetrics.startOperation(opName);
      
      try {
        const result = await method.apply(this, args);
        redisMetrics.endOperation(opName, true);
        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        redisMetrics.endOperation(opName, false, errorMessage);
        throw error;
      }
    }) as T;
    
    return descriptor;
  };
}

/**
 * Simple timing utility
 */
export class Timer {
  private startTime: number;
  
  constructor() {
    this.startTime = performance.now();
  }
  
  elapsed(): number {
    return performance.now() - this.startTime;
  }
  
  reset(): void {
    this.startTime = performance.now();
  }
}