'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { DailyCall } from '@daily-co/daily-js';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { NIA_EVENT_SESSION_END } from '@interface/features/DailyCall/events/niaEventRouter';
import {
  coerceFeatureKeyList,
} from '@interface/lib/assistant-feature-sync';
import { getClientLogger } from '@interface/lib/client-logger';
import {
  setupVoiceSessionEventBridge,
  leaveVoiceRoom,
  muteAudio,
  unmuteAudio,
  VoiceEventCallbacks,
  TranscriptEvent,
} from '@interface/lib/daily';
import {
  PEARL_ONBOARDING_FIRST_REPLY_EVENT,
  readOnboardingStatus,
  type WebchatOnboardingFirstReplyDetail,
} from '@interface/lib/webchat-onboarding';
import {
  defaultVoiceIdForBotProvider,
  normalizeVoiceProvider,
  readLocalPreference,
  toBotVoiceProvider,
  VOICE_PROVIDER_KEY,
} from '@interface/lib/pearlos-user-preferences';
import { normalizeVoiceParameters, type VoiceParametersInput } from '@interface/lib/voice/kokoro';
import {
  Message,
  MessageTypeEnum,
  MessageRoleEnum,
  TranscriptMessage,
  TranscriptMessageTypeEnum,
} from '@interface/types/conversation.types';

const LOADING_TIMEOUT_MS = 20_000; // Grace window for bot to join before surfacing unavailable

// Module-level cleanup debounce to prevent session teardown during React remounts
// (HMR, Suspense, StrictMode, Fast Refresh)
// This timeout ID is cleared if the component remounts within the grace period
let pendingUnmountCleanupTimer: ReturnType<typeof setTimeout> | null = null;
let cleanupMountId: string | null = null;
const UNMOUNT_CLEANUP_DELAY_MS = 3000; // Allow slow remounts before tearing down an in-flight voice session

// Short-window voice-room reuse: when the user returns to the page within
// ~60s the deterministic /api/voice/room call is redundant — the bot
// gateway also reuses sessions per-room for 2 minutes. Caching the room
// response per-user lets a quick reload skip the round-trip and avoids
// bouncing the runner.
const VOICE_ROOM_REUSE_TTL_MS = 60_000;
const VOICE_ROOM_CACHE_KEY = 'pearl:voiceRoomCache';
const DEFAULT_PUBLIC_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const AUTO_RECORDING_ENABLED =
  process.env.NEXT_PUBLIC_VOICE_AUTO_RECORDING === '1' ||
  process.env.NEXT_PUBLIC_VOICE_AUTO_RECORDING === 'true';

type VoiceRoomResponse = {
  roomUrl: string;
  roomName?: string;
  tenantId?: string;
  token?: string;
  reused?: boolean;
  [key: string]: unknown;
};

type VoiceRoomCacheEntry = {
  userId: string;
  tenantId: string;
  roomUrl: string;
  roomName?: string;
  token?: string;
  reused?: boolean;
  cachedAt: number;
};

const isTenantCacheable = (tenantId: string | null | undefined): tenantId is string =>
  Boolean(tenantId && tenantId !== DEFAULT_PUBLIC_TENANT_ID);

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isRemoteParticipant(participant: unknown): boolean {
  return Boolean(
    participant &&
      typeof participant === 'object' &&
      (participant as { local?: boolean }).local !== true,
  );
}

function getRemoteParticipantIds(callObject: DailyCall): string[] {
  const participants = callObject.participants?.() || {};
  return Object.entries(participants)
    .filter(([, participant]) => isRemoteParticipant(participant))
    .map(([id]) => id);
}

function waitForRemoteParticipant(callObject: DailyCall, timeoutMs: number): Promise<string[]> {
  const existing = getRemoteParticipantIds(callObject);
  if (existing.length > 0) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      callObject.off?.('participant-joined' as any, handleParticipantJoined);
      clearTimeout(timer);
    };
    const finish = (participantIds: string[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(participantIds);
    };
    const handleParticipantJoined = () => {
      const participantIds = getRemoteParticipantIds(callObject);
      if (participantIds.length > 0) {
        finish(participantIds);
      }
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Timed out waiting ${timeoutMs}ms for bot participant to join`));
    }, timeoutMs);

    callObject.on?.('participant-joined' as any, handleParticipantJoined);
  });
}

const getWebRTCSupportFailure = (): string | null => {
  if (typeof window === 'undefined') return 'browser_unavailable';
  const browser = window as typeof window & {
    RTCPeerConnection?: typeof RTCPeerConnection;
    webkitRTCPeerConnection?: typeof RTCPeerConnection;
    mozRTCPeerConnection?: typeof RTCPeerConnection;
  };
  if (!browser.isSecureContext) return 'insecure_context';
  if (!navigator.mediaDevices?.getUserMedia) return 'media_devices_unavailable';
  if (!browser.RTCPeerConnection && !browser.webkitRTCPeerConnection && !browser.mozRTCPeerConnection) {
    return 'rtc_peer_connection_unavailable';
  }
  return null;
};

const MICROPHONE_BUSY_MESSAGE =
  'Pearl cannot use your microphone. Another Pearl tab, browser tab, or app may already be using it. Close the other voice session, then try again.';
const MICROPHONE_PERMISSION_MESSAGE =
  'Pearl cannot use your microphone. Allow microphone access for PearlOS in your browser, then try again.';
const VOICE_UNAVAILABLE_MESSAGE =
  'Pearl voice is unavailable right now. Check your microphone and try again.';

function classifyVoiceUnavailableMessage(errorOrReason: unknown): string {
  const name = typeof errorOrReason === 'object' && errorOrReason
    ? String((errorOrReason as { name?: unknown }).name || '')
    : '';
  const message = errorOrReason instanceof Error
    ? errorOrReason.message
    : typeof errorOrReason === 'string'
      ? errorOrReason
      : String(errorOrReason || '');
  const combined = `${name} ${message}`.toLowerCase();
  if (
    combined.includes('notallowederror') ||
    combined.includes('permission') ||
    combined.includes('denied')
  ) {
    return MICROPHONE_PERMISSION_MESSAGE;
  }
  if (
    combined.includes('notreadableerror') ||
    combined.includes('aborterror') ||
    combined.includes('trackstarterror') ||
    combined.includes('could not start audio source') ||
    combined.includes('device in use') ||
    combined.includes('already in use')
  ) {
    return MICROPHONE_BUSY_MESSAGE;
  }
  return VOICE_UNAVAILABLE_MESSAGE;
}

const getRoomNameFromVoiceUrl = (roomUrl: string): string => {
  try {
    const url = new URL(roomUrl);
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
  } catch {
    return '';
  }
};

const isDeterministicVoiceRoomName = (roomName: string | undefined): boolean => {
  return /^voice-[0-9a-f]{16}-[0-9a-f]{16}$/i.test(roomName || '');
};

const isStaleSharedVoiceRoom = (roomName: string, roomUrl: string): boolean => {
  const haystack = `${roomName} ${roomUrl}`.toLowerCase();
  return (
    haystack.includes('staging-pearl-voice') ||
    haystack.includes('voice-anonymous') ||
    roomName.toLowerCase().startsWith('stg-')
  );
};

const isValidVoiceRoomCacheEntry = (entry: VoiceRoomCacheEntry): boolean => {
  const roomName = entry.roomName || getRoomNameFromVoiceUrl(entry.roomUrl);
  if (!roomName || isStaleSharedVoiceRoom(roomName, entry.roomUrl)) return false;
  return isDeterministicVoiceRoomName(roomName);
};

const readVoiceRoomCache = (userId: string, tenantId: string | null | undefined): VoiceRoomCacheEntry | null => {
  if (typeof window === 'undefined') return null;
  if (!isTenantCacheable(tenantId)) return null;
  try {
    const raw = window.localStorage.getItem(VOICE_ROOM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VoiceRoomCacheEntry;
    if (!parsed || parsed.userId !== userId || !parsed.roomUrl) return null;
    if (parsed.tenantId !== tenantId) return null;
    if (Date.now() - parsed.cachedAt > VOICE_ROOM_REUSE_TTL_MS) return null;
    if (!isValidVoiceRoomCacheEntry(parsed)) {
      window.localStorage.removeItem(VOICE_ROOM_CACHE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeVoiceRoomCache = (entry: VoiceRoomCacheEntry): void => {
  if (typeof window === 'undefined') return;
  if (!isValidVoiceRoomCacheEntry(entry)) return;
  try {
    window.localStorage.setItem(VOICE_ROOM_CACHE_KEY, JSON.stringify(entry));
  } catch {
    /* storage disabled or full — non-fatal */
  }
};

const clearVoiceRoomCache = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(VOICE_ROOM_CACHE_KEY);
  } catch {
    /* non-fatal */
  }
};

const voiceLogger = getClientLogger('[daily_call]');

export enum CALL_STATUS {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
  LOADING = 'loading',
  UNAVAILABLE = 'unavailable',
}

interface UseVoiceSessionProps {
  assistantName: string;
  clientLanguage?: string; // Optional for compatibility
  userId?: string; // Defaults to authenticated session user when available
  userName?: string; // User's display name for Daily participant (e.g., "Jeffrey Klug")
  userEmail?: string; // User's email for profile loading
  personalityId?: string; // OS personality ID for voice-only sessions
  tenantId?: string; // Tenant ID for personality resolution
  persona?: string; // Bot display name from Assistant.persona_name (e.g., "Pearl")
  voiceId?: string; // Preferred TTS voice id or local preset
  voiceProvider?: string;
  voiceParameters?: VoiceParametersInput;
  supportedFeatures?: string[]; // Feature flags for tool filtering (e.g., ['notes', 'youtube', 'gmail'])
  modePersonalityVoiceConfig?: Record<string, any>; // Map of mode -> config for hot-switching
  sessionOverride?: Record<string, any>;
  config?: any;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
}

const CHAT_HISTORY_CACHE_PREFIX = 'pearl-chat-history-v1';
const ACTIVE_NOTE_CONTEXT_KEY = 'pearl-active-note-context-v1';

function readRecentWebChatContext(userId?: string): Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number }> {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = window.localStorage.getItem(`${CHAT_HISTORY_CACHE_PREFIX}:${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.messages)) return [];
    return parsed.messages
      .filter((message: any) => (
        (message?.role === 'user' || message?.role === 'assistant') &&
        typeof message?.content === 'string' &&
        message.content.trim().length > 0
      ))
      .slice(-12)
      .map((message: any) => ({
        role: message.role,
        content: message.content.trim().slice(0, 1200),
        timestamp: typeof message.timestamp === 'number' ? message.timestamp : undefined,
      }));
  } catch {
    return [];
  }
}

