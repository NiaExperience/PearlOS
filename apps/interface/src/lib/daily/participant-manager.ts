/**
 * Participant identity and tracking management for voice sessions
 * Handles mapping between user IDs, participant IDs, and session metadata
 */

import type { DailyCall, DailyParticipant } from '@daily-co/daily-js';

import { getClientLogger } from '../client-logger';

import type { ParticipantIdentity } from './types';

const log = getClientLogger('[daily_participant]');

/**
 * In-memory participant identity map
 * Maps Daily participant ID -> user identity
 */
const participantIdentities = new Map<string, ParticipantIdentity>();

/**
 * Store participant identity
 */
export function setParticipantIdentity(
  participantId: string,
  identity: ParticipantIdentity
): void {
  participantIdentities.set(participantId, identity);
  log.info('Stored identity', {
    participantId,
    userId: identity.userId,
    username: identity.username,
  });
}

/**
 * Get participant identity by Daily participant ID
 */
export function getParticipantIdentity(
  participantId: string
): ParticipantIdentity | null {
  return participantIdentities.get(participantId) || null;
}

/**
 * Get all participant identities
 */
export function getAllParticipantIdentities(): Map<string, ParticipantIdentity> {
  return new Map(participantIdentities);
}

/**
 * Clear participant identity
 */
export function clearParticipantIdentity(participantId: string): void {
  participantIdentities.delete(participantId);
  log.info('Cleared identity', { participantId });
}

/**
 * Clear all participant identities (cleanup)
 */
export function clearAllParticipantIdentities(): void {
  participantIdentities.clear();
  log.info('Cleared all identities');
}

/**
 * Extract participant info from Daily participant object
 */
export function extractParticipantInfo(
  participant: DailyParticipant
): Partial<ParticipantIdentity> {
  return {
    participantId: participant.session_id,
    username: participant.user_name || 'Unknown',
    userId: participant.user_id || undefined,
  };
}

/**
 * Get local participant info from Daily call object
 */
export function getLocalParticipant(
  callObject: DailyCall
): Partial<ParticipantIdentity> | null {
  try {
    const participants = callObject.participants();
    const local = participants?.local;

    if (!local) {
      return null;
    }

    return extractParticipantInfo(local);
  } catch (error) {
    log.error('Error getting local participant', { error });
    return null;
  }
}

/**
 * Get remote participants from Daily call object
 */
export function getRemoteParticipants(
  callObject: DailyCall
): Array<Partial<ParticipantIdentity>> {
  try {
    const participants = callObject.participants();
    
    if (!participants) {
      return [];
    }

    const remoteParticipants: Array<Partial<ParticipantIdentity>> = [];

    for (const [id, participant] of Object.entries(participants)) {
      if (id !== 'local' && !participant.local) {
        remoteParticipants.push(extractParticipantInfo(participant));
      }
    }

    return remoteParticipants;
  } catch (error) {
    log.error('Error getting remote participants', { error });
    return [];
  }
}

/**
 * Options for bot participant identification
 */
export interface BotParticipantOptions {
  /** Expected persona name (e.g., "Pearl", "T") - bot's username should match this */
  expectedPersonaName?: string;
}

/**
 * Check if a participant is the bot
 * Bot can be identified by username, user_id, session_id patterns, or userData flags
 * 
 * NOTE: The bot's username might be a custom personality name (like "T", "Pearl", etc)
 * that doesn't match typical bot patterns, so we check multiple signals.
 * 
 * @param participant - Daily participant to check
 * @param options - Optional configuration including expected persona name
 */
export function isBotParticipant(
  participant: DailyParticipant,
  options: BotParticipantOptions = {}
): boolean {
  const { expectedPersonaName } = options;
  const username = participant.user_name?.toLowerCase() || '';
  const userId = participant.user_id?.toLowerCase() || '';
  const sessionId = participant.session_id?.toLowerCase() || '';
  const userData = participant.userData as Record<string, unknown> | undefined;

  // Check explicit isBot flag (most reliable)
  if (userData?.isBot === true || userData?.type === 'pearl-bot') {
    return true;
  }
  
  // Check expected persona name match (e.g., "T", "Pearl")
  // Bot joins with `persona.capitalize()` as username
  if (expectedPersonaName && participant.user_name) {
    const normalizedExpected = expectedPersonaName.toLowerCase().trim();
    const normalizedUsername = participant.user_name.toLowerCase().trim();
    if (normalizedExpected === normalizedUsername) {
      log.info('Identified bot via persona name match', {
        participantId: participant.session_id,
        username: participant.user_name,
        expectedPersonaName,
      });
      return true;
    }
  }
  
  // Check username patterns
  if (
    username.includes('bot') ||
    username.includes('assistant') ||
    username.includes('nia') ||
    username === 'pearl'
  ) {
    return true;
  }
  
  // Check user_id patterns
  if (userId.includes('bot') || userId.includes('assistant')) {
    return true;
  }
  
  // Check session_id patterns
  if (sessionId.startsWith('bot-') || sessionId.includes('pipecat')) {
    return true;
  }
  
  // Heuristic fallback: If the participant has NO session_user_id in userData, 
  // it's likely the bot (humans join with session metadata containing user ID)
  // This handles cases where the bot personality name is custom (e.g., "T")
  const hasSessionUserId = !!(userData?.session_user_id || userData?.sessionUserId);
  const hasUserMetadata = !!(userData?.user_id || userData?.userId);
  
  // Bot participants typically don't have session user metadata that regular users have
  if (!participant.local && !hasSessionUserId && !hasUserMetadata) {
    // Additional check: ensure participant has audio (bots speak)
    const hasAudioTrack = participant.tracks?.audio?.state === 'playable' || 
                          participant.tracks?.audio?.state === 'loading';
    if (hasAudioTrack) {
      log.info('Identified bot via heuristic (no user metadata, has audio)', {
        participantId: participant.session_id,
        username: participant.user_name,
      });
      return true;
    }
  }

  return false;
}

/**
 * Get bot participant from call
 * 
 * @param callObject - Daily call object
 * @param options - Optional configuration including expected persona name for better matching
 */
export function getBotParticipant(
  callObject: DailyCall,
  options: BotParticipantOptions = {}
): Partial<ParticipantIdentity> | null {
  try {
    const participants = callObject.participants();
    
    if (!participants) {
      return null;
    }

    for (const [id, participant] of Object.entries(participants)) {
      if (id !== 'local' && !participant.local && isBotParticipant(participant, options)) {
        return extractParticipantInfo(participant);
      }
    }

    return null;
  } catch (error) {
    log.error('Error getting bot participant', { error });
    return null;
  }
}

/**
 * Set user metadata for Daily participant
 * This can be used to store additional context
 */
export async function setParticipantMetadata(
  callObject: DailyCall,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await callObject.setUserData(metadata);
    log.info('Set user metadata', { metadata });
  } catch (error) {
    log.error('Error setting metadata', { error });
    throw error;
  }
}
