/**
 * Daily.co event bridge for voice sessions
 * Converts Daily SDK events to React-friendly callbacks
 */

import type { DailyCall, DailyEventObject } from '@daily-co/daily-js';

import { routeNiaEvent } from '@interface/features/DailyCall/events/niaEventRouter';
import { isAssistantSelfCloseNiaEvent } from '@interface/lib/assistant-feature-sync';

import { getClientLogger } from '../client-logger';

import type { VoiceEventCallbacks, TranscriptEvent } from './types';

const log = getClientLogger('[daily_events]');

/**
 * Setup event bridge between Daily call object and React callbacks
 * Returns cleanup function to remove all listeners
 */
export function setupVoiceSessionEventBridge(
  callObject: DailyCall,
  callbacks: VoiceEventCallbacks,
  options: {
    allowAssistantSelfClose?: boolean;
    onAssistantSelfCloseEventBlocked?: (eventName: string, payload: unknown) => void;
    getRoomUrl?: () => string | null;
  } = {}
): () => void {
  // Log initial call object state before setting up handlers
  const initialMeetingState = callObject.meetingState?.();
  log.info('Setting up voice session event bridge', {
    initialMeetingState,
    callObjectExists: !!callObject,
  });

  const cleanupFunctions: Array<() => void> = [];

  // Helper to register event with cleanup
  const on = (event: string, handler: (e?: DailyEventObject) => void) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callObject.on(event as any, handler);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cleanupFunctions.push(() => callObject.off(event as any, handler));
  };

  // Participant events
  on('participant-joined', (e) => {
    log.info('Participant joined', { participant: e?.participant });
    if (callbacks.onParticipantJoined) {
      callbacks.onParticipantJoined(e?.participant);
    }
  });

  on('participant-left', (e) => {
    log.info('Participant left', { participant: e?.participant });
    if (callbacks.onParticipantLeft) {
      callbacks.onParticipantLeft(e?.participant);
    }
  });

  // Audio level tracking
  on('active-speaker-change', (e) => {
    if (callbacks.onAudioLevel && e?.activeSpeaker?.peerId) {
      // Get audio level for active speaker
      const participants = callObject.participants();
      const speaker = participants[e.activeSpeaker.peerId];
      
      if (speaker?.tracks?.audio?.state === 'playable') {
        // Audio level is typically 0-1, we'll use a simple approximation
        const level = 0.8;
        callbacks.onAudioLevel(level);
        
        // Dispatch custom event for speech context
        window.dispatchEvent(new CustomEvent('daily:audioLevel', {
          detail: { level, participantId: e.activeSpeaker.peerId }
        }));
      }
    }
  });

  // App messages (from pipecat bot via AppMessageForwarder)
  on('app-message', (e) => {
    log.info('App message received', { data: e?.data });
    
    const data = e?.data;
    if (!data) return;

    // Dedup: events arrive via both Daily app-message AND WebSocket
    if (data.kind === 'nia.event' && data.seq != null && data.ts != null && data.event) {
      const { isDuplicateEvent } = require('@interface/lib/event-dedup');
      if (isDuplicateEvent(data.seq, data.ts, data.event)) {
        log.info('Duplicate event suppressed', { event: data.event, seq: data.seq });
        return;
      }
    }

    // Handle different message types
    if (data.kind === 'nia.event') {
      // Inject roomUrl if available
      if (options.getRoomUrl) {
        const roomUrl = options.getRoomUrl();
        if (roomUrl) {
          if (!data.payload) data.payload = {};
          if (typeof data.payload === 'object') {
             (data.payload as any).roomUrl = roomUrl;
          }
        }
      }

      if (!options.allowAssistantSelfClose && isAssistantSelfCloseNiaEvent(data)) {
        log.warn('assistant self-close event suppressed (flag disabled)', {
          event: data.event,
          payload: data.payload,
        });
        options.onAssistantSelfCloseEventBlocked?.(data.event, data.payload);
        return;
      }
      // Route NIA event through event router for custom event dispatch
      routeNiaEvent(data);
      // Also handle via callbacks for backward compatibility
      handleNiaEvent(data, callbacks);
    } else if (data.trackType === 'cam-audio' && data.text) {
      // Handle transcription from user audio track
      log.info('User transcription', { text: data.text });
      if (callbacks.onTranscript) {
        const transcript: TranscriptEvent = {
          text: data.text || '',
          isFinal: data.isFinal ?? false,
          timestamp: Date.now(),
          participantId: data.session_id || data.user_id,
          source: 'user', // User speech recognition
        };
        callbacks.onTranscript(transcript);
      }
    } else if (callbacks.onMessage) {
      // Generic message
      callbacks.onMessage(data);
    }
  });

  // Transcription events (if enabled)
  on('transcription-message', (e) => {
    log.info('Transcription event', { transcription: e?.transcription });
    
    if (callbacks.onTranscript && e?.transcription) {
      const transcript: TranscriptEvent = {
        text: e.transcription.text || '',
        isFinal: e.transcription.is_final || false,
        timestamp: Date.now(),
        participantId: e.transcription.session_id,
        source: 'user', // User speech recognition via Daily transcription service
      };
      callbacks.onTranscript(transcript);
    }
  });

  // Error handling
  // Expected/benign error types that shouldn't trigger error overlays
  const BENIGN_ERROR_TYPES = new Set(['no-room', 'meeting-ended']);
  const BENIGN_ERROR_PATTERNS = [/meeting has ended/i, /room was/i, /ejection/i];

  on('error', (e) => {
    const errorType = (e as any)?.error?.type as string | undefined;
    const errorMsg = e?.errorMsg || '';
    const isBenign =
      BENIGN_ERROR_TYPES.has(errorType ?? '') ||
      BENIGN_ERROR_PATTERNS.some((p) => p.test(errorMsg));

    if (isBenign) {
      log.warn('Daily room ended (benign)', { errorMsg, errorType });
      // Still notify callback so UI can react, but don't escalate to error level
      if (callbacks.onError) {
        const error = new Error(errorMsg || 'Meeting has ended');
        (error as any).benign = true;
        callbacks.onError(error);
      }
      return;
    }

    log.error('Daily error', { errorMsg: e?.errorMsg, event: e });
    
    if (callbacks.onError) {
      const error = new Error(e?.errorMsg || 'Unknown Daily error');
      callbacks.onError(error);
    }
  });

  // Track whether we've actually joined to distinguish spurious initial events
  let hasJoinedMeeting = false;

  // Meeting state changes
  on('joined-meeting', () => {
    hasJoinedMeeting = true;
    const meetingState = callObject.meetingState?.();
    log.info('Joined meeting', { 
      event: 'daily_joined_meeting',
      hasJoinedMeeting,
      meetingState,
    });
  });

  on('left-meeting', () => {
    const meetingState = callObject.meetingState?.();
    // Only log as warning if we never actually joined (spurious initial event)
    if (!hasJoinedMeeting) {
      log.warn('Left meeting event fired (spurious - never joined)', {
        event: 'daily_left_meeting_spurious',
        hasJoinedMeeting,
        meetingState,
      });
    } else {
      log.info('Left meeting', {
        event: 'daily_left_meeting',
        hasJoinedMeeting,
        meetingState,
      });
    }
    hasJoinedMeeting = false;
  });

  on('participant-updated', (e) => {
    // Track audio level changes
    if (e?.participant && !e.participant.local) {
      // Check if bot is speaking based on audio track state
      const audioTrack = e.participant.tracks?.audio;
      if (audioTrack?.state === 'playable' && callbacks.onAudioLevel) {
        // Estimate audio level (Daily doesn't provide direct access)
        callbacks.onAudioLevel(0.7);
      }
    }
  });

  log.info('Event bridge setup complete');

  // Return cleanup function
  return () => {
    log.info('Cleaning up event bridge');
    cleanupFunctions.forEach((cleanup) => cleanup());
  };
}

