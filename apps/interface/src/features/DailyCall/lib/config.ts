import { getClientLogger } from '@interface/lib/client-logger';

// os module is only available server-side; guarded below
let os: { hostname: () => string } | null = null;
if (typeof window === 'undefined') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    os = require('os');
  } catch {
    // Client-side: os is unavailable
  }
}

// Daily.co API configuration
export const DAILY_API_URL = process.env.DAILY_API_URL || 'https://api.daily.co/v1';
export const DAILY_API_KEY = process.env.DAILY_API_KEY;

const DEV_ROOM_PREFIX = 'dev-';
const DEV_ROOM_SUFFIX = '-dailycall';

const DEV_ENV = 'development';

const sanitizeSegment = (segment: string) => segment.toLowerCase().replace(/[^a-z0-9-]/g, '-');

const log = getClientLogger('[daily_call]');

export function getDevRoomName(hostnameOverride?: string): string {
  const hostname = sanitizeSegment(hostnameOverride ?? os?.hostname?.() ?? 'unknown');
  return `${DEV_ROOM_PREFIX}${hostname}${DEV_ROOM_SUFFIX}`;
}

export function getRoomNameFromUrl(roomUrl: string): string | null {
  if (!roomUrl) return null;
  try {
    const url = new URL(roomUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    // Daily room names can be case-sensitive; preserve exact room slug for meeting-token room matching.
    return decodeURIComponent(parts[parts.length - 1]);
  } catch (_) {
    return null;
  }
}

const isDevRoomName = (roomName: string | null | undefined) =>
  typeof roomName === 'string' && roomName.startsWith(DEV_ROOM_PREFIX) && roomName.endsWith(DEV_ROOM_SUFFIX);

/**
 * Get or create dev DailyCall room
 * In development, auto-generates a unique room per developer machine using hostname
 */
export async function getDevRoomUrl(): Promise<string> {
  if (!DAILY_API_KEY) {
    log.warn('Dev mode requires DAILY_API_KEY for auto-room creation', {
      event: 'daily_dev_room_missing_api_key',
    });
    return '';
  }

  const roomName = getDevRoomName();
  
  try {
    const roomEndpoint = `${DAILY_API_URL}/rooms/${roomName}`;

    // Check if room already exists
    const checkResponse = await fetch(roomEndpoint, {
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
    });

    if (checkResponse.ok) {
      const existingRoom = await checkResponse.json();
      log.info('Reusing existing dev room', {
        event: 'daily_dev_room_reuse',
        roomUrl: existingRoom.url,
      });
      
      // Ensure the room is valid by updating its expiry (keep-alive)
      // Also force privacy to public for dev to avoid token issues
      try {
        await fetch(roomEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${DAILY_API_KEY}`,
          },
          body: JSON.stringify({ 
            privacy: 'public',
            properties: { 
              exp: Math.floor(Date.now() / 1000) + 86400 
            } 
          }),
        });
      } catch (e) {
        log.warn('Failed to update dev room expiry/privacy', {
          event: 'daily_dev_room_keepalive_failed',
          error: e instanceof Error ? e.message : String(e),
        });
      }

      return existingRoom.url;
    } else if (checkResponse.status && checkResponse.status !== 404) {
      log.warn('Unexpected response when checking dev room', {
        event: 'daily_dev_room_check_unexpected',
        status: checkResponse.status,
      });
    }

    // Create new room
    log.info('Creating dev room', {
      event: 'daily_dev_room_create',
      roomName,
    });
    const createResponse = await fetch(`${DAILY_API_URL}/rooms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'public',
        properties: {
          enable_chat: true,
          enable_screenshare: true,
          enable_recording: 'cloud',
          start_cloud_recording: true,
          enable_transcription: false,
          max_participants: 10,
          eject_at_room_exp: false,
        },
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.json().catch(() => ({ error: 'Unknown error' }));
      log.error('Failed to create dev room', {
        event: 'daily_dev_room_create_failed',
        error,
      });
      return '';
    }

    const room = await createResponse.json();
    log.info('Dev room created', {
      event: 'daily_dev_room_created',
      roomUrl: room.url,
    });
    return room.url;
  } catch (error) {
    log.error('Error managing dev room', {
      event: 'daily_dev_room_error',
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

// Room configuration - auto-generate in dev, use env var in production
// NOTE: Caching disabled to prevent stale room URLs if the room is deleted externally or by previous runs
// let cachedDevRoomUrl: string | null = null;

export function resetDevRoomCache(): void {
  // cachedDevRoomUrl = null;
}

/**
 * Get DailyCall room URL (async version for dev auto-generation)
 * In dev mode without explicit env var, auto-generates unique room per developer machine
 */
export async function getDailyRoomUrl(): Promise<string> {
  // TODO: the intent is that the desktop mode and assistant ID
  // will create the room URL.
  const envRoomUrl =
    process.env.NEXT_PUBLIC_DAILY_ROOM_URL ||
    process.env.DAILY_ROOM_URL ||
    process.env.DAILYCALL_ROOM_URL;

  if (envRoomUrl) {
    return envRoomUrl;
  }

  if (process.env.NODE_ENV === DEV_ENV) {
    // In dev mode, always verify/create room to ensure it exists
    // if (cachedDevRoomUrl) {
    //   return cachedDevRoomUrl;
    // }

    const roomUrl = await getDevRoomUrl();
    // if (roomUrl) {
    //   cachedDevRoomUrl = roomUrl;
    // }
    return roomUrl;
  }

  // In production, always use env var if set
  return '';
}

export async function deleteDevRoom({ roomUrl, roomName }: { roomUrl?: string; roomName?: string } = {}): Promise<boolean> {
  if (process.env.NODE_ENV !== DEV_ENV) {
    return false;
  }

  if (!DAILY_API_KEY) {
    log.warn('Cannot delete dev room without DAILY_API_KEY', {
      event: 'daily_dev_room_delete_missing_api_key',
    });
    return false;
  }

  const resolvedRoomName = sanitizeSegment(
    roomName ?? getRoomNameFromUrl(roomUrl ?? '') ?? getDevRoomName()
  );

  if (!isDevRoomName(resolvedRoomName)) {
    log.warn('Refusing to delete non-dev room', {
      event: 'daily_dev_room_delete_refused',
      roomName: resolvedRoomName,
    });
    return false;
  }

  try {
    const response = await fetch(`${DAILY_API_URL}/rooms/${resolvedRoomName}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
    });

    if (response.ok || response.status === 404) {
      // cachedDevRoomUrl = null;
      return true;
    }

    const payload = await response.json().catch(() => ({}));
    log.warn('Failed to delete dev room', {
      event: 'daily_dev_room_delete_failed',
      status: response.status,
      body: payload,
    });
  } catch (error) {
    log.warn('Error deleting dev room', {
      event: 'daily_dev_room_delete_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return false;
}

// Bot control base (legacy server) - build-time public env preferred
export const BOT_CONTROL_BASE_URL = (process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || process.env.BOT_CONTROL_BASE_URL || '');

export const BOT_PERSONALITY = (process.env.NEXT_PUBLIC_BOT_PERSONALITY || process.env.BOT_PERSONALITY || 'pearl').toLowerCase();

// Bot retention policy: 'owner' (leave when spawning owner leaves) or 'last' (leave only when last participant leaves)
export const BOT_RETENTION = (process.env.NEXT_PUBLIC_BOT_RETENTION || process.env.BOT_RETENTION || 'owner').toLowerCase();

// Auto join toggle: when true, skip PreJoin screen and immediately join with
// resolved username (session.name -> session.user.email local-part -> 'guest').
// Default is false to show the pre-join screen where users can enter their name.
export const BOT_AUTO_JOIN = (() => {
	const publicVar = process.env.NEXT_PUBLIC_BOT_AUTO_JOIN;
	const serverVar = process.env.BOT_AUTO_JOIN;
	const raw = publicVar || serverVar || 'false';
	
	// Debug logging to help troubleshoot auto-join issues
	if (typeof window !== 'undefined') {
    log.debug('BOT_AUTO_JOIN debug', {
      event: 'daily_bot_auto_join_debug',
      NEXT_PUBLIC_BOT_AUTO_JOIN: publicVar,
      BOT_AUTO_JOIN: serverVar,
      raw,
      result: !['false', '0', 'no', 'off'].includes(raw.toLowerCase())
    });
	}
	
	return !['false', '0', 'no', 'off'].includes(raw.toLowerCase());
})();
