/**
 * User Timeout Service
 * 
 * Manages temporary user timeouts (kicks) from DailyCall rooms.
 * Timeouts are stored in Redis with TTL for automatic expiration.
 * Falls back to in-memory storage when Redis is unavailable.
 */

import { getLogger } from '@interface/lib/logger';
import redis from '@interface/lib/redis';

const log = getLogger('[daily_call:timeout]');

// Timeout durations in seconds
export const TIMEOUT_DURATIONS = {
  '5m': 5 * 60,
  '15m': 15 * 60,
  '30m': 30 * 60,
  '60m': 60 * 60,
  'forever': -1, // Special value indicating permanent ban via deny list
} as const;

export type TimeoutDuration = keyof typeof TIMEOUT_DURATIONS;

// Redis key prefix for user timeouts
const TIMEOUT_KEY_PREFIX = 'nia:dailycall:timeout:';

// In-memory fallback for when Redis is unavailable
const memoryTimeouts: Map<string, { expiresAt: number; kickedBy: string; reason?: string }> = new Map();

/**
 * Generate Redis key for user timeout
 */
function getTimeoutKey(userId: string, roomUrl?: string): string {
  // If roomUrl is provided, create a room-specific timeout
  // Otherwise, create a global timeout that applies to all rooms
  if (roomUrl) {
    const roomHash = Buffer.from(roomUrl).toString('base64').slice(-16);
    return `${TIMEOUT_KEY_PREFIX}room:${roomHash}:user:${userId}`;
  }
  return `${TIMEOUT_KEY_PREFIX}global:user:${userId}`;
}

/**
 * Set a timeout for a user
 * @param userId - The user ID to timeout
 * @param duration - Duration key (5m, 15m, 30m, 60m, or forever)
 * @param kickedBy - Admin user ID who initiated the kick
 * @param roomUrl - Optional room URL for room-specific timeout
 * @param reason - Optional reason for the timeout
 * @returns true if timeout was set successfully
 */
export async function setUserTimeout(
  userId: string,
  duration: TimeoutDuration,
  kickedBy: string,
  roomUrl?: string,
  reason?: string
): Promise<{ success: boolean; isForever: boolean }> {
  const seconds = TIMEOUT_DURATIONS[duration];
  const isForever = seconds === -1;
  
  // For 'forever', we don't store in Redis - caller should add to deny list
  if (isForever) {
    log.info('Forever timeout requested - user should be added to deny list', {
      userId,
      kickedBy,
      roomUrl,
    });
    return { success: true, isForever: true };
  }
  
  const timeoutData = {
    userId,
    kickedBy,
    reason: reason || 'Kicked by admin',
    expiresAt: Date.now() + (seconds * 1000),
    createdAt: Date.now(),
  };
  
  const key = getTimeoutKey(userId, roomUrl);
  
  // Try Redis first
  if (redis) {
    try {
      await redis.setex(key, seconds, JSON.stringify(timeoutData));
      log.info('User timeout set in Redis', {
        userId,
        duration,
        seconds,
        kickedBy,
        key,
      });
      return { success: true, isForever: false };
    } catch (error) {
      log.warn('Failed to set timeout in Redis, falling back to memory', { error });
    }
  }
  
  // Fallback to memory storage
  memoryTimeouts.set(key, {
    expiresAt: timeoutData.expiresAt,
    kickedBy,
    reason,
  });
  
  // Schedule cleanup for memory storage
  setTimeout(() => {
    memoryTimeouts.delete(key);
    log.debug('Memory timeout expired and cleaned up', { userId, key });
  }, seconds * 1000);
  
  log.info('User timeout set in memory (Redis unavailable)', {
    userId,
    duration,
    seconds,
    kickedBy,
  });
  
  return { success: true, isForever: false };
}

/**
 * Check if a user is currently in timeout
 * @param userId - The user ID to check
 * @param roomUrl - Optional room URL to check room-specific timeout
 * @returns Timeout info if user is timed out, null otherwise
 */
export async function getUserTimeout(
  userId: string,
  roomUrl?: string
): Promise<{
  isTimedOut: boolean;
  expiresAt?: number;
  remainingSeconds?: number;
  kickedBy?: string;
  reason?: string;
}> {
  // Check both global and room-specific timeouts
  const keysToCheck = [
    getTimeoutKey(userId), // Global timeout
  ];
  if (roomUrl) {
    keysToCheck.push(getTimeoutKey(userId, roomUrl)); // Room-specific timeout
  }
  
  // Try Redis first
  if (redis) {
    try {
      for (const key of keysToCheck) {
        const data = await redis.get(key);
        if (data) {
          const parsed = JSON.parse(data);
          const remainingSeconds = Math.max(0, Math.floor((parsed.expiresAt - Date.now()) / 1000));
          
          if (remainingSeconds > 0) {
            log.debug('User timeout found in Redis', {
              userId,
              key,
              remainingSeconds,
            });
            return {
              isTimedOut: true,
              expiresAt: parsed.expiresAt,
              remainingSeconds,
              kickedBy: parsed.kickedBy,
              reason: parsed.reason,
            };
          }
        }
      }
    } catch (error) {
      log.warn('Failed to check timeout in Redis, falling back to memory', { error });
    }
  }
  
  // Fallback to memory storage
  for (const key of keysToCheck) {
    const memTimeout = memoryTimeouts.get(key);
    if (memTimeout && memTimeout.expiresAt > Date.now()) {
      const remainingSeconds = Math.floor((memTimeout.expiresAt - Date.now()) / 1000);
      log.debug('User timeout found in memory', {
        userId,
        key,
        remainingSeconds,
      });
      return {
        isTimedOut: true,
        expiresAt: memTimeout.expiresAt,
        remainingSeconds,
        kickedBy: memTimeout.kickedBy,
        reason: memTimeout.reason,
      };
    }
  }
  
  return { isTimedOut: false };
}

/**
 * Remove a user's timeout (early release)
 * @param userId - The user ID to release
 * @param roomUrl - Optional room URL for room-specific timeout
 * @returns true if timeout was removed
 */
export async function removeUserTimeout(
  userId: string,
  roomUrl?: string
): Promise<boolean> {
  const key = getTimeoutKey(userId, roomUrl);
  
  // Try Redis first
  if (redis) {
    try {
      const deleted = await redis.del(key);
      if (deleted > 0) {
        log.info('User timeout removed from Redis', { userId, key });
        return true;
      }
    } catch (error) {
      log.warn('Failed to remove timeout from Redis', { error });
    }
  }
  
  // Also try memory storage
  if (memoryTimeouts.has(key)) {
    memoryTimeouts.delete(key);
    log.info('User timeout removed from memory', { userId, key });
    return true;
  }
  
  return false;
}

/**
 * Format remaining timeout for display
 */
export function formatTimeoutRemaining(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return 'expired';
  
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  
  return `${seconds}s`;
}
