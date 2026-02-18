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
const UNMOUNT_CLEANUP_DELAY_MS = 200; // Allow 200ms for remount before tearing down session

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
  voiceId?: string; // Preferred TTS voice id (ElevenLabs)
  voiceProvider?: string;
  voiceParameters?: VoiceParametersInput;
  supportedFeatures?: string[]; // Feature flags for tool filtering (e.g., ['notes', 'youtube', 'gmail'])
  modePersonalityVoiceConfig?: Record<string, any>; // Map of mode -> config for hot-switching
  sessionOverride?: Record<string, any>;
  config?: any;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
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
  
  // State
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [callStatus, setCallStatus] = useState<CALL_STATUS>(CALL_STATUS.INACTIVE);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTranscript, setActiveTranscript] = useState<TranscriptMessage | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Event cleanup and room URL references
  const eventCleanupRef = useRef<(() => void) | null>(null);
  const roomUrlRef = useRef<string | null>(null);
  const callStatusRef = useRef<CALL_STATUS>(callStatus);
  const startRef = useRef<(() => Promise<void>) | null>(null);
  const stopRef = useRef<(() => Promise<void>) | null>(null);
  const startInFlightRef = useRef(false);
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
  }, [allowAssistantSelfClose]);

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
        voiceLogger.warn('Bot join timed out after 20s — marking unavailable', {
          event: 'voice_bot_join_timeout',
          timeoutMs: LOADING_TIMEOUT_MS,
          meetingState: getCallObject?.()?.meetingState?.() ?? 'unknown',
        });
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
      voiceLogger.info('Starting session for user', {
        event: 'voice_start',
        userId: resolvedUserId,
        configIsOnboarding: config?.isOnboarding,
        personalityId,
      });
      // Clear prior transcripts so new sessions (including Sprite sessions) don't show stale bubbles
      setMessages([]);
      setActiveTranscript(null);
      setCallStatus(CALL_STATUS.LOADING);
      armLoadingTimeout();

      // Get or create voice room via API endpoint
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
        throw new Error(`Failed to create voice room: ${response.status}`);
      }

      const voiceRoom = await response.json();
      roomUrlRef.current = voiceRoom.roomUrl;
      setContextRoomUrl(voiceRoom.roomUrl); // Share room URL with context

      voiceLogger.info('Room ready', {
        event: 'voice_room_ready',
        roomName: voiceRoom.roomName,
        reused: voiceRoom.reused,
      });

      // Get or create call object from context
      const callObject = getCallObject();

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
        // This is important for lipsync to work correctly (effectiveSpeaking in RiveAvatar)
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
      const botJoinPromise = requestBotJoin({
        roomUrl: voiceRoom.roomUrl,
        personalityId: effectivePersonalityId,
        voiceId: effectiveVoiceId,
        voiceProvider: effectiveVoiceProvider,
        tenantId,
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
      }).catch((err) => {
        // Log but don't fail - allow client to join even if bot spawn fails
        voiceLogger.error('Bot join failed', {
          event: 'voice_bot_join_failed',
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      });
      
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

      // Wait for both to complete (bot failure is non-fatal)
      voiceLogger.info('Waiting for bot and client join promises', {
        event: 'voice_join_await_start',
      });
      await Promise.all([botJoinPromise, clientJoinPromise]);

      voiceLogger.info('Joined room successfully', {
        event: 'voice_join_success',
        meetingState: callObject.meetingState?.(),
        participants: Object.keys(callObject.participants() || {}),
      });
      await ensureRecordingActive(callObject);
      clearLoadingTimeout();
      setCallStatus(CALL_STATUS.ACTIVE);
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
      voiceLogger.error('Failed to start session', {
        event: 'voice_start_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      clearLoadingTimeout();
      startInFlightRef.current = false;
      setCallStatus(CALL_STATUS.UNAVAILABLE);
      throw error;
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
      if (callStatusRef.current === CALL_STATUS.LOADING) {
        voiceLogger.warn('Stop ignored during loading; waiting for bot join', {
          event: 'voice_stop_ignored_loading',
        });
        return;
      }

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
        requestBotLeave(roomUrlToLeave).catch((err) => {
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
      setCallStatus(CALL_STATUS.INACTIVE);
      setIsSpeechActive(false);
      roomUrlRef.current = null;
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

      // Best-effort: tell bot gateway that we're leaving this room using a beacon
      if (roomUrl && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          const payload = JSON.stringify({ room_url: roomUrl });
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/bot/leave', blob);
        } catch {
          // Swallow errors – unload should not be blocked by telemetry failures
        }
      }

      // Also trigger local stop logic so Daily + room manager can clean up
      if (
        (currentStatus === CALL_STATUS.ACTIVE || currentStatus === CALL_STATUS.LOADING) &&
        stopRef.current
      ) {
        try {
          void stopRef.current();
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
    voiceLogger.info('toggleCall invoked', {
      event: 'voice_toggle',
      status: callStatusRef.current,
    });
    if (callStatusRef.current === CALL_STATUS.ACTIVE) {
      if (stopRef.current) {
        await stopRef.current();
      }
    } else if (callStatusRef.current === CALL_STATUS.INACTIVE) {
      if (startRef.current) {
        await startRef.current();
      }
    } else {
      voiceLogger.warn('toggleCall ignored due to status', {
        event: 'voice_toggle_ignored',
        status: callStatusRef.current,
      });
    }
  }, []);

  /**
   * Send a text message to the bot
   */
  const sendMessage = useCallback(
    async (message: string) => {
      try {
        const callObject = getCallObject();
        
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
    [getCallObject]
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
}

/**
 * Notify gateway that client is leaving the room.
 * Clears pending config from Redis to prevent stale sprite/voice config
 * from affecting the next session.
 */
async function requestBotLeave(roomUrl: string): Promise<void> {
  try {
    const response = await fetch('/api/bot/leave', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ room_url: roomUrl }),
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
    // Allow server to enrich tenantId from session if not provided
    const normalizedVoiceParameters = normalizeVoiceParameters(
      voiceProvider,
      voiceId,
      voiceParameters,
    );

    voiceLogger.info('Requesting bot to join', {
      event: 'voice_bot_join_request',
      personalityId,
      voiceId,
      voiceProvider,
      tenantId,
      hasToken: !!token,
      supportedFeaturesCount: supportedFeatures?.length,
      mode,
    });

    const stableSessionUserId = userId || (sessionId ? `anon:${sessionId}` : undefined);
    const debugTraceId = `voice:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    voiceLogger.info('Voice bot join trace', {
      event: 'voice_bot_join_trace',
      debugTraceId,
      roomUrl,
      hasStableSessionUserId: !!stableSessionUserId,
      mode,
    });

    const response = await fetch('/api/bot/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        room_url: roomUrl,
        personalityId: personalityId.toLowerCase(),
        voiceOnly: true, // Voice-only session
        voice: voiceId || 'kdmDKE6EkgrWrrykO9Qt', // Default ElevenLabs voice
        voiceProvider: voiceProvider,
        tenantId: tenantId, // Required for personality resolution
        token: token, // Daily room token for authorization
        persona: persona || 'Pearl', // Bot display name from Assistant.persona_name
        voiceParameters: normalizedVoiceParameters, // ElevenLabs/Kokoro voice parameters
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
      }),
    });

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
