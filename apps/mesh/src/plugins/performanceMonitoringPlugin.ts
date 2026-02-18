/**
 * GraphQL Performance Plugin for monitoring resolver execution time
 */
import type { Plugin } from '@envelop/core';
import { performance } from 'perf_hooks';

export function createPerformanceMonitoringPlugin(): Plugin {
  const resolverTimings = new Map<string, number>();
  
  return {
    onPluginInit() {
      // Clear any previous timing data
      resolverTimings.clear();
    },
    
    onExecute() {
      return {
        onExecuteDone() {
          // Log resolver performance if any were tracked and monitoring is enabled
          if (process.env.PERF_MONITOR === 'true' && resolverTimings.size > 0) {
            console.log('🔍 GraphQL Resolver Performance:');
            for (const [resolverName, duration] of resolverTimings) {
              console.log(`   ${resolverName}: ${duration.toFixed(2)}ms`);
            }
          }
          // Clear timing data after execution
          resolverTimings.clear();
        }
      };
    }
  };
}