/**
 * Handle Nia event envelopes from pipecat bot
 */
function handleNiaEvent(
  envelope: unknown,
  callbacks: VoiceEventCallbacks
): void {
  const { event, payload } = envelope as { event: string; payload?: Record<string, unknown> };

  switch (event) {
    case 'bot.speaking.started':
    case 'bot.speech.start':
    case 'daily.bot.speaking.started':
      if (callbacks.onSpeechStart) {
        callbacks.onSpeechStart();
      }
      break;

    case 'bot.speaking.stopped':
    case 'bot.speech.end':
    case 'daily.bot.speaking.stopped':
      if (callbacks.onSpeechEnd) {
        callbacks.onSpeechEnd();
      }
      break;

    case 'bot.transcript':
    case 'daily.transcript':
      if (callbacks.onTranscript && payload?.text) {
        callbacks.onTranscript({
          text: payload.text as string,
          isFinal: (payload.isFinal ?? true) as boolean,
          timestamp: (payload.timestamp as number) || Date.now(),
          participantId: payload.participantId as string | undefined,
          source: 'bot', // Bot TTS transcript output
        });
      }
      break;

    default:
      // Forward unknown events as generic messages
      if (callbacks.onMessage) {
        callbacks.onMessage({ event, payload });
      }
  }
}

/**
 * Monitor audio levels manually
 * Note: This is a placeholder for more sophisticated audio level monitoring
 * Daily's network stats API doesn't directly expose remoteParticipants in the expected format
 */
export function startAudioLevelMonitoring(
  callObject: DailyCall,
  onAudioLevel: (level: number) => void
): () => void {
  let animationFrameId: number | null = null;
  let lastLevel = 0;

  const monitor = async () => {
    try {
      // Use participant audio track state as a simple proxy for audio level
      const participants = callObject.participants();
      
      for (const [id, participant] of Object.entries(participants)) {
        if (id !== 'local' && !participant.local) {
          const audioTrack = participant.tracks?.audio;
          if (audioTrack?.state === 'playable') {
            // Simple binary: if audio is playing, report moderate level
            const level = 0.7;
            if (Math.abs(level - lastLevel) > 0.05) {
              lastLevel = level;
              onAudioLevel(level);
              
              // Dispatch custom event for speech context
              window.dispatchEvent(new CustomEvent('daily:audioLevel', {
                detail: { level, participantId: id }
              }));
            }
          } else if (lastLevel > 0) {
            lastLevel = 0;
            onAudioLevel(0);
            
            // Dispatch silence event
            window.dispatchEvent(new CustomEvent('daily:audioLevel', {
              detail: { level: 0, participantId: id }
            }));
          }
        }
      }
    } catch (error) {
      // Ignore errors, just skip this sample
    }

    animationFrameId = window.requestAnimationFrame(monitor);
  };

  animationFrameId = window.requestAnimationFrame(monitor);

  // Return cleanup function
  return () => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };
}
