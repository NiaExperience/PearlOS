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

  // Audio level tracking — only for bot (non-local) participants
  on('active-speaker-change', (e) => {
    const peerId = e?.activeSpeaker?.peerId;
    const participants = callObject.participants();
    
    // CRITICAL FIX FOR LIPSYNC BUG:
    // When active speaker changes, we need to ALWAYS dispatch bot audio state
    // - If speaker is local user → dispatch bot silence (level: 0)
    // - If speaker is bot → dispatch bot speaking (level: 0.8)
    // - If no active speaker → dispatch bot silence (level: 0)
    // This ensures the avatar correctly reflects ONLY bot speaking state
    
    if (peerId) {
      const speaker = participants[peerId];
      const localSessionId = participants?.local?.session_id;
      
      // Check if this is the local user speaking
      if (peerId === 'local' || peerId === localSessionId || speaker?.local) {
        // User is speaking → dispatch user audio event
        window.dispatchEvent(new CustomEvent('daily:userAudioLevel', {
          detail: { level: 0.8, isSpeaking: true }
        }));
        
        // CRITICAL: Also dispatch bot SILENCE event so avatar goes idle
        window.dispatchEvent(new CustomEvent('daily:audioLevel', {
          detail: { level: 0, participantId: 'bot', isSpeaking: false }
        }));
        
        if (callbacks.onAudioLevel) {
          callbacks.onAudioLevel(0);
        }
        return;
      }
      
      // Non-local participant is speaking (bot)
      if (speaker?.tracks?.audio?.state === 'playable') {
        const level = 0.8;
        
        if (callbacks.onAudioLevel) {
          callbacks.onAudioLevel(level);
        }
        
        // Dispatch bot speaking event
        window.dispatchEvent(new CustomEvent('daily:audioLevel', {
          detail: { level, participantId: peerId, isSpeaking: true }
        }));
      } else {
        // Bot participant exists but audio not playable → silence
        window.dispatchEvent(new CustomEvent('daily:audioLevel', {
          detail: { level: 0, participantId: peerId, isSpeaking: false }
        }));
        
        if (callbacks.onAudioLevel) {
          callbacks.onAudioLevel(0);
        }
      }
    } else {
      // No active speaker → dispatch bot silence
      window.dispatchEvent(new CustomEvent('daily:audioLevel', {
        detail: { level: 0, participantId: 'bot', isSpeaking: false }
      }));
      
      if (callbacks.onAudioLevel) {
        callbacks.onAudioLevel(0);
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
    // Track participant changes (e.g., track state transitions)
    // NOTE: We intentionally do NOT emit fake audio levels here.
    // The 'playable' state only means the track exists, not that audio is
    // actually playing. NIA bot speaking events are the authoritative source
    // for speaking state. Emitting constant 0.7 here was causing the avatar
    // to lip-sync incorrectly (staying stuck in talking state).
    if (e?.participant && !e.participant.local) {
      const audioTrack = e.participant.tracks?.audio;
      if (audioTrack?.state === 'playable') {
        log.debug('Bot audio track is playable', { participant: e.participant.session_id });
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
 * 
 * DEPRECATED: This function previously polled track state on every animation frame
 * and reported a constant 0.7 level whenever a track was in 'playable' state.
 * This was incorrect — 'playable' means the track exists, not that audio is flowing.
 * The constant fake levels caused the avatar to lip-sync to nothing and stay stuck.
 * 
 * NIA bot speaking events (bot.speaking.started / bot.speaking.stopped) are now the
 * authoritative source for speaking state. This function is retained for API
 * compatibility but is a no-op.
 */
export function startAudioLevelMonitoring(
  _callObject: DailyCall,
  _onAudioLevel: (level: number) => void
): () => void {
  log.info('Audio level monitoring is disabled — NIA bot speaking events are authoritative');
  // No-op: return empty cleanup
  return () => {};
}
