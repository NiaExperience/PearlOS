/**
 * Configuration for Daily.co voice sessions
 * Centralized config to make voice session behavior easily tweakable
 */

import { getClientLogger } from '../client-logger';

import type { VoiceSessionConfig } from './types';

const log = getClientLogger('[daily_config]');

/**
 * Default voice session configuration
 * Optimized for voice-only 1:1 assistant conversations
 */
export const DEFAULT_VOICE_CONFIG: VoiceSessionConfig = {
  // Audio processing
  noiseCancellation: true,
  echoCancellation: true,
  autoGainControl: true,
  
  // Session behavior
  audioOnly: true,
  maxDuration: 3600, // 1 hour max
  defaultPersistence: 300, // 5 minutes after leave
  reconnectWindow: 300, // 5 minutes to reconnect
  
  // Daily.co SDK configuration
  dailyConfig: {
    subscribeToTracksAutomatically: true,
    receiveSettings: {
      video: 'off',
      audio: 'on',
    },
    inputSettings: {
      audio: {
        processor: {
          type: 'noise-cancellation',
        },
      },
    },
  },
  
  // Room security & behavior
  roomPrivacy: 'private',
  maxParticipants: 2, // User + bot only
  enableKnocking: false,
  enableScreenshare: true,
};

/**
 * Environment-aware voice session config
 * Override defaults with environment variables
 */
export const VOICE_SESSION_CONFIG: VoiceSessionConfig = {
  ...DEFAULT_VOICE_CONFIG,
  maxDuration: parseInt(
    process.env.NEXT_PUBLIC_VOICE_MAX_DURATION || '3600',
    10
  ),
  defaultPersistence: parseInt(
    process.env.NEXT_PUBLIC_VOICE_PERSISTENCE || '300',
    10
  ),
  reconnectWindow: parseInt(
    process.env.NEXT_PUBLIC_VOICE_RECONNECT_WINDOW || '300',
    10
  ),
};

/**
 * Daily.co API configuration
 */
export const DAILY_API_CONFIG = {
  apiUrl: 'https://api.daily.co/v1',
  apiKey: process.env.DAILY_API_KEY || process.env.NEXT_PUBLIC_DAILY_API_KEY || '',
  domain: process.env.DAILY_DOMAIN || process.env.NEXT_PUBLIC_DAILY_DOMAIN || 'pearlos.daily.co',
};

/**
 * Voice room naming convention
 */
export function getVoiceRoomName(userId: string): string {
  return `voice-${userId}`;
}

/**
 * Validate voice session config
 */
export function validateVoiceConfig(config: Partial<VoiceSessionConfig>): boolean {
  if (config.maxDuration && config.maxDuration <= 0) {
    log.warn('Invalid maxDuration', { maxDuration: config.maxDuration });
    return false;
  }
  
  if (config.defaultPersistence && config.defaultPersistence < 0) {
    log.warn('Invalid defaultPersistence', { defaultPersistence: config.defaultPersistence });
    return false;
  }
  
  if (config.maxParticipants && config.maxParticipants < 2) {
    log.warn('Invalid maxParticipants (must be >= 2)', { maxParticipants: config.maxParticipants });
    return false;
  }
  
  return true;
}

/**
 * Get Daily room properties for voice sessions
 */
export function getVoiceRoomProperties() {
  const config = VOICE_SESSION_CONFIG;
  
  return {
    privacy: config.roomPrivacy,
    enable_knocking: config.enableKnocking,
    enable_prejoin_ui: false,
    max_participants: config.maxParticipants,
    enable_network_ui: false,
    enable_screenshare: config.enableScreenshare,
    enable_chat: false,
    enable_recording: 'cloud',
    start_cloud_recording: true,
    // Room expires after max duration
    exp: Math.floor(Date.now() / 1000) + config.maxDuration,
  };
}