function readActiveNoteContext(): { noteId: string; title?: string; content?: string; tenantId?: string | null } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_NOTE_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || typeof parsed.noteId !== 'string' || !parsed.noteId) {
      return null;
    }
    return {
      noteId: parsed.noteId,
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      content: typeof parsed.content === 'string' ? parsed.content.slice(0, 5000) : undefined,
      tenantId: typeof parsed.tenantId === 'string' ? parsed.tenantId : null,
    };
  } catch {
    return null;
  }
}

/**
 * Voice session hook powered by Daily.co and pipecat
 */
export function useVoiceSession({
  assistantName,
  clientLanguage,
  userId,
  userName,
  userEmail,
  personalityId,
  tenantId,
  persona,
  voiceId,
  voiceProvider,
  voiceParameters,
  supportedFeatures,
  modePersonalityVoiceConfig,
  sessionOverride,
  config,
  onSessionStart,
  onSessionEnd,
}: UseVoiceSessionProps) {
  // Get context functions and sync callStatus to context
  const { 
    getCallObject, 
    setCallStatus: setContextCallStatus, 
    setToggleCall: setContextToggleCall, 
    setRoomUrl: setContextRoomUrl,
    setMessages: setContextMessages,
    setActiveTranscript: setContextActiveTranscript,
    getPendingSpriteConfig,
    clearPendingSpriteConfig,
    setActiveSpriteId,
    setActiveSpriteVoice,
    setSpriteVoiceWasPaused,
    setSpriteStartedSession,
    setCurrentPersonaName,
    setModePersonalityVoiceConfig,
  } = useVoiceSessionContext();

  // Get user profile context for dismissing welcome overlay on first session
  const userProfile = useUserProfileOptional();

  // Prefer authenticated session data when explicit props are not provided
  const { data: session } = useSession();
  const resolvedUserId = userId ?? session?.user?.id ?? 'anonymous';
  const resolvedUserName = userName ?? session?.user?.name ?? undefined;
  const resolvedUserEmail = userEmail ?? session?.user?.email ?? undefined;
  const resolvedSessionId = (session as any)?.sessionId ?? (session?.user as any)?.sessionId ?? undefined;
  const onboardingUserKey = resolvedUserId !== 'anonymous' ? resolvedUserId : resolvedUserEmail;
  
  // State
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [callStatus, setCallStatus] = useState<CALL_STATUS>(CALL_STATUS.INACTIVE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTranscript, setActiveTranscript] = useState<TranscriptMessage | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [unavailableMessage, setUnavailableMessage] = useState<string | null>(null);

  // Event cleanup and room URL references
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const roomUrlRef = useRef<string | null>(null);
  const voiceTenantIdRef = useRef<string | null>(null);
  const callStatusRef = useRef<CALL_STATUS>(callStatus);
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const startInFlightRef = useRef(false);
  const sessionGenerationRef = useRef(0);
  const startupStartedAtRef = useRef<number | null>(null);
  const firstBotTranscriptLoggedRef = useRef(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const allowAssistantSelfClose = useMemo(
    () => supportedFeatures && supportedFeatures.includes('assistantSelfClose'),
    [supportedFeatures]
  );
  const recordingAttemptRef = useRef(false);
  
  // Track last applied personality config to prevent infinite update loops
  const lastAppliedConfigRef = useRef<string | null>(null);
  
  // Keep callStatusRef in sync with callStatus
  useEffect(() => {
    callStatusRef.current = callStatus;
    setContextCallStatus(callStatus);
  }, [callStatus, setContextCallStatus]);

  // Sync messages and activeTranscript to context for Sprite access
  useEffect(() => {
    setContextMessages(messages);
  }, [messages, setContextMessages]);

  useEffect(() => {
    setContextActiveTranscript(activeTranscript);
  }, [activeTranscript, setContextActiveTranscript]);
  
  // Sync modePersonalityVoiceConfig to context for disableSpriteVoice to use
  // This is the primary path for setting the config since useVoiceSession receives it from props
  useEffect(() => {
    if (modePersonalityVoiceConfig) {
      setModePersonalityVoiceConfig(modePersonalityVoiceConfig);
    }
  }, [modePersonalityVoiceConfig, setModePersonalityVoiceConfig]);

  /**
   * Setup event handlers for Daily call
   */
  const setupEventHandlers = useCallback((callObject: DailyCall) => {
    voiceLogger.info('setupEventHandlers called', {
      event: 'voice_setup_handlers_start',
      meetingState: callObject.meetingState?.(),
      hasExistingCleanup: !!eventCleanupRef.current,
    });

    const callbacks: VoiceEventCallbacks = {
      onSpeechStart: () => {
        voiceLogger.info('Speech started', { event: 'voice_speech_start' });
        setIsSpeechActive(true);
      },

      onSpeechEnd: () => {
        voiceLogger.info('Speech ended', { event: 'voice_speech_end' });
        setIsSpeechActive(false);
      },

      onTranscript: (event: TranscriptEvent) => {
        // Determine role based on transcript source
        // 'bot' source = bot TTS output = ASSISTANT
        // 'user' source = user speech recognition = USER
        const role = event.source === 'bot' ? MessageRoleEnum.ASSISTANT : MessageRoleEnum.USER;
        if (event.source === 'bot' && !firstBotTranscriptLoggedRef.current && event.text?.trim()) {
          firstBotTranscriptLoggedRef.current = true;
          const startedAt = startupStartedAtRef.current;
          voiceLogger.info('First bot transcript received', {
            event: 'voice_first_bot_transcript',
            elapsedMs: startedAt != null ? Math.round(nowMs() - startedAt) : undefined,
            isFinal: event.isFinal,
            length: event.text.length,
          });
        }
        
        voiceLogger.debug('Transcript event', {
          event: 'voice_transcript',
          isFinal: event.isFinal,
          length: event.text?.length ?? 0,
          source: event.source,
          role,
        });

        const transcriptMessage: TranscriptMessage = {
          type: MessageTypeEnum.TRANSCRIPT,
          transcriptType: event.isFinal
            ? TranscriptMessageTypeEnum.FINAL
            : TranscriptMessageTypeEnum.PARTIAL,
          transcript: event.text,
          role,
        };

        if (event.isFinal) {
          setMessages((prev) => [...prev, transcriptMessage]);
          setActiveTranscript(null);
          if (
            event.source === 'user' &&
            event.text?.trim() &&
            onboardingUserKey &&
            !userProfile?.loading &&
            !userProfile?.onboardingComplete &&
            readOnboardingStatus(onboardingUserKey) === 'idle'
          ) {
            window.dispatchEvent(
              new CustomEvent<WebchatOnboardingFirstReplyDetail>(PEARL_ONBOARDING_FIRST_REPLY_EVENT, {
                detail: { source: 'voice' },
              }),
            );
          }
        } else {
          setActiveTranscript(transcriptMessage);
        }
      },

      onMessage: (message: unknown) => {
        const isObject = message && typeof message === 'object';
        const hasText = isObject && typeof (message as Record<string, unknown>).text === 'string';
        voiceLogger.debug('Message received', {
          event: 'voice_message',
          hasText,
        });

        // Convert to Message format if needed
        if (message && typeof message === 'object') {
          const msg = message as Record<string, unknown>;
          
          // Handle bot messages as MODEL_OUTPUT
          if (msg.text && typeof msg.text === 'string') {
            const botMessage: Message = {
              type: MessageTypeEnum.MODEL_OUTPUT,
              output: msg.text,
            };
            setMessages((prev) => [...prev, botMessage]);
          }
        }
      },

      onAudioLevel: (level: number) => {
        setAudioLevel(level);
      },

      onError: (error: Error) => {
        const isBenign = (error as any).benign === true;
        if (isBenign) {
          voiceLogger.warn('Voice session ended (benign)', {
            event: 'voice_ended_benign',
            error: error?.message ?? String(error),
          });
        } else {
          voiceLogger.error('Voice session error', {
            event: 'voice_error',
            error: error?.message ?? String(error),
          });
        }
        setUnavailableMessage(classifyVoiceUnavailableMessage(error));
        setCallStatus(CALL_STATUS.UNAVAILABLE);
      },

      onParticipantJoined: (participant: unknown) => {
        const sessionId = typeof participant === 'object' && participant
          ? (participant as { session_id?: string }).session_id
          : undefined;
        voiceLogger.info('Participant joined', {
          event: 'voice_participant_join',
          sessionId,
        });
      },

      onParticipantLeft: (participant: unknown) => {
        const sessionId = typeof participant === 'object' && participant
          ? (participant as { session_id?: string }).session_id
          : undefined;
        voiceLogger.info('Participant left', {
          event: 'voice_participant_left',
          sessionId,
        });
        
        // If local participant left (kicked due to inactivity), auto-close voice session
        if (participant && typeof participant === 'object') {
          const p = participant as { local?: boolean; session_id?: string };
          const currentRoomUrl = roomUrlRef.current || '';
          
          // Check if it's the local participant being kicked from a voice-only session
          if (p.local && currentRoomUrl.includes('/voice-')) {
            voiceLogger.warn('Local participant kicked from voice session, auto-closing', {
              event: 'voice_local_kicked',
              roomUrl: currentRoomUrl,
            });
            
            // Auto-close the voice session using the ref
            setTimeout(() => {
              if (callStatusRef.current === CALL_STATUS.ACTIVE && stopRef.current) {
                stopRef.current();
              }
            }, 100); // Small delay to ensure event processing completes
          }
        }
      },
    };

    // Setup event bridge
    voiceLogger.info('Setting up event bridge', {
      event: 'voice_event_bridge_setup_start',
      meetingStateBefore: callObject.meetingState?.(),
    });
    const cleanup = setupVoiceSessionEventBridge(callObject, callbacks, {
      allowAssistantSelfClose,
      onAssistantSelfCloseEventBlocked: (eventName, payload) => {
        voiceLogger.warn('Assistant self-close event suppressed (flag disabled)', {
          event: 'voice_self_close_blocked',
          eventName,
          payloadType: typeof payload,
        });
      },
      getRoomUrl: () => roomUrlRef.current,
    });
    eventCleanupRef.current = cleanup;
    voiceLogger.info('Event bridge setup complete', {
      event: 'voice_event_bridge_setup_complete',
      meetingStateAfter: callObject.meetingState?.(),
    });

    return cleanup;
  }, [allowAssistantSelfClose, onboardingUserKey, userProfile?.loading, userProfile?.onboardingComplete]);

  const clearLoadingTimeout = useCallback(() => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }, []);

  const armLoadingTimeout = useCallback(() => {
    clearLoadingTimeout();
    loadingTimeoutRef.current = setTimeout(() => {
      if (callStatusRef.current === CALL_STATUS.LOADING) {
        let meetingState: ReturnType<DailyCall['meetingState']> | 'unknown' = 'unknown';
        try {
          meetingState = getCallObject?.()?.meetingState?.() ?? 'unknown';
        } catch (error) {
          voiceLogger.warn('Unable to read meeting state during bot join timeout', {
            event: 'voice_bot_join_timeout_meeting_state_unavailable',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        voiceLogger.warn('Bot join timed out after 20s; user action required to retry', {
          event: 'voice_bot_join_timeout',
          timeoutMs: LOADING_TIMEOUT_MS,
          meetingState,
        });
        setUnavailableMessage(VOICE_UNAVAILABLE_MESSAGE);
        setCallStatus(CALL_STATUS.UNAVAILABLE);
        startInFlightRef.current = false;
      }
    }, LOADING_TIMEOUT_MS);
  }, [clearLoadingTimeout, getCallObject]);

  /**
   * Ensure cloud recording is active for the current session
   */
  const getRecordingState = useCallback((meetingState: ReturnType<DailyCall['meetingState']> | undefined) => {
    if (meetingState && typeof meetingState === 'object' && 'recording' in meetingState) {
      const recording = (meetingState as { recording?: { state?: string } }).recording;
      return recording?.state;
    }
    return undefined;
  }, []);

  const ensureRecordingActive = useCallback(async (callObject: DailyCall) => {
    if (!AUTO_RECORDING_ENABLED) {
      return;
    }

    if (!callObject?.startRecording) {
      return;
    }

    if (recordingAttemptRef.current) {
      return;
    }

    recordingAttemptRef.current = true;
    try {
      const meetingState = typeof callObject.meetingState === 'function' ? callObject.meetingState() : undefined;
      const recordingState = getRecordingState(meetingState);
      if (recordingState === 'recording' || recordingState === 'starting') {
        return;
      }

      await callObject.startRecording();
      voiceLogger.info('Auto-started cloud recording', {
        event: 'voice_recording_started',
      });
    } catch (error: any) {
      recordingAttemptRef.current = false;
      const msg = error?.message || String(error);
      if (msg.includes('Switch to soup failed')) {
        voiceLogger.warn('Recording start suppressed (SFU switch timing)', {
          event: 'voice_recording_suppressed',
          reason: msg,
        });
      } else {
        voiceLogger.error('Failed to auto-start recording', {
          event: 'voice_recording_error',
          error: msg,
        });
      }
    }
  }, [getRecordingState]);

  /**
   * Start voice session
   */
  const start = useCallback(async () => {
    try {
      if (callStatusRef.current === CALL_STATUS.LOADING || startInFlightRef.current) {
        voiceLogger.warn('Start request ignored; already loading', {
          event: 'voice_start_ignored_loading',
          callStatus: callStatusRef.current,
        });
        return;
      }

      startInFlightRef.current = true;
      setUnavailableMessage(null);
      const startGeneration = sessionGenerationRef.current + 1;
      sessionGenerationRef.current = startGeneration;
      startupStartedAtRef.current = nowMs();
      firstBotTranscriptLoggedRef.current = false;
      voiceLogger.info('Starting session for user', {
        event: 'voice_start',
        userId: resolvedUserId,
        configIsOnboarding: config?.isOnboarding,
        personalityId,
      });

      const webRTCSupportFailure = getWebRTCSupportFailure();
      if (webRTCSupportFailure) {
        voiceLogger.error('Voice start blocked before Daily init because WebRTC is unavailable', {
          event: 'voice_webrtc_unavailable',
          reason: webRTCSupportFailure,
        });
        startInFlightRef.current = false;
        setUnavailableMessage(classifyVoiceUnavailableMessage(webRTCSupportFailure));
        setCallStatus(CALL_STATUS.UNAVAILABLE);
        return;
      }

      let callObject: DailyCall;
      try {
        callObject = getCallObject();
      } catch (error) {
        voiceLogger.error('Daily call object unavailable; voice disabled without crashing interface', {
          event: 'voice_call_object_unavailable',
          error: error instanceof Error ? error.message : String(error),
        });
        startInFlightRef.current = false;
        setUnavailableMessage(VOICE_UNAVAILABLE_MESSAGE);
        setCallStatus(CALL_STATUS.UNAVAILABLE);
        return;
      }

      voiceLogger.info('Daily call object prepared in voice start gesture', {
        event: 'voice_call_object_prepared',
        meetingState: callObject.meetingState?.(),
      });

      // Clear prior transcripts so new sessions (including Sprite sessions) don't show stale bubbles
      setMessages([]);
      setActiveTranscript(null);
      setCallStatus(CALL_STATUS.LOADING);
      armLoadingTimeout();

      // Get or create voice room via API endpoint.
      // Quick-revisit fast path: if we have a fresh cached room URL for the
      // same user, skip the round-trip. The /api/voice/room endpoint and
      // the bot gateway both reuse sessions for the deterministic per-user
      // room, so the cache is purely a latency win — but it also avoids
      // any chance of triggering a fresh runner spawn on a same-tab reload.
      let voiceRoom: VoiceRoomResponse;
      const cachedRoom = resolvedUserId ? readVoiceRoomCache(resolvedUserId, tenantId) : null;
      if (cachedRoom) {
        voiceLogger.info('Reusing cached voice room (fast path)', {
          event: 'voice_room_cache_hit',
          ageMs: Date.now() - cachedRoom.cachedAt,
          tenantId: cachedRoom.tenantId,
        });
        voiceRoom = {
          roomUrl: cachedRoom.roomUrl,
          roomName: cachedRoom.roomName,
          tenantId: cachedRoom.tenantId,
          token: cachedRoom.token,
          reused: true,
        };
      } else {
        let response;
        try {
          response = await fetch('/api/voice/room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: resolvedUserId }),
          });
        } catch (err) {
          voiceLogger.warn('Network error creating room, retrying once', {
            event: 'voice_room_create_retry',
            error: err instanceof Error ? err.message : String(err),
          });
          await new Promise(resolve => setTimeout(resolve, 1000));
          response = await fetch('/api/voice/room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: resolvedUserId }),
          });
        }

        if (!response.ok) {
          // If 401, it might be a session issue, but we can't fix it here easily.
          // Just throw with status.
          clearVoiceRoomCache();
          throw new Error(`Failed to create voice room: ${response.status}`);
        }

        voiceRoom = (await response.json()) as VoiceRoomResponse;
        const voiceRoomTenantId = typeof voiceRoom?.tenantId === 'string' ? voiceRoom.tenantId.trim() : '';
        if (resolvedUserId && voiceRoom?.roomUrl && isTenantCacheable(voiceRoomTenantId)) {
          writeVoiceRoomCache({
            userId: resolvedUserId,
            tenantId: voiceRoomTenantId,
            roomUrl: voiceRoom.roomUrl,
            roomName: voiceRoom.roomName,
            token: voiceRoom.token,
            reused: voiceRoom.reused,
            cachedAt: Date.now(),
          });
        }
      }

      roomUrlRef.current = voiceRoom.roomUrl;
      const resolvedVoiceTenantId =
        (typeof voiceRoom?.tenantId === 'string' && voiceRoom.tenantId.trim()) ||
        tenantId ||
        null;
      voiceTenantIdRef.current = resolvedVoiceTenantId;
      setContextRoomUrl(voiceRoom.roomUrl); // Share room URL with context

      voiceLogger.info('Room ready', {
        event: 'voice_room_ready',
        roomName: voiceRoom.roomName,
        reused: voiceRoom.reused,
        tenantId: resolvedVoiceTenantId,
      });

      // Setup event handlers
      setupEventHandlers(callObject);

      // Build userData for the bot to identify the user and mark session as private
      // CRITICAL: Daily.co strips boolean values from userData, must use string "true"
      const userData: Record<string, string> = {
        private: "true", // Mark voice-only sessions as private to skip grace period
      };
      
      if (resolvedUserId) {
        userData.sessionUserId = resolvedUserId;
      }
      if (resolvedUserName) {
        userData.sessionUserName = resolvedUserName;
      }
      if (resolvedUserEmail) {
        userData.sessionUserEmail = resolvedUserEmail;
      }
      if (resolvedVoiceTenantId) {
        userData.tenantId = resolvedVoiceTenantId;
      }

      // Request bot to join with OS personality (not bot personality)
      // Use personalityId if provided, otherwise fall back to assistantName for backward compatibility
      const voicePersonalityId = personalityId || assistantName;
      
      // Check if there's a pending sprite config from enableSpriteVoice
      // If so, use sprite's personality/voice instead of OS defaults
      // This prevents the race condition where mode config overwrites sprite config
      const pendingSpriteConfig = getPendingSpriteConfig();
      const effectivePersonalityId = pendingSpriteConfig?.spriteId || voicePersonalityId;
      const effectiveVoiceId = pendingSpriteConfig?.voiceId || voiceId;
      const effectiveVoiceProvider = pendingSpriteConfig?.voiceProvider || voiceProvider;
      
      if (pendingSpriteConfig) {
        voiceLogger.info('Using pending sprite config for bot join', {
          event: 'voice_sprite_config_applied',
          spriteId: pendingSpriteConfig.spriteId,
          voiceProvider: effectiveVoiceProvider,
          voiceId: effectiveVoiceId,
        });
        // Mark sprite voice as active so downstream mode updates do not overwrite the sprite voice
        setActiveSpriteId(pendingSpriteConfig.spriteId);
        setActiveSpriteVoice(true);
        setSpriteVoiceWasPaused(false);
        // Clear the pending config since we're using it now
        clearPendingSpriteConfig();
      } else {
        // Normal voice session (not sprite) - ensure sprite voice state is cleared
        // This is important for lipsync to work correctly (effectiveSpeaking in GIF avatar)
        voiceLogger.info('Normal voice session start, clearing any stale sprite voice state');
        setActiveSpriteId(null);
        setActiveSpriteVoice(false);
        setSpriteVoiceWasPaused(false);
      }
      
      // Set the persona name for bot participant detection
      // Bot joins with persona.capitalize() as username (e.g., "T", "Pearl")
      // This helps frontend identify the bot participant for audio monitoring
      if (persona) {
        setCurrentPersonaName(persona);
        voiceLogger.info('Set current persona name for bot detection', { persona });
      }
      
      // OPTIMIZATION: Run bot spawn and client join in PARALLEL to reduce total latency
      // This also prevents the bot's initial_idle timeout from firing in an empty room
      // since the client joins concurrently with the bot
      const botJoinArgs = {
        roomUrl: voiceRoom.roomUrl,
        personalityId: effectivePersonalityId,
        voiceId: effectiveVoiceId,
        voiceProvider: effectiveVoiceProvider,
        tenantId: resolvedVoiceTenantId || undefined,
        token: voiceRoom.token,
        persona,
        voiceParameters,
        supportedFeatures,
        userId: resolvedUserId,
        userName: resolvedUserName,
        userEmail: resolvedUserEmail,
        sessionId: resolvedSessionId,
        modePersonalityVoiceConfig,
        sessionOverride,
        config,
        // Pass sprite mode flag if starting with sprite
        ...(pendingSpriteConfig && { mode: 'sprite' }),
      };

      // Bot join with automatic retry (up to 2 retries with 2s backoff)
      const botJoinWithRetry = async () => {
        const BOT_JOIN_MAX_RETRIES = 2;
        for (let attempt = 0; attempt <= BOT_JOIN_MAX_RETRIES; attempt++) {
          if (sessionGenerationRef.current !== startGeneration) {
            voiceLogger.warn('Bot join cancelled by newer voice session generation', {
              event: 'voice_bot_join_generation_cancelled',
              attempt: attempt + 1,
            });
            return null;
          }
          try {
            await requestBotJoin(botJoinArgs);
            return 'ok';
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            voiceLogger.warn('Bot join attempt failed', {
              event: 'voice_bot_join_attempt_failed',
              attempt: attempt + 1,
              maxAttempts: BOT_JOIN_MAX_RETRIES + 1,
              error: errMsg,
            });
            if (attempt < BOT_JOIN_MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        }
        voiceLogger.error('Bot join failed after all retries', {
          event: 'voice_bot_join_failed_final',
        });
        return null;
      };

      // Join room with token and userData
      // User joins with their display name (e.g., "Jeffrey Klug"), bot joins separately with persona
      voiceLogger.info('Client joining Daily room', {
        event: 'voice_client_join_start',
        roomUrl: voiceRoom.roomUrl,
        hasToken: !!voiceRoom.token,
        userName: resolvedUserName || resolvedUserId,
        meetingStateBefore: callObject.meetingState?.(),
      });

      const clientJoinPromise = callObject.join({
        url: voiceRoom.roomUrl,
        token: voiceRoom.token,
        userName: resolvedUserName || resolvedUserId, // Prefer display name, fallback to userId
        userData: Object.keys(userData).length > 0 ? userData : undefined,
      }).then((result) => {
        voiceLogger.info('Client join resolved', {
          event: 'voice_client_join_resolved',
          meetingStateAfter: callObject.meetingState?.(),
          participants: Object.keys(callObject.participants() || {}),
        });
        return result;
      }).catch((err) => {
        voiceLogger.error('Client join failed', {
          event: 'voice_client_join_failed',
          error: err instanceof Error ? err.message : String(err),
          meetingStateOnError: callObject.meetingState?.(),
        });
        throw err;
      });

      // Join the browser first, then start the bot. The bot's fast greeting can
      // otherwise beat Daily's remote-audio subscription path on fresh/mobile
      // sessions, making the first spoken turn effectively silent.
      voiceLogger.info('Waiting for client Daily join before bot spawn', {
        event: 'voice_client_join_await_start',
      });
      await clientJoinPromise;

      try {
        await callObject.setLocalAudio(true);
        voiceLogger.info('Local audio track enabled before bot join', {
          event: 'voice_local_audio_enabled_before_bot_join',
          localAudio: callObject.localAudio?.(),
        });
      } catch (audioErr) {
        voiceLogger.warn('setLocalAudio(true) failed before bot join', {
          event: 'voice_local_audio_enable_before_bot_join_failed',
          error: audioErr instanceof Error ? audioErr.message : String(audioErr),
        });
        try {
          await callObject.leave();
        } catch {
          /* best effort */
        }
        try {
          await leaveVoiceRoom(voiceRoom.roomUrl);
        } catch {
          /* best effort */
        }
        if (eventCleanupRef.current) {
          eventCleanupRef.current();
          eventCleanupRef.current = null;
        }
        clearVoiceRoomCache();
        roomUrlRef.current = null;
        voiceTenantIdRef.current = null;
        setContextRoomUrl(null);
        throw audioErr;
      }

      voiceLogger.info('Starting bot after client Daily join', {
        event: 'voice_bot_join_after_client_join_start',
        meetingState: callObject.meetingState?.(),
        participants: Object.keys(callObject.participants() || {}),
      });
      const botJoinResult = await botJoinWithRetry();
      if (botJoinResult !== 'ok') {
        throw new Error('Bot join did not reach running state');
      }

      voiceLogger.info('Waiting for bot participant readiness', {
        event: 'voice_bot_readiness_wait_start',
        participants: Object.keys(callObject.participants() || {}),
      });
      const remoteParticipantIds = await waitForRemoteParticipant(callObject, 15_000);
      voiceLogger.info('Bot participant readiness confirmed', {
        event: 'voice_bot_readiness_confirmed',
        remoteParticipantIds,
      });

      for (const participantId of remoteParticipantIds) {
        try {
          callObject.updateParticipant?.(participantId, { setAudio: true } as any);
          voiceLogger.info('Remote bot audio subscription forced on', {
            event: 'voice_remote_audio_subscription_enabled',
            participantId,
          });
        } catch (audioErr) {
          voiceLogger.warn('Failed to force remote bot audio subscription on', {
            event: 'voice_remote_audio_subscription_enable_failed',
            participantId,
            error: audioErr instanceof Error ? audioErr.message : String(audioErr),
          });
        }
      }

      // Explicitly publish the local mic track. Without this, Daily may join
      // the room without an active audio send-track, which starves the bot's
      // STT of input frames and manifests as "voice not capturing".
      try {
        await callObject.setLocalAudio(true);
        voiceLogger.info('Local audio track enabled post-join', {
          event: 'voice_local_audio_enabled',
          localAudio: callObject.localAudio?.(),
        });
      } catch (audioErr) {
        voiceLogger.warn('setLocalAudio(true) failed post-join', {
          event: 'voice_local_audio_enable_failed',
          error: audioErr instanceof Error ? audioErr.message : String(audioErr),
        });
      }

      voiceLogger.info('Joined room successfully', {
        event: 'voice_join_success',
        meetingState: callObject.meetingState?.(),
        participants: Object.keys(callObject.participants() || {}),
      });
      void ensureRecordingActive(callObject);
      if (sessionGenerationRef.current !== startGeneration) {
        voiceLogger.warn('Voice start completed after session was stopped or superseded; leaving room', {
          event: 'voice_start_generation_stale',
          roomUrl: voiceRoom.roomUrl,
        });
        try {
          await callObject.leave();
        } catch {
          /* best effort */
        }
        startInFlightRef.current = false;
        return;
      }
      clearLoadingTimeout();
      setCallStatus(CALL_STATUS.ACTIVE);
      setUnavailableMessage(null);
      startInFlightRef.current = false;

      // Dismiss the welcome overlay on first voice session start
      // This is the intended trigger for overlayDismissed (not onboarding completion)
      if (userProfile?.dismissOverlay && !userProfile?.overlayDismissed) {
        voiceLogger.info('Dismissing welcome overlay on first voice session');
        userProfile.dismissOverlay();
      }


      // Callback
      if (onSessionStart) {
        onSessionStart();
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      voiceLogger.error('Failed to start session', {
        event: 'voice_start_failed',
        error: errorMsg,
      });

      voiceLogger.warn('Voice session start failed; user action required to retry', {
        event: 'voice_start_retry_suppressed',
        error: errorMsg,
      });
      clearLoadingTimeout();
      startInFlightRef.current = false;
      setUnavailableMessage(classifyVoiceUnavailableMessage(error));
      setCallStatus(CALL_STATUS.UNAVAILABLE);
    }
  }, [
    resolvedUserId,
    resolvedUserName,
    resolvedUserEmail,
    resolvedSessionId,
    assistantName,
    personalityId,
    tenantId,
    persona,
    voiceId,
    voiceProvider,
    voiceParameters,
    supportedFeatures,
    modePersonalityVoiceConfig,
    sessionOverride,
    config,
    setupEventHandlers,
    onSessionStart,
    getCallObject,
    setContextRoomUrl,
    ensureRecordingActive,
    clearLoadingTimeout,
    armLoadingTimeout,
    getPendingSpriteConfig,
    clearPendingSpriteConfig,
    userProfile,
  ]);

  // Keep startRef in sync with start function
  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    voiceLogger.info('useVoiceSession mounted');
    return () => {
      voiceLogger.info('useVoiceSession unmounted');
    };
  }, []);

  /**
   * Stop voice session
   */
  const stop = useCallback(async () => {
    try {
      sessionGenerationRef.current += 1;
      startInFlightRef.current = false;
      clearLoadingTimeout();
      voiceLogger.info('Stopping session', { event: 'voice_stop' });

      // Leave room if we're in one
      const roomUrlToLeave = roomUrlRef.current;
      if (roomUrlToLeave) {
        try {
          const callObject = getCallObject();
          await callObject.leave();
        } catch (error) {
          voiceLogger.error('Error leaving room', {
            event: 'voice_leave_error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        // Notify room manager to start teardown timer
        await leaveVoiceRoom(roomUrlToLeave);
        
        // Clear pending config in gateway Redis to prevent stale sprite/voice config
        // from affecting the next session (non-critical, fire-and-forget)
        requestBotLeave({
          roomUrl: roomUrlToLeave,
          tenantId: voiceTenantIdRef.current || tenantId,
          sessionId: resolvedSessionId,
          sessionUserId: resolvedUserId,
          sessionUserName: resolvedUserName,
          sessionUserEmail: resolvedUserEmail,
        }).catch((err) => {
          voiceLogger.warn('Failed to notify bot gateway of leave', {
            event: 'voice_leave_gateway_error',
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Cleanup event handlers
      if (eventCleanupRef.current) {
        eventCleanupRef.current();
        eventCleanupRef.current = null;
      }

      // Don't destroy call object - it's managed by context
      clearVoiceRoomCache();
      setUnavailableMessage(null);
      setCallStatus(CALL_STATUS.INACTIVE);
      setIsSpeechActive(false);
      roomUrlRef.current = null;
      voiceTenantIdRef.current = null;
      setContextRoomUrl(null); // Clear room URL from context
      recordingAttemptRef.current = false;
      
      // Clear sprite state to prevent stale sprite voice from persisting to next session
      // This is defense-in-depth - disableSpriteVoice also clears these, but we want to
      // ensure they're cleared even if stop() is called directly without disableSpriteVoice
      setActiveSpriteId(null);
      setActiveSpriteVoice(false);
      setSpriteVoiceWasPaused(false);
      setSpriteStartedSession(false);
      clearPendingSpriteConfig();

      // Callback
      if (onSessionEnd) {
        onSessionEnd();
      }

      voiceLogger.info('Session stopped', { event: 'voice_stopped' });
    } catch (error) {
      voiceLogger.error('Error stopping session', {
        event: 'voice_stop_error',
        error: error instanceof Error ? error.message : String(error),
      });
      // Still set to inactive even if error
      setUnavailableMessage(null);
      setCallStatus(CALL_STATUS.INACTIVE);
    }
  }, [onSessionEnd, getCallObject, setContextRoomUrl, setActiveSpriteId, setActiveSpriteVoice, setSpriteVoiceWasPaused, setSpriteStartedSession, clearPendingSpriteConfig]);

  // Keep stopRef in sync with stop function
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  /**
   * Ensure bot leave is triggered on full page unload (reload, tab close, browser close).
   *
   * Rationale:
   * - React unmount effects are not guaranteed to complete network requests during unload.
   * - If the bot is not explicitly told to leave, subsequent join attempts can fail due to
   *   stale session state on the bot gateway.
   *
   * Strategy:
   * - Listen for `beforeunload` and:
   *   - Fire a best-effort `navigator.sendBeacon` to `/api/bot/leave` with the current room URL.
   *   - Invoke the `stop` handler via ref to run local cleanup (Daily leave + room manager).
   *
   * Notes:
   * - Uses refs (`roomUrlRef`, `stopRef`, `callStatusRef`) to avoid re-subscribing the handler.
   * - Does not block navigation or show confirmation dialogs.
   */
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handleBeforeUnload = () => {
      const currentStatus = callStatusRef.current;
      const roomUrl = roomUrlRef.current;

      // REMOVED: sendBeacon to /api/bot/leave
      // This was killing the bot on every page reload, causing 90% of reconnection failures.
      // The bot's own idle shutdown timer handles cleanup naturally when no participants remain.

      // Soft disconnect: leave Daily call locally so the transport disconnects cleanly,
      // but do NOT tell the bot gateway to shut down the bot process.
      if (
        roomUrl &&
        (currentStatus === CALL_STATUS.ACTIVE || currentStatus === CALL_STATUS.LOADING)
      ) {
        try {
          const callObject = getCallObject();
          // Direct Daily leave — no gateway notification
          callObject.leave();
        } catch {
          // Ignore errors during unload
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Toggle voice session on/off
   */
  const toggleCall = useCallback(async () => {
    try {
      voiceLogger.info('toggleCall invoked', {
        event: 'voice_toggle',
        status: callStatusRef.current,
      });
      if (callStatusRef.current === CALL_STATUS.ACTIVE || callStatusRef.current === CALL_STATUS.LOADING) {
        if (stopRef.current) {
          await stopRef.current();
        }
      } else if (callStatusRef.current === CALL_STATUS.INACTIVE || callStatusRef.current === CALL_STATUS.UNAVAILABLE) {
        if (startRef.current) {
          await startRef.current();
        }
      } else {
        voiceLogger.warn('toggleCall ignored due to status', {
          event: 'voice_toggle_ignored',
          status: callStatusRef.current,
        });
      }
    } catch (error) {
      voiceLogger.error('toggleCall failed without crashing interface', {
        event: 'voice_toggle_failed',
        status: callStatusRef.current,
        error: error instanceof Error ? error.message : String(error),
      });
      clearLoadingTimeout();
      startInFlightRef.current = false;
      setCallStatus(CALL_STATUS.UNAVAILABLE);
    }
  }, []);

  /**
   * Send a text message to the bot
   */
  const sendMessage = useCallback(
    async (message: string) => {
      try {
        const callObject = getCallObject();
        if (
          message.trim() &&
          onboardingUserKey &&
          !userProfile?.loading &&
          !userProfile?.onboardingComplete &&
          readOnboardingStatus(onboardingUserKey) === 'idle'
        ) {
          window.dispatchEvent(
            new CustomEvent<WebchatOnboardingFirstReplyDetail>(PEARL_ONBOARDING_FIRST_REPLY_EVENT, {
              detail: { source: 'voice' },
            }),
          );
        }
        
        // Send as app message to bot
        await callObject.sendAppMessage({
          message,
          timestamp: Date.now(),
        });

        // Add to local messages as MODEL_OUTPUT
        const userMessage: Message = {
          type: MessageTypeEnum.MODEL_OUTPUT,
          output: message,
        };
        setMessages((prev) => [...prev, userMessage]);
        voiceLogger.info('Message sent', {
          event: 'voice_message_sent',
          length: message.length,
        });
      } catch (error) {
        voiceLogger.error('Error sending message', {
          event: 'voice_message_error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [getCallObject, onboardingUserKey, userProfile?.loading, userProfile?.onboardingComplete]
  );

  /**
   * Update personality during active session
   * Sends a control message to the bot to switch personalities
   */
  const updatePersonality = useCallback(
    async (personalityConfig: {
      personalityId: string;
      name: string;
      voiceId: string;
      voiceProvider: string;
      voiceParameters?: any;
    }, mode?: string) => {
      try {
        if (callStatus !== CALL_STATUS.ACTIVE) {
          voiceLogger.warn('Cannot update personality - session not active', {
            event: 'voice_personality_inactive',
          });
          return;
        }

        // Check for idempotency to prevent loops
        const configHash = JSON.stringify({
          pid: personalityConfig.personalityId,
          persona: personalityConfig.name,
          vid: personalityConfig.voiceId,
          vp: personalityConfig.voiceProvider,
          vparam: personalityConfig.voiceParameters,
          mode: mode
        });

        if (lastAppliedConfigRef.current === configHash) {
          voiceLogger.info('Personality update skipped (idempotent)', {
            event: 'voice_personality_skip',
            personalityId: personalityConfig.personalityId,
          });
          return;
        }

        const callObject = getCallObject();
        
        // Send control message to bot to update personality
        // Note: sendAppMessage might be unreliable in some network conditions, so we also use the API endpoint below
        try {
          await callObject.sendAppMessage({
            type: 'updatePersonality',
            personalityId: personalityConfig.personalityId,
            persona: personalityConfig.name,
            voiceId: personalityConfig.voiceId,
            voiceProvider: personalityConfig.voiceProvider,
            voiceParameters: personalityConfig.voiceParameters,
            mode: mode,
            timestamp: Date.now(),
          });
        } catch (msgError) {
          voiceLogger.warn('Failed to send app message, falling back to API', {
            event: 'voice_personality_app_message_fallback',
            error: msgError instanceof Error ? msgError.message : String(msgError),
          });
        }

        // Also send via API to ensure bot receives it via Redis (ServiceSwitcher support)
        if (roomUrlRef.current) {
          await fetch('/api/bot/config', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-session-id': resolvedSessionId || resolvedUserId || '',
              'x-user-id': resolvedUserId,
              ...(resolvedUserName ? { 'x-user-name': resolvedUserName } : {}),
              ...(resolvedUserEmail ? { 'x-user-email': resolvedUserEmail } : {}),
            },
            body: JSON.stringify({
              room_url: roomUrlRef.current,
              sessionId: resolvedSessionId,
              sessionUserId: resolvedUserId,
              sessionUserEmail: resolvedUserEmail,
              sessionUserName: resolvedUserName,
              personalityId: personalityConfig.personalityId,
              persona: personalityConfig.name,
              voice: personalityConfig.voiceId,
              voiceProvider: personalityConfig.voiceProvider,
              voiceParameters: personalityConfig.voiceParameters,
              mode: mode,
            }),
          });
        }

        // Update last applied config
        lastAppliedConfigRef.current = configHash;

        voiceLogger.info('Personality update requested', {
          event: 'voice_personality_update',
          personalityId: personalityConfig.personalityId,
          mode,
        });
      } catch (error) {
        voiceLogger.error('Error updating personality', {
          event: 'voice_personality_error',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [callStatus, getCallObject]
  );

  /**
   * Mute/unmute microphone
   */
  const setMuted = useCallback(async (muted: boolean) => {
    try {
      const callObject = getCallObject();
      
      if (muted) {
        await muteAudio(callObject);
      } else {
        await unmuteAudio(callObject);
      }
    } catch (error) {
      voiceLogger.error('Error toggling mute', {
        event: 'voice_mute_error',
        muted,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [getCallObject]);

  useEffect(() => {
    return () => {
      clearLoadingTimeout();
    };
  }, [clearLoadingTimeout]);

  /**
   * Cleanup on unmount - with debounce to survive transient React remounts
   * (HMR, Fast Refresh, Suspense boundaries, StrictMode double-mounting)
   * 
   * Strategy: On unmount, schedule cleanup for UNMOUNT_CLEANUP_DELAY_MS later.
   * If component remounts before that, cancel the cleanup.
   */
  useEffect(() => {
    // Generate a unique ID for this mount instance
    const mountId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    
    // On mount: cancel any pending cleanup from a previous unmount
    if (pendingUnmountCleanupTimer) {
      voiceLogger.debug('Remount detected - canceling pending session cleanup', { 
        previousMountId: cleanupMountId,
        newMountId: mountId 
      });
      clearTimeout(pendingUnmountCleanupTimer);
      pendingUnmountCleanupTimer = null;
      cleanupMountId = null;
    }
    
    return () => {
      // On unmount: schedule deferred cleanup for ACTIVE or LOADING states
      // LOADING state needs protection because voice session may be mid-startup
      // when HMR/Fast Refresh causes component remount
      const currentStatus = callStatusRef.current;
      if (currentStatus === CALL_STATUS.ACTIVE || currentStatus === CALL_STATUS.LOADING) {
        voiceLogger.info('Scheduling deferred session cleanup', {
          mountId,
          delayMs: UNMOUNT_CLEANUP_DELAY_MS,
          callStatus: currentStatus,
        });
        cleanupMountId = mountId;
        pendingUnmountCleanupTimer = setTimeout(() => {
          // Only cleanup if this is still the pending cleanup (not cancelled by remount)
          // and session is still in a state that needs cleanup
          const statusAtCleanup = callStatusRef.current;
          if (cleanupMountId === mountId && 
              (statusAtCleanup === CALL_STATUS.ACTIVE || statusAtCleanup === CALL_STATUS.LOADING)) {
            voiceLogger.info('Executing deferred session cleanup', { 
              mountId, 
              callStatus: statusAtCleanup 
            });
            stop();
          } else {
            voiceLogger.debug('Deferred cleanup skipped (session no longer active/loading or cancelled)', {
              mountId,
              currentCleanupMountId: cleanupMountId,
              callStatus: statusAtCleanup,
            });
          }
          pendingUnmountCleanupTimer = null;
          cleanupMountId = null;
        }, UNMOUNT_CLEANUP_DELAY_MS);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount/unmount

  // Sync callStatus to context so all components can access it
  useEffect(() => {
    setContextCallStatus(callStatus as 'inactive' | 'active' | 'loading' | 'unavailable');
  }, [callStatus, setContextCallStatus]);

  useEffect(() => {
    const handleSessionEnd = (event: Event) => {
      const stopFn = stopRef.current;
      if (!stopFn || callStatusRef.current !== CALL_STATUS.ACTIVE) {
        return;
      }

      const detail = (event as CustomEvent<{ payload?: Record<string, unknown> }>).detail;
      const initiator = typeof detail?.payload === 'object'
        ? (detail.payload as { initiator?: unknown }).initiator
        : undefined;

      if (!allowAssistantSelfClose && initiator === 'assistant') {
        // Guard against assistant-driven closes when the flag is disabled
        return;
      }

      void stopFn();
    };

    window.addEventListener(NIA_EVENT_SESSION_END, handleSessionEnd as EventListener);
    return () => {
      window.removeEventListener(NIA_EVENT_SESSION_END, handleSessionEnd as EventListener);
    };
  }, [allowAssistantSelfClose]);

  // Sync toggleCall to context so all components can access it
  // Use a ref to track if we've already set the function to avoid infinite loops
  const toggleCallRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (toggleCallRef.current !== toggleCall) {
      toggleCallRef.current = toggleCall;
      setContextToggleCall(toggleCall);
    }
  }, [toggleCall, setContextToggleCall]);

  return {
    isSpeechActive,
    callStatus,
    unavailableMessage,
    audioLevel,
    activeTranscript,
    messages,
    start,
    stop,
    toggleCall,
    sendMessage,
    setMuted,
    updatePersonality,
  };
}

interface RequestBotJoinOptions {
  roomUrl: string;
  personalityId: string;
  voiceId?: string;
  voiceProvider?: string;
  tenantId?: string;
  token?: string;
  persona?: string;
  voiceParameters?: VoiceParametersInput;
  supportedFeatures?: string[];
  userId?: string;
  userName?: string;
  userEmail?: string;
  sessionId?: string;
  modePersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
  config?: any;
  mode?: string; // 'sprite' when starting with sprite voice
  webChatContext?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: number }>;
  activeNoteContext?: { noteId: string; title?: string; content?: string; tenantId?: string | null } | null;
}

/**
 * Notify gateway that client is leaving the room.
 * Clears pending config from Redis to prevent stale sprite/voice config
 * from affecting the next session.
 */
async function requestBotLeave(params: {
  roomUrl: string;
  tenantId?: string;
  sessionId?: string;
  sessionUserId?: string;
  sessionUserName?: string;
  sessionUserEmail?: string;
}): Promise<void> {
  try {
    const {
      roomUrl,
      tenantId,
      sessionId,
      sessionUserId,
      sessionUserName,
      sessionUserEmail,
    } = params;
    const response = await fetch('/api/bot/leave', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        room_url: roomUrl,
        tenantId,
        sessionId,
        sessionUserId,
        sessionUserName,
        sessionUserEmail,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Bot leave failed: ${response.status} ${JSON.stringify(error)}`);
    }

    voiceLogger.info('Bot leave notified', {
      event: 'voice_bot_leave_success',
      roomUrl,
    });
  } catch (error) {
    voiceLogger.error('Error notifying bot leave', {
      event: 'voice_bot_leave_error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Request bot to join the voice room
 * Calls unified bot join endpoint
 */
async function requestBotJoin({
  roomUrl,
  personalityId,
  voiceId,
  voiceProvider,
  tenantId,
  token,
  persona,
  voiceParameters,
  supportedFeatures,
  userId,
  userName,
  userEmail,
  sessionId,
  modePersonalityVoiceConfig,
  sessionOverride,
  config,
  mode,
}: RequestBotJoinOptions): Promise<void> {
  try {
    // User override from Settings -> Audio panel.
    let effectiveVoiceProvider = voiceProvider;
    const storedVoiceProvider = normalizeVoiceProvider(
      readLocalPreference(VOICE_PROVIDER_KEY, userId ?? null),
    );
    if (storedVoiceProvider) {
      effectiveVoiceProvider = toBotVoiceProvider(storedVoiceProvider);
    }

    const effectiveVoiceId = voiceId || defaultVoiceIdForBotProvider(effectiveVoiceProvider);

    // Allow server to enrich tenantId from session if not provided
    const normalizedVoiceParameters = normalizeVoiceParameters(
      effectiveVoiceProvider,
      effectiveVoiceId,
      voiceParameters,
    );

    voiceLogger.info('Requesting bot to join', {
      event: 'voice_bot_join_request',
      personalityId,
      voiceId: effectiveVoiceId,
      voiceProvider: effectiveVoiceProvider,
      tenantId,
      hasToken: !!token,
      supportedFeaturesCount: supportedFeatures?.length,
      mode,
    });

    const stableSessionUserId = userId || (sessionId ? `anon:${sessionId}` : undefined);
    const debugTraceId = `voice:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const webChatContext = readRecentWebChatContext(userId);
    const activeNoteContext = readActiveNoteContext();
    voiceLogger.info('Voice bot join trace', {
      event: 'voice_bot_join_trace',
      debugTraceId,
      roomUrl,
      hasStableSessionUserId: !!stableSessionUserId,
      webChatContextCount: webChatContext.length,
      hasActiveNoteContext: !!activeNoteContext,
      mode,
    });

    const botJoinCtrl = new AbortController();
    const botJoinTimeout = setTimeout(() => botJoinCtrl.abort(), 45000); // Gateway may wait up to 30s on pending direct launches.
    const response = await fetch('/api/bot/join', {
      method: 'POST',
      signal: botJoinCtrl.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        room_url: roomUrl,
        personalityId: personalityId.toLowerCase(),
        voiceOnly: true, // Voice-only session
        voice: effectiveVoiceId,
        voiceProvider: effectiveVoiceProvider,
        tenantId: tenantId, // Required for personality resolution
        token: token, // Daily room token for authorization
        persona: persona || 'Pearl', // Bot display name from Assistant.persona_name
        voiceParameters: normalizedVoiceParameters,
        supportedFeatures: supportedFeatures, // Feature flags for tool filtering
        sessionUserId: stableSessionUserId, // Stable fallback supports bot reuse/transition for anonymous sessions
        sessionUserName: userName, // User display name for profile loading
        sessionUserEmail: userEmail, // User email for profile loading
        sessionId: sessionId, // (Interface/OS session ID)
        modePersonalityVoiceConfig: modePersonalityVoiceConfig, // Map of mode -> config for hot-switching
        sessionOverride: sessionOverride,
        config: config,
        isOnboarding: config?.isOnboarding,
        mode: mode, // 'sprite' when starting with sprite voice
        debugTraceId,
        webChatContext,
        activeNoteId: activeNoteContext?.noteId,
        activeNoteContext,
      }),
    });

    clearTimeout(botJoinTimeout);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`Bot join failed: ${response.status} ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    voiceLogger.info('Bot joined successfully', {
      event: 'voice_bot_join_success',
      hasData: !!data,
      debugTraceId,
      status: data?.status,
      sessionId: data?.session_id || data?.sessionId,
      pid: data?.pid,
      reused: data?.reused,
    });
  } catch (error) {
    voiceLogger.error('Error requesting bot join', {
      event: 'voice_bot_join_error',
      error: error instanceof Error ? error.message : String(error),
      roomUrl,
    });
    throw error;
  }
}
