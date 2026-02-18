import Redis from 'ioredis';

import { getLogger } from './logger';

const IS_TEST_ENV = process.env.NODE_ENV === 'test';
const USE_REDIS = (process.env.USE_REDIS || 'false').toLowerCase() === 'true';
const IS_BUILD_PHASE = (process.env.NEXT_PHASE || '').toLowerCase() === 'phase-production-build';
const DISABLE_AUTO_CONNECT = (process.env.REDIS_DISABLE_AUTO_CONNECT || '').toLowerCase() === 'true';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const REDIS_SHARED_SECRET = process.env.REDIS_SHARED_SECRET;

const log = getLogger('[redis]');
const logInfo = (message: string, meta?: Record<string, unknown>) => {
  if (IS_TEST_ENV) return;
  log.info(message, meta);
};

const logWarn = (message: string, meta?: Record<string, unknown>) => {
  if (IS_TEST_ENV) return;
  log.warn(message, meta);
};

const redisUrlWithPassword = (() => {
  if (!REDIS_SHARED_SECRET) return REDIS_URL;
  try {
    const url = new URL(REDIS_URL);
    if (!url.password) {
      url.password = REDIS_SHARED_SECRET;
    }
    return url.toString();
  } catch (_err) {
    return REDIS_URL;
  }
})();

let redis: Redis | null = null;

if (USE_REDIS) {
  try {
    // Create a Redis client with lazy connection to avoid immediate failure
    // if Redis is not available during build/startup
    redis = new Redis(redisUrlWithPassword, {
      password: REDIS_SHARED_SECRET,
      lazyConnect: true,
      // Allow ioredis to keep retrying in the background instead of ending the connection
      maxRetriesPerRequest: 5,
      retryStrategy: IS_TEST_ENV ? () => null : (times) => Math.min(times * 100, 3000),
    });

    // Handle error events to prevent crashing
    redis.on('error', (err) => {
      // Suppress connection refused errors in logs to avoid noise if Redis is intentionally missing
      if ((err as any).code === 'ECONNREFUSED') {
        return;
      }

      log.error('Redis client error', {
        message: (err as any)?.message,
        code: (err as any)?.code,
        name: (err as any)?.name,
        stack: (err as any)?.stack,
        status: redis?.status,
      });
    });

    redis.on('connect', () => {
      logInfo('Redis client connect event');
    });

    redis.on('ready', () => {
      logInfo('Redis client ready');
    });

    redis.on('close', () => {
      logInfo('Redis client close event');
    });

    redis.on('end', () => {
      logInfo('Redis client end event');
    });

    redis.on('reconnecting', () => {
      logWarn('Redis client reconnecting');
    });

    // Attempt to connect (non-blocking)
    // In test environment, we don't want to auto-connect to avoid open handles
    // unless explicitly needed by the test
    const shouldAutoConnect = !IS_TEST_ENV && !IS_BUILD_PHASE && !DISABLE_AUTO_CONNECT;
    if (shouldAutoConnect) {
      redis.connect().catch(() => {
        // Ignore initial connection failure, will retry or fail gracefully on usage
      });
    } else {
      logWarn('Redis client initialization skipped auto-connect (build/test/disabled)');
    }

    logInfo('Redis client initialized (lazy)');
  } catch (error) {
    log.error('Failed to initialize Redis client', {
      message: (error as any)?.message,
      name: (error as any)?.name,
      stack: (error as any)?.stack,
    });
    redis = null;
  }
} else {
  logWarn('Redis disabled because USE_REDIS is not true; skipping client initialization');
}

export async function disconnectRedis() {
  if (!redis) return;

  try {
    await redis.quit();
  } catch (err) {
    logWarn('Failed to quit Redis client during shutdown', {
      error: String((err as Error)?.message || err),
    });
  } finally {
    redis.removeAllListeners();
    redis = null;
  }
}

export default redis;
