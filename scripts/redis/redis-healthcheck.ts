#!/usr/bin/env ts-node

/**
 * Redis health check utility
 * Tests Redis connectivity and performance
 */

import { performance } from 'perf_hooks';

import Redis from 'ioredis';

interface HealthCheckResult {
  healthy: boolean;
  environment: string;
  port: number;
  latency?: number;
  memory?: {
    used: string;
    peak: string;
  };
  info?: {
    version: string;
    uptime: number;
    connections: number;
  };
  error?: string;
}

async function checkRedisHealth(
  port: number = 6379,
  environment: string = 'development'
): Promise<HealthCheckResult> {
  const result: HealthCheckResult = {
    healthy: false,
    environment,
    port
  };

  let redis: Redis | null = null;

  try {
    // Create Redis connection
    redis = new Redis({
      port,
      host: 'localhost',
      connectTimeout: 5000,
      lazyConnect: true
    });

    // Test connectivity and measure latency
    const startTime = performance.now();
    await redis.connect();
    await redis.ping();
    const endTime = performance.now();
    
    result.latency = Math.round((endTime - startTime) * 100) / 100;

    // Get Redis info
    const info = await redis.info();
    result.info = parseRedisInfo(info);
    result.memory = parseMemoryInfo(info);
    
    result.healthy = true;
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
  } finally {
    if (redis) {
      await redis.disconnect();
    }
  }

  return result;
}

function parseRedisInfo(info: string): {
  version: string;
  uptime: number;
  connections: number;
} {
  const lines = info.split('\n');
  let version = 'unknown';
  let uptime = 0;
  let connections = 0;

  for (const line of lines) {
    if (line.startsWith('redis_version:')) {
      version = line.split(':')[1]?.trim() || 'unknown';
    } else if (line.startsWith('uptime_in_seconds:')) {
      uptime = parseInt(line.split(':')[1]?.trim() || '0');
    } else if (line.startsWith('connected_clients:')) {
      connections = parseInt(line.split(':')[1]?.trim() || '0');
    }
  }

  return { version, uptime, connections };
}

function parseMemoryInfo(info: string): {
  used: string;
  peak: string;
} {
  const lines = info.split('\n');
  let used = '0B';
  let peak = '0B';

  for (const line of lines) {
    if (line.startsWith('used_memory_human:')) {
      used = line.split(':')[1]?.trim() || '0B';
    } else if (line.startsWith('used_memory_peak_human:')) {
      peak = line.split(':')[1]?.trim() || '0B';
    }
  }

  return { used, peak };
}

function formatHealthResult(result: HealthCheckResult): string {
  const status = result.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY';
  const lines = [
    `Redis Health Check - ${status}`,
    `Environment: ${result.environment}`,
    `Port: ${result.port}`,
    ''
  ];

  if (result.healthy) {
    lines.push(
      `Latency: ${result.latency}ms`,
      `Version: ${result.info?.version}`,
      `Uptime: ${formatUptime(result.info?.uptime || 0)}`,
      `Connections: ${result.info?.connections}`,
      `Memory Used: ${result.memory?.used}`,
      `Memory Peak: ${result.memory?.peak}`
    );
  } else {
    lines.push(`Error: ${result.error}`);
  }

  return lines.join('\n');
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m ${seconds % 60}s`;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const port = parseInt(args[0] || '6379');
  const environment = args[1] || 'development';
  
  // eslint-disable-next-line no-console
  console.log(`🔍 Checking Redis health on port ${port}...\n`);
  
  try {
    const result = await checkRedisHealth(port, environment);
    // eslint-disable-next-line no-console
    console.log(formatHealthResult(result));
    
    // Exit with appropriate code
    process.exit(result.healthy ? 0 : 1);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Health check failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}

export { checkRedisHealth, HealthCheckResult };