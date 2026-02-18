/**
 * Daily.co room lifecycle management for voice sessions
 * Handles room creation, reuse, and cleanup
 */

import { getClientLogger } from '../client-logger';

import { 
  getVoiceRoomName, 
  getVoiceRoomProperties, 
  DAILY_API_CONFIG 
} from './config';
import type { VoiceRoom } from './types';

const log = getClientLogger('[daily_room]');

/**
 * In-memory cache of active voice rooms
 * Maps userId -> room info
 */
const activeRooms = new Map<string, VoiceRoom>();

/**
 * Check if a Daily room exists
 */
async function checkRoomExists(roomName: string): Promise<{ exists: boolean; url?: string }> {
  if (!DAILY_API_CONFIG.apiKey) {
    log.warn('No Daily API key configured');
    return { exists: false };
  }

  try {
    const response = await fetch(
      `${DAILY_API_CONFIG.apiUrl}/rooms/${roomName}`,
      {
        headers: {
          Authorization: `Bearer ${DAILY_API_CONFIG.apiKey}`,
        },
      }
    );

    if (response.ok) {
      const room = await response.json();
      const screenshareEnabled = room?.properties?.enable_screenshare === true;
      if (!screenshareEnabled) {
        log.info('Room missing screenshare support, deleting', { roomName });
        try {
          await fetch(`${DAILY_API_CONFIG.apiUrl}/rooms/${roomName}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${DAILY_API_CONFIG.apiKey}`,
            },
          });
        } catch (deleteError) {
          log.warn('Failed to delete outdated room', { error: deleteError });
        }
        return { exists: false };
      }
      return { exists: true, url: room.url };
    }

    return { exists: false };
  } catch (error) {
    log.error('Error checking room existence', { error, roomName });
    return { exists: false };
  }
}

/**
 * Create a new Daily room for voice sessions
 */
async function createDailyRoom(roomName: string): Promise<{ url: string; name: string }> {
  if (!DAILY_API_CONFIG.apiKey) {
    throw new Error('Daily API key not configured');
  }

  log.info('Creating room', { roomName });

  const response = await fetch(`${DAILY_API_CONFIG.apiUrl}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      name: roomName,
      properties: getVoiceRoomProperties(),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to create Daily room: ${response.status} ${JSON.stringify(error)}`);
  }

  const room = await response.json();
  log.info('Room created', { name: room.name, url: room.url });

  return { url: room.url, name: room.name };
}

/**
 * Generate a meeting token for a voice room
 */
async function generateRoomToken(
  roomName: string,
  userId: string
): Promise<string> {
  if (!DAILY_API_CONFIG.apiKey) {
    throw new Error('Daily API key not configured');
  }

  const response = await fetch(`${DAILY_API_CONFIG.apiUrl}/meeting-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_CONFIG.apiKey}`,
    },
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_id: userId,
        is_owner: true,
        enable_recording: 'cloud',
        start_video_off: true,
        start_audio_off: false,
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Failed to generate token: ${response.status} ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return data.token;
}

/**
 * Get or create a voice room for a user
 * Implements room reuse logic - same user always gets the same room
 */
export async function getOrCreateVoiceRoom(
  userId: string,
  config?: { persistence?: number }
): Promise<VoiceRoom> {
  log.info('Getting voice room for user', { userId });

  // Check cache first
  const cached = activeRooms.get(userId);
  if (cached) {
    const now = new Date();
    if (cached.expiresAt > now) {
      log.info('Using cached room', { roomName: cached.roomName });
      return { ...cached, reused: true };
    } else {
      log.info('Cached room expired, creating new', { roomName: cached.roomName });
      activeRooms.delete(userId);
    }
  }

  const roomName = getVoiceRoomName(userId);

  // Check if room exists in Daily
  const existing = await checkRoomExists(roomName);
  let roomUrl: string;
  let reused = false;

  if (existing.exists && existing.url) {
    log.info('Room exists, reusing', { roomName });
    roomUrl = existing.url;
    reused = true;
  } else {
    log.info('Creating new room', { roomName });
    const room = await createDailyRoom(roomName);
    roomUrl = room.url;
    reused = false;
  }

  // Generate fresh token
  const token = await generateRoomToken(roomName, userId);

  const now = new Date();
  const persistence = config?.persistence ?? 300;
  const expiresAt = new Date(now.getTime() + persistence * 1000);

  const voiceRoom: VoiceRoom = {
    roomUrl,
    roomName,
    token,
    reused,
    expiresAt,
    createdAt: now,
  };

  // Cache for future requests
  activeRooms.set(userId, voiceRoom);

  log.info('Voice room ready', {
    roomName,
    reused,
    expiresAt: expiresAt.toISOString(),
  });

  return voiceRoom;
}

/**
 * Leave a voice room
 * Room will be cleaned up based on persistence settings
 */
export async function leaveVoiceRoom(
  roomUrl: string,
  teardownDelay: number = 300
): Promise<void> {
  log.info('Leaving room', { roomUrl, teardownDelay });

  // Find room in cache
  for (const [userId, room] of activeRooms.entries()) {
    if (room.roomUrl === roomUrl) {
      // Update expiration time
      const expiresAt = new Date(Date.now() + teardownDelay * 1000);
      room.expiresAt = expiresAt;
      activeRooms.set(userId, room);

      log.info('Room will persist until', { roomUrl, expiresAt: expiresAt.toISOString() });
      return;
    }
  }

  log.warn('Room not found in cache', { roomUrl });
}

/**
 * Delete a Daily room immediately
 * Used for cleanup or when persistence is 0
 */
export async function deleteVoiceRoom(roomName: string): Promise<void> {
  if (!DAILY_API_CONFIG.apiKey) {
    log.warn('No Daily API key, cannot delete room');
    return;
  }

  log.info('Deleting room', { roomName });

  try {
    const response = await fetch(
      `${DAILY_API_CONFIG.apiUrl}/rooms/${roomName}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${DAILY_API_CONFIG.apiKey}`,
        },
      }
    );

    if (!response.ok) {
      log.error('Failed to delete room', { status: response.status });
    } else {
      log.info('Room deleted', { roomName });
    }
  } catch (error) {
    log.error('Error deleting room', { error, roomName });
  }

  // Remove from cache
  for (const [userId, room] of activeRooms.entries()) {
    if (room.roomName === roomName) {
      activeRooms.delete(userId);
      break;
    }
  }
}

/**
 * Get active voice rooms (for debugging)
 */
export function getActiveRooms(): Map<string, VoiceRoom> {
  return new Map(activeRooms);
}

/**
 * Clear expired rooms from cache
 */
export function cleanupExpiredRooms(): void {
  const now = new Date();
  let cleaned = 0;

  for (const [userId, room] of activeRooms.entries()) {
    if (room.expiresAt <= now) {
      activeRooms.delete(userId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log.info('Cleaned up expired rooms', { cleaned });
  }
}

// Run cleanup every 60 seconds
if (typeof window !== 'undefined') {
  setInterval(cleanupExpiredRooms, 60000);
}
