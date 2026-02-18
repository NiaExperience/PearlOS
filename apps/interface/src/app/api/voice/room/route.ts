/**
 * Voice Room Management API
 * POST /api/voice/room - Create or get existing voice room for user
 * 
 * This endpoint integrates with Daily.co to manage persistent voice rooms
 * for voice-only assistant sessions.
 */

import { getSessionSafely } from "@nia/prism/core/auth";
import { NextRequest, NextResponse } from "next/server";

import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { getLogger } from "@interface/lib/logger";

export const dynamic = "force-dynamic";

const log = getLogger('[api_voice_room]');

// Daily.co API configuration
const DAILY_API_URL = process.env.DAILY_API_URL || 'https://api.daily.co/v1';
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DEFAULT_SESSION_PERSISTENCE = parseInt(
  process.env.VOICE_SESSION_PERSISTENCE_SECONDS || '300',
  10
);

interface VoiceRoomRequest {
  userId?: string;
  persistence?: number; // Seconds to keep room alive after disconnect
}

interface VoiceRoomResponse {
  roomName: string;
  roomUrl: string;
  token: string;
  expiresAt: string;
  reused: boolean;
}

/**
 * Get voice room name for user
 * Deterministic naming: voice-{userId}
 */
function getVoiceRoomName(userId: string): string {
  return `voice-${userId}`;
}

/**
 * Get Daily room properties for voice sessions
 */
function getVoiceRoomProperties() {
  return {
    enable_chat: false,
    enable_screenshare: true,
    enable_recording: 'cloud',
    enable_transcription: false,
    start_video_off: true,
    start_audio_off: false,
    max_participants: 10,
    eject_at_room_exp: true,
    // Force SFU mode to avoid "Switch to soup failed" errors during recording start
    enable_mesh_sfu: true,
  };
}

/**
 * Check if a Daily room exists
 */
async function checkRoomExists(roomName: string): Promise<{ exists: boolean; url?: string }> {
  if (!DAILY_API_KEY) {
    log.warn('No Daily API key configured');
    return { exists: false };
  }

  try {
    const response = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
      headers: {
        Authorization: `Bearer ${DAILY_API_KEY}`,
      },
    });

    if (response.ok) {
      const room = await response.json();
      const screenshareEnabled = room?.properties?.enable_screenshare === true;
      // Check for SFU mode to ensure recording reliability
      const sfuEnabled = room?.properties?.enable_mesh_sfu === true;
      
      if (!screenshareEnabled || !sfuEnabled) {
        log.info('Room missing required capabilities, recreating', { roomName });
        try {
          const deleteResponse = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${DAILY_API_KEY}`,
            },
          });

          if (!deleteResponse.ok && deleteResponse.status !== 404) {
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to delete room: ${deleteResponse.status} ${errorText}`);
          }

          // Wait for deletion to propagate
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (deleteError) {
          log.warn('Failed to delete outdated room', { error: deleteError });
          // If deletion failed, we can't proceed with creation
          throw deleteError;
        }
        return { exists: false };
      }
      return { exists: true, url: room.url };
    }

    return { exists: false };
  } catch (error) {
    log.error('Error checking room', { error, roomName });
    return { exists: false };
  }
}

/**
 * Create a new Daily room
 */
async function createDailyRoom(roomName: string): Promise<{ url: string; name: string }> {
  if (!DAILY_API_KEY) {
    throw new Error('Daily API key not configured');
  }

  log.info('Creating room', { roomName });

  const response = await fetch(`${DAILY_API_URL}/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_KEY}`,
    },
    body: JSON.stringify({
      name: roomName,
      privacy: 'private',
      properties: getVoiceRoomProperties(),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    
    // Handle race condition where room was created by another request
    if (response.status === 400 && JSON.stringify(error).includes('already exists')) {
      log.info('Room existed during creation (race condition), fetching details', { roomName });
      const getResponse = await fetch(`${DAILY_API_URL}/rooms/${roomName}`, {
        headers: { Authorization: `Bearer ${DAILY_API_KEY}` },
      });
      
      if (getResponse.ok) {
        const room = await getResponse.json();
        return { url: room.url, name: room.name };
      }
    }

    throw new Error(`Failed to create Daily room: ${response.status} ${JSON.stringify(error)}`);
  }

  const room = await response.json();
  log.info('Room created', { name: room.name, url: room.url });

  return { url: room.url, name: room.name };
}

/**
 * Generate a meeting token for a voice room
 */
async function generateRoomToken(roomName: string, userId: string): Promise<string> {
  if (!DAILY_API_KEY) {
    throw new Error('Daily API key not configured');
  }

  const response = await fetch(`${DAILY_API_URL}/meeting-tokens`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DAILY_API_KEY}`,
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
 * POST /api/voice/room
 * Create or get existing voice room for user
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Check authentication (allow bypass in dev mode)
    const session = await getSessionSafely(req, interfaceAuthOptions);
    const isTestMode = process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true';
    const isDev = process.env.NODE_ENV === 'development';

    // Parse request body
    const body: VoiceRoomRequest = await req.json().catch(() => ({}));
    
    // Get userId - allow from body in dev/test mode, otherwise require session
    let userId: string | undefined;
    
    if (isTestMode || (isDev && body.userId)) {
      // Dev/test mode: allow userId from request body
      userId = body.userId || session?.user?.id || 'dev-user-' + Date.now();
      log.info('Dev/test mode: Using userId from request or generated', { userId, isTestMode, isDev });
    } else {
      // Production mode: require valid session
      if (!session || !session.user) {
        log.warn('Unauthorized - no valid session');
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      userId = body.userId || session.user.id;
    }
    
    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Get persistence config
    const persistence = body.persistence || DEFAULT_SESSION_PERSISTENCE;

    log.info('Creating/getting voice room for user', { userId });

    // Generate room name
    const roomName = getVoiceRoomName(userId);

    // Check if room exists, create if not
    const existing = await checkRoomExists(roomName);
    let roomUrl: string;
    let reused = false;

    if (existing.exists && existing.url) {
      log.info('Room already exists, reusing', { roomName });
      roomUrl = existing.url;
      reused = true;
    } else {
      log.info('Creating new room', { roomName });
      const room = await createDailyRoom(roomName);
      roomUrl = room.url;
      reused = false;
    }

    // Generate token
    const token = await generateRoomToken(roomName, userId);

    // Calculate expiration
    const expiresAt = new Date(Date.now() + persistence * 1000).toISOString();

    const response: VoiceRoomResponse = {
      roomName,
      roomUrl,
      token,
      expiresAt,
      reused,
    };

    log.info('Room ready', { roomName, reused });

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    log.error('Error creating room', { error });
    
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to create voice room', details: message },
      { status: 500 }
    );
  }
}
