/**
 * Hook to track bot participant in a Daily call
 * 
 * Monitors for bot participant and provides their ID and info.
 * Handles both scenarios:
 * - Bot already in room when hook mounts
 * - Bot joins after hook mounts (via participant-joined event)
 * 
 * @example
 * ```tsx
 * const { botParticipantId, botInfo } = useBotParticipant(callObject);
 * 
 * // With expected persona name for better matching
 * const { botParticipantId } = useBotParticipant(callObject, { expectedPersonaName: 'Pearl' });
 * 
 * // Use bot participant ID with audio monitoring
 * useAudioLevelObserver(botParticipantId || '', handleAudioLevel);
 * ```
 */

import type { DailyCall } from '@daily-co/daily-js';
import { useState, useEffect } from 'react';

import { getBotParticipant, type BotParticipantOptions } from '../participant-manager';
import type { ParticipantIdentity } from '../types';

export interface UseBotParticipantReturn {
  /** Bot's Daily session_id (participant ID), or null if not found */
  botParticipantId: string | null;
  
  /** Bot's participant identity info (username, userId, etc.), or null if not found */
  botInfo: Partial<ParticipantIdentity> | null;
}

/**
 * Hook to track bot participant in a Daily call
 * 
 * @param callObject - Daily call object, or null if not connected
 * @param options - Optional configuration including expected persona name
 * @returns Object with botParticipantId and botInfo
 */
export function useBotParticipant(
  callObject: DailyCall | null,
  options: BotParticipantOptions = {}
): UseBotParticipantReturn {
  const [botParticipantId, setBotParticipantId] = useState<string | null>(null);
  const [botInfo, setBotInfo] = useState<Partial<ParticipantIdentity> | null>(null);

  useEffect(() => {
    if (!callObject) {
      setBotParticipantId(null);
      setBotInfo(null);
      return;
    }

    // Check for existing bot participant
    const checkForBot = () => {
      const info = getBotParticipant(callObject, options);
      if (info?.participantId) {
        setBotParticipantId(info.participantId);
        setBotInfo(info);
      }
    };

    // Check immediately on mount
    checkForBot();

    // Listen for participant-joined in case bot joins after user
    const handleParticipantJoined = () => {
      checkForBot();
    };

    callObject.on('participant-joined', handleParticipantJoined);

    return () => {
      callObject.off('participant-joined', handleParticipantJoined);
    };
  }, [callObject, options.expectedPersonaName]);

  return { botParticipantId, botInfo };
}
