/**
 * Daily.co token generation service
 * Handles meeting token creation for voice sessions
 */

import { getClientLogger } from '../client-logger';

import { DAILY_API_CONFIG } from './config';
import type { DailyTokenConfig } from './types';

const log = getClientLogger('[daily_token]');

/**
 * Generate a Daily meeting token
 * Tokens are required to join private rooms
 */
export async function generateVoiceRoomToken(
  config: DailyTokenConfig
): Promise<string> {
  const {
    roomName,
    userId,
    userName,
    isOwner = true,
    expiresInSeconds = 3600,
  } = config;

  if (!DAILY_API_CONFIG.apiKey) {
    throw new Error('Daily API key not configured');
  }

  log.info('Generating token', {
    roomName,
    userId,
    userName,
    isOwner,
    expiresInSeconds,
  });

  try {
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
          user_name: userName,
          is_owner: isOwner,
          enable_recording: 'cloud',
          start_video_off: true, // Voice-only
          start_audio_off: false,
          exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(
        `Failed to generate token: ${response.status} ${JSON.stringify(error)}`
      );
    }

    const data = await response.json();
    log.info('Token generated successfully', { roomName, userId });
    
    return data.token;
  } catch (error) {
    log.error('Error generating token', { error, roomName, userId });
    throw error;
  }
}

/**
 * Validate a Daily token (client-side basic check)
 * Note: This doesn't verify the token with Daily, just checks format
 */
export function validateTokenFormat(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  // Daily tokens are typically long alphanumeric strings
  if (token.length < 20) {
    return false;
  }

  return true;
}

/**
 * Parse token expiration time (if available in JWT format)
 * Returns null if cannot parse
 */
export function getTokenExpiration(token: string): Date | null {
  try {
    // Try to decode as JWT
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp) {
      return new Date(payload.exp * 1000);
    }

    return null;
  } catch (error) {
    log.warn('Could not parse token expiration', { error });
    return null;
  }
}
