'use client';

import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';
import { Message, TranscriptMessage } from '@interface/types/conversation.types';

import {
  NIA_EVENT_CONVERSATION_WRAPUP,
  NIA_EVENT_SESSION_END,
} from '../features/DailyCall/events/niaEventRouter';
import { updateBotConfig } from '../features/DailyCall/lib/botClient';
import { useDailyCallState } from '../features/DailyCall/state/store';

import { useDesktopMode } from './desktop-mode-context';

/**
 * Voice session context - manages Daily.co call singleton
 * Replaces SpeechProvider with Daily-powered voice sessions
 */

interface VoiceSessionContextType {
  // Speech state
  isAssistantSpeaking: boolean;
  isUserSpeaking: boolean;
  audioLevel: number;
  assistantVolumeLevel: number;
  language: string;

  // Connection state
  sessionStatus: 'inactive' | 'connecting' | 'connected' | 'error';
  reconnectAttempts: number;
  
  // Room state
  roomUrl: string | null;
  setRoomUrl: (url: string | null) => void;

  // Personality state
  activePersonality?: {
    personalityId: string;
    voiceId: string;
  };
  
  // Current persona name - used for bot participant detection
  // Bot joins with persona.capitalize() as username (e.g., "T", "Pearl")
  currentPersonaName: string | null;
  setCurrentPersonaName: (name: string | null) => void;

  // Call control state (shared across all components)
  callStatus: 'inactive' | 'active' | 'loading' | 'unavailable';
  toggleCall: (() => void) | null;
  setCallStatus: (status: 'inactive' | 'active' | 'loading' | 'unavailable') => void;
  setToggleCall: (callback: (() => void) | null) => void;

  // Advanced state
  isCallEnding: boolean;
  canAssistantAnimate: boolean;
  isAssistantGeneratingText: boolean;
  lastAssistantMessage: string;
  assistantSpeechConfidence: number;
  transcriptQuality: 'none' | 'partial' | 'final';
  speechTimestamp: number;

  // Transcript state (lifted from useVoiceSession for Sprite access)
  messages: Message[];
  activeTranscript: TranscriptMessage | null;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveTranscript: (transcript: TranscriptMessage | null) => void;

  // Sprite voice state
  activeSpriteId: string | null;
  activeSpriteVoice: boolean;
  spriteVoiceWasPaused: boolean;  // For DailyCall resume
  spriteStartedSession: boolean;  // True if sprite initiated the voice session (vs joining existing)
  setActiveSpriteId: (id: string | null) => void;
  setActiveSpriteVoice: (active: boolean) => void;
  setSpriteVoiceWasPaused: (paused: boolean) => void;
  setSpriteStartedSession: (started: boolean) => void;

  // Sprite voice helper actions
  /** Enable Sprite voice - sets activeSpriteVoice true, tracks sprite ID, sends voice config to bot, and optionally sends greeting */
  enableSpriteVoice: (spriteId: string, voiceConfig?: { voiceProvider: string; voiceId: string }, isNewSession?: boolean, spriteName?: string, tenantId?: string, botConfig?: Record<string, unknown> | null) => void;
  /** Disable Sprite voice - returns to OS personality, clears sprite state */
  disableSpriteVoice: () => void;
  
  /** Get pending sprite config for /join call - returns config if sprite voice was enabled before session start */
  getPendingSpriteConfig: () => { spriteId: string; voiceProvider?: string; voiceId?: string } | null;
  /** Clear pending sprite config after it's been consumed by /join */
  clearPendingSpriteConfig: () => void;
  
  /** Set mode personality voice config - called by useVoiceSession when it receives the config */
  setModePersonalityVoiceConfig: (config: Record<string, any> | undefined) => void;

  // Daily call object singleton - get or create lazily
  getCallObject: () => DailyCall;
  destroyCallObject: () => void;
}

const VoiceSessionContext = createContext<VoiceSessionContextType | undefined>(undefined);

export const VoiceSessionProvider: React.FC<{ 
  children: React.ReactNode;
  modePersonalityVoiceConfig?: Record<string, any>;
}> = ({ children, modePersonalityVoiceConfig: initialModePersonalityVoiceConfig }) => {
  const log = getClientLogger('VoiceSession');
  // Speech state - updated via Daily.co audio level events
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [assistantVolumeLevel, setAssistantVolumeLevel] = useState(0);
  const [language] = useState('en');

  // Connection state
  const [sessionStatus, setSessionStatus] = useState<
    'inactive' | 'connecting' | 'connected' | 'error'
  >('inactive');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  // Room state
  const [roomUrl, setRoomUrl] = useState<string | null>(null);
  
  // Current persona name - used for bot participant detection
  // Bot joins with persona.capitalize() as username (e.g., "T", "Pearl")
  const [currentPersonaName, setCurrentPersonaName] = useState<string | null>(null);

  // Transcript state (lifted from useVoiceSession for Sprite access)
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeTranscript, setActiveTranscript] = useState<TranscriptMessage | null>(null);
  
  // Mode personality voice config - can be set via prop or via setModePersonalityVoiceConfig
  // This is needed for disableSpriteVoice to restore OS personality
  const [modePersonalityVoiceConfig, setModePersonalityVoiceConfig] = useState<Record<string, any> | undefined>(
    initialModePersonalityVoiceConfig
  );

  // Sprite voice state
  const [activeSpriteId, setActiveSpriteId] = useState<string | null>(null);
  const [activeSpriteVoice, setActiveSpriteVoice] = useState(false);
  const [spriteVoiceWasPaused, setSpriteVoiceWasPaused] = useState(false);
  const [spriteStartedSession, setSpriteStartedSession] = useState(false);  // True if sprite initiated the voice session
  const lastSpriteVoiceConfigRef = useRef<{ voiceProvider?: string; voiceId?: string } | null>(null);
  const lastAppliedSpriteConfigKeyRef = useRef<string | null>(null);
  
  // Track pending sprite config that needs to be sent when roomUrl becomes available
  // Stores the full config object including voice provider and voice ID
  const pendingSpriteConfigRef = useRef<{ spriteId: string; voiceProvider?: string; voiceId?: string } | null>(null);

  // Personality state - moved up so disableSpriteVoice can use currentMode
  const { currentMode } = useDesktopMode();

  /**
   * Send admin message to bot to trigger speech/response
   * Used to prompt sprite to greet user in character after takeover
   */
  const sendAdminMessage = useCallback(async (message: string, currentRoomUrl: string, tenantId?: string) => {
    try {
      const response = await fetch('/api/bot/admin', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-room-url': currentRoomUrl,
        },
        body: JSON.stringify({
          message,
          mode: 'immediate', // Interrupt and speak immediately
          roomUrl: currentRoomUrl,
          tenantId: tenantId || 'default', // Fallback to 'default' if not provided
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        log.error('Failed to send admin message', { error: errorData });
        return false;
      }
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error('Error sending admin message', { error: errorMessage });
      return false;
    }
  }, [log]);

  /**
   * Enable Sprite voice mode
   * - Sets activeSpriteVoice = true
   * - Tracks the sprite ID for personality switching
   * - Sends bot config update to switch personality to sprite WITH voice config
   * - Sends greeting message to prompt sprite to introduce themselves in character
   * - If roomUrl not available yet, stores as pending and sends when roomUrl is set
   * - Does NOT start voice session (handleSpriteClick does that)
   * 
   * @param spriteId - ID of the sprite personality to switch to
   * @param voiceConfig - Optional voice config for the sprite
   * @param isNewSession - If true, this is a fresh session (sprite starting call), no greeting needed
   * @param spriteName - Display name for the sprite (used as persona name so user can address sprite by name)
   */
  const enableSpriteVoice = useCallback((
    spriteId: string,
    voiceConfig?: { voiceProvider: string; voiceId: string },
    isNewSession?: boolean,
    spriteName?: string,
    tenantId?: string,
    botConfig?: Record<string, unknown> | null,
  ) => {
    log.info('Enabling Sprite voice', { spriteId, roomUrl, voiceConfig, isNewSession, spriteName, tenantId });
    setActiveSpriteId(spriteId);
    setActiveSpriteVoice(true);
    setSpriteVoiceWasPaused(false);
    lastSpriteVoiceConfigRef.current = voiceConfig || null;
    
    // Build the config object with voice settings
    // updateBotConfig expects voice to be an object with { voiceId, provider }
    const configPayload = {
      personalityId: spriteId,
      mode: 'sprite', // Mark this as a sprite personality switch
      ...(spriteName && { persona: spriteName }), // Set persona name so user can address sprite by name
      ...(voiceConfig && {
        voice: {
          voiceId: voiceConfig.voiceId,
          provider: voiceConfig.voiceProvider,
        },
      }),
      ...(botConfig && { botConfig }), // Pass sprite bot configuration for tool filtering & behavior
    };
    
    // Send config update to bot to switch personality AND voice to this sprite
    if (roomUrl) {
      log.info('Sending bot config update for sprite personality with voice', { spriteId, roomUrl, voiceConfig, persona: spriteName });
      pendingSpriteConfigRef.current = null; // Clear any pending since we're sending now
      updateBotConfig(roomUrl, configPayload)
        .then(() => {
          // Only send greeting if this is a takeover of an existing session (not a new session)
          // The sprite's personality prompt already instructs it to be in character
          // This message prompts an immediate greeting to acknowledge the takeover
          if (!isNewSession) {
            log.info('Sending sprite takeover greeting', { spriteId, roomUrl, tenantId });
            // Use custom greeting from bot config, or default takeover prompt
            const customGreeting = botConfig?.greeting as string | undefined;
            const greetingPrompt = customGreeting
              ? `Say exactly this to the user: "${customGreeting}"`
              : 'You have just taken over this voice conversation. Greet the user warmly, in character, with a brief introduction of who you are (1-2 sentences). Be playful and engaging.';
            // Give the bot a moment to process the config change before sending greeting
            setTimeout(() => {
              sendAdminMessage(greetingPrompt, roomUrl, tenantId);
            }, 500);
          }
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Failed to update bot config for sprite', { error: message, spriteId });
        });
    } else {
      // Store as pending - will be sent when roomUrl becomes available
      log.info('Storing pending sprite config (roomUrl not available yet)', { spriteId, voiceConfig, spriteName });
      pendingSpriteConfigRef.current = {
        spriteId,
        voiceProvider: voiceConfig?.voiceProvider,
        voiceId: voiceConfig?.voiceId,
      };
    }
  }, [log, roomUrl, sendAdminMessage]);

  /**
   * Disable Sprite voice mode
   * - Clears sprite state
   * - Sends bot config update to restore OS personality and voice
   * - Voice session stays active, only the personality/voice switches back
   */
  const disableSpriteVoice = useCallback(() => {
    log.info('Disabling Sprite voice', { previousSpriteId: activeSpriteId, roomUrl, currentMode });
    setActiveSpriteId(null);
    setActiveSpriteVoice(false);
    setSpriteVoiceWasPaused(false);
    pendingSpriteConfigRef.current = null; // Clear any pending config
    lastSpriteVoiceConfigRef.current = null;
    lastAppliedSpriteConfigKeyRef.current = null;
    
    // Restore OS personality and voice - keep voice session active
    if (roomUrl && modePersonalityVoiceConfig) {
      const modeConfig = modePersonalityVoiceConfig[currentMode] || modePersonalityVoiceConfig['standard'] || modePersonalityVoiceConfig['default'];
      if (modeConfig) {
        log.info('Restoring OS personality after sprite dismiss', {
          personalityId: modeConfig.personalityId,
          voiceId: modeConfig.voice?.voiceId,
          voiceProvider: modeConfig.voice?.provider,
          mode: currentMode,
        });
        
        updateBotConfig(roomUrl, {
          personalityId: modeConfig.personalityId,
          mode: currentMode,
          ...(modeConfig.voice && {
            voice: {
              voiceId: modeConfig.voice.voiceId,
              provider: modeConfig.voice.provider,
            },
          }),
        }).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          log.error('Failed to restore OS personality after sprite dismiss', { error: message });
        });
      } else {
        log.warn('No OS personality config found for mode', { currentMode });
      }
    }
  }, [log, activeSpriteId, roomUrl, currentMode, modePersonalityVoiceConfig]);

  /**
   * Get pending sprite config for /join call
   * Returns the sprite config if enableSpriteVoice was called before session start
   * This allows useVoiceSession to pass sprite config directly to requestBotJoin
   */
  const getPendingSpriteConfig = useCallback(() => {
    return pendingSpriteConfigRef.current;
  }, []);

  /**
   * Clear pending sprite config after it's been consumed by /join
   */
  const clearPendingSpriteConfig = useCallback(() => {
    pendingSpriteConfigRef.current = null;
  }, []);

  // Sync roomUrl from DailyCallState if available
  const { roomUrl: dailyRoomUrl } = useDailyCallState();
  useEffect(() => {
    if (dailyRoomUrl && dailyRoomUrl !== roomUrl) {
      setRoomUrl(dailyRoomUrl);
    }
  }, [dailyRoomUrl, roomUrl]);
  
  // Sync modePersonalityVoiceConfig from prop if passed to provider
  // This handles the case where the provider is re-rendered with a new prop
  useEffect(() => {
    if (initialModePersonalityVoiceConfig && !modePersonalityVoiceConfig) {
      setModePersonalityVoiceConfig(initialModePersonalityVoiceConfig);
    }
  }, [initialModePersonalityVoiceConfig, modePersonalityVoiceConfig]);

  // Send pending sprite config when roomUrl becomes available
  // NOTE: This is a fallback path. The primary path is via requestBotJoin in useVoiceSession,
  // which passes sprite config directly in the /join call. This effect handles edge cases
  // where the session was already active when enableSpriteVoice was called.
  useEffect(() => {
    const pendingConfig = pendingSpriteConfigRef.current;
    if (roomUrl && pendingConfig) {
      log.info('Sending deferred sprite config update (roomUrl now available)', { 
        spriteId: pendingConfig.spriteId, 
        roomUrl,
        voiceConfig: { voiceProvider: pendingConfig.voiceProvider, voiceId: pendingConfig.voiceId },
      });
      pendingSpriteConfigRef.current = null; // Clear pending before sending
      updateBotConfig(roomUrl, {
        personalityId: pendingConfig.spriteId,
        mode: 'sprite',
        ...(pendingConfig.voiceProvider && pendingConfig.voiceId && {
          voice: {
            voiceId: pendingConfig.voiceId,
            provider: pendingConfig.voiceProvider,
          },
        }),
      }).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error('Failed to send deferred sprite config', { error: message, spriteId: pendingConfig.spriteId });
      });
    }
  }, [roomUrl, log]);

  const activePersonality = React.useMemo(() => {
    if (!modePersonalityVoiceConfig) return undefined;
    
    // Default to 'standard' if mode not found or no specific personality
    const modeConfig = modePersonalityVoiceConfig[currentMode] || modePersonalityVoiceConfig['standard'];
    
    return modeConfig ? {
      personalityId: modeConfig.personalityId,
      voiceId: modeConfig.voiceId
    } : undefined;
  }, [currentMode, modePersonalityVoiceConfig]);

  // Call control state (shared across all components)
  const [callStatus, setCallStatus] = useState<'inactive' | 'active' | 'loading' | 'unavailable'>('inactive');
  const [toggleCall, setToggleCallState] = useState<(() => void) | null>(null);

  // Setter function for toggleCall
  const setToggleCall = useCallback((fn: (() => void) | null) => {
    setToggleCallState(() => fn);
  }, []);

  // Ensure sprite personality/voice is re-applied after call becomes active (post-join) to avoid stale configs
  useEffect(() => {
    if (callStatus === 'inactive') {
      lastAppliedSpriteConfigKeyRef.current = null;
      return;
    }

    if (callStatus !== 'active' || !roomUrl || !activeSpriteVoice || !activeSpriteId) {
      return;
    }

    const voiceConfig = lastSpriteVoiceConfigRef.current;
    const key = [roomUrl, activeSpriteId, voiceConfig?.voiceProvider || '', voiceConfig?.voiceId || ''].join('|');

    if (lastAppliedSpriteConfigKeyRef.current === key) {
      return;
    }

    lastAppliedSpriteConfigKeyRef.current = key;

    log.info('Re-applying sprite voice config after session activation', {
      spriteId: activeSpriteId,
      roomUrl,
      voiceProvider: voiceConfig?.voiceProvider,
      voiceId: voiceConfig?.voiceId,
    });

    updateBotConfig(roomUrl, {
      personalityId: activeSpriteId,
      mode: 'sprite',
      ...(voiceConfig?.voiceProvider && voiceConfig?.voiceId && {
        voice: {
          voiceId: voiceConfig.voiceId,
          provider: voiceConfig.voiceProvider,
        },
      }),
    }).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Failed to re-apply sprite config after activation', { error: message, spriteId: activeSpriteId });
    });
  }, [callStatus, roomUrl, activeSpriteVoice, activeSpriteId, log]);

  // Advanced state
  const [isCallEnding, setIsCallEnding] = useState(false);
  const [canAssistantAnimate, setCanAssistantAnimate] = useState(false);
  const [isAssistantGeneratingText, setIsAssistantGeneratingText] = useState(false);
  const [lastAssistantMessage, setLastAssistantMessage] = useState('');
  const [assistantSpeechConfidence, setAssistantSpeechConfidence] = useState(0);
  const [transcriptQuality, setTranscriptQuality] = useState<'none' | 'partial' | 'final'>('none');
  const [speechTimestamp, setSpeechTimestamp] = useState(0);

  // Daily call object singleton - shared across all voice sessions
  // Only create when needed (lazy initialization)
  const callObjectRef = useRef<DailyCall | null>(null);

  // DailyCall mutual exclusion: pause voice when video call is active
  const isDailyCallActiveRef = useRef(false);

  // Refs to access current state values in event handlers without causing re-subscriptions
  const activeSpriteVoiceRef = useRef(activeSpriteVoice);
  const spriteVoiceWasPausedRef = useRef(spriteVoiceWasPaused);
  
  // Keep refs in sync with state
  useEffect(() => {
    activeSpriteVoiceRef.current = activeSpriteVoice;
  }, [activeSpriteVoice]);
  
  useEffect(() => {
    spriteVoiceWasPausedRef.current = spriteVoiceWasPaused;
  }, [spriteVoiceWasPaused]);

  // CRITICAL: Call object lifecycle must be in a SEPARATE effect with empty deps
  // to prevent the call object from being destroyed on state changes
  useEffect(() => {
    log.info('[VoiceSessionProvider] Mounted - call object will be created lazily');
    
    return () => {
      log.info('[VoiceSessionProvider] Unmounting - destroying call object');
      if (callObjectRef.current) {
        try {
          callObjectRef.current.destroy();
          log.info('[VoiceSessionProvider] Call object destroyed');
        } catch (err) {
          log.warn('[VoiceSessionProvider] Error destroying call object', { error: err });
        }
        callObjectRef.current = null;
      }
    };
  }, []); // Empty deps - only run on mount/unmount

  useEffect(() => {
    // Setup event listeners for DailyCall mutual exclusion

    // Listen for bot speaking via Daily.co audio level events
    // These events are dispatched by useBotSpeakingDetection hook
    const handleAudioLevel = (event: Event) => {
      // CRITICAL: Ignore bot audio when Daily Call is active (bot is suspended)
      if (isDailyCallActiveRef.current) {
        return;
      }

      const { detail } = event as CustomEvent<{ 
        botParticipantId: string; 
        level: number; 
        isSpeaking: boolean;
      }>;
      
      if (detail) {
        const { level, isSpeaking } = detail;
        
        setAudioLevel(level);
        setIsAssistantSpeaking(isSpeaking);
        
        if (isSpeaking) {
          setAssistantVolumeLevel(Math.round(level * 100));
        } else {
          setAssistantVolumeLevel(0);
        }
      }
    };

    // Listen for user speaking via Daily.co user audio level events
    const handleUserAudioLevel = (event: Event) => {
      // CRITICAL: Ignore user audio events when Daily Call is active
      if (isDailyCallActiveRef.current) {
        return;
      }

      const { detail } = event as CustomEvent<{ 
        level: number; 
        isSpeaking: boolean;
      }>;
      
      if (detail) {
        setIsUserSpeaking(detail.isSpeaking);
      }
    };

    // Listen for DailyCall session events for mutual exclusion
    const handleDailyCallSessionStart = () => {
      log.info('Daily Call started - suspending voice bot');
      isDailyCallActiveRef.current = true;

      // Track if Sprite voice was active before DailyCall (for resume)
      // Use ref to get current value without re-subscribing
      if (activeSpriteVoiceRef.current) {
        log.info('Sprite voice was active, will resume after DailyCall');
        setSpriteVoiceWasPaused(true);
      }

      // CRITICAL: Completely mute the voice-only bot's connection
      if (callObjectRef.current) {
        try {
          // 1. Mute user's microphone input to the voice-only bot
          // This prevents the bot from hearing anything the user says
          callObjectRef.current.setLocalAudio(false);
          log.info('Muted local audio (user mic → voice bot)');

          // 2. Mute the bot's audio output tracks
          // This prevents the user from hearing the bot's responses
          const participants = callObjectRef.current.participants();
          Object.entries(participants || {}).forEach(([sessionId, participant]: [string, any]) => {
            if (sessionId !== 'local') {
              try {
                // Mute this participant's audio track
                callObjectRef.current?.updateParticipant(sessionId, {
                  setAudio: false
                });
                log.info('Muted bot audio output', { sessionId });
              } catch (e) {
                log.warn('Could not mute participant', { error: e });
              }
            }
          });

          // 3. Clear UI state immediately
          setIsAssistantSpeaking(false);
          setAudioLevel(0);
          setAssistantVolumeLevel(0);
          
          log.info('Voice bot fully suspended (connection-level muting)');
        } catch (err) {
          log.error('Error suspending voice bot', { error: err });
        }
      }
    };

    const handleDailyCallSessionEnd = () => {
      log.info('Daily Call ended - resuming voice bot');
      isDailyCallActiveRef.current = false;

      // Resume Sprite voice if it was paused (use ref to get current value)
      if (spriteVoiceWasPausedRef.current) {
        log.info('Resuming Sprite voice after DailyCall');
        setActiveSpriteVoice(true);
        setSpriteVoiceWasPaused(false);
      }

      // CRITICAL: Resume voice-only bot's connection
      if (callObjectRef.current) {
        try {
          // 1. Unmute user's microphone to the voice-only bot
          callObjectRef.current.setLocalAudio(true);
          log.info('Unmuted local audio (user mic → voice bot)');

          // 2. Unmute bot's audio output
          const participants = callObjectRef.current.participants();
          Object.entries(participants || {}).forEach(([sessionId, participant]: [string, any]) => {
            if (sessionId !== 'local') {
              try {
                callObjectRef.current?.updateParticipant(sessionId, {
                  setAudio: true
                });
                log.info('Unmuted bot audio output', { sessionId });
              } catch (e) {
                log.warn('Could not unmute participant', { error: e });
              }
            }
          });

          log.info('Voice bot fully resumed (connection-level unmuting)');
        } catch (err) {
          log.error('Error resuming voice bot', { error: err });
        }
      }
    };

    // Subscribe to Daily.co audio level events (bot speaking detection)
    window.addEventListener('daily:audioLevel', handleAudioLevel as EventListener);
    window.addEventListener('daily:userAudioLevel', handleUserAudioLevel as EventListener);

    // Subscribe to DailyCall events
    window.addEventListener('dailyCall.session.start', handleDailyCallSessionStart);
    window.addEventListener('dailyCall.session.end', handleDailyCallSessionEnd);

    const handleConversationWrapup = () => {
      setIsCallEnding(true);
    };

    const handleSessionEnd = () => {
      setIsCallEnding(false);
      setSessionStatus('inactive');
    };

    // Subscribe to Nia events (only conversation control, not speaking events)
    window.addEventListener(NIA_EVENT_CONVERSATION_WRAPUP, handleConversationWrapup);
    window.addEventListener(NIA_EVENT_SESSION_END, handleSessionEnd);

    // Cleanup event listeners on unmount (call object cleanup is handled separately)
    return () => {
      window.removeEventListener('daily:audioLevel', handleAudioLevel as EventListener);
      window.removeEventListener('daily:userAudioLevel', handleUserAudioLevel as EventListener);
      window.removeEventListener('dailyCall.session.start', handleDailyCallSessionStart);
      window.removeEventListener('dailyCall.session.end', handleDailyCallSessionEnd);
      window.removeEventListener(NIA_EVENT_CONVERSATION_WRAPUP, handleConversationWrapup);
      window.removeEventListener(NIA_EVENT_SESSION_END, handleSessionEnd);
    };
  }, [log]); // Only depends on log (which is stable)

  // No longer need audio level simulation - we get real data from Daily.co events

  // Get or create call object lazily
  const getCallObject = () => {
    if (!callObjectRef.current) {
      log.info('[getCallObject] Creating new DailyIframe call object', {
        subscribeToTracksAutomatically: true,
        audioSource: true,
        videoSource: false,
        allowMultipleCallInstances: true,
      });
      try {
        callObjectRef.current = DailyIframe.createCallObject({
          subscribeToTracksAutomatically: true,
          audioSource: true,
          videoSource: false, // Voice-only
          allowMultipleCallInstances: true,
        });
        log.info('[getCallObject] DailyIframe call object created successfully', {
          meetingState: callObjectRef.current.meetingState?.(),
        });
      } catch (err) {
        log.error('[getCallObject] Failed to create DailyIframe call object', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    } else {
      log.debug('[getCallObject] Returning existing call object', {
        meetingState: callObjectRef.current.meetingState?.(),
      });
    }
    return callObjectRef.current;
  };

  // Destroy call object
  const destroyCallObject = () => {
    if (callObjectRef.current) {
      callObjectRef.current.destroy();
      callObjectRef.current = null;
    }
  };

  const contextValue: VoiceSessionContextType = {
    // Speech state
    isAssistantSpeaking,
    isUserSpeaking,
    audioLevel,
    assistantVolumeLevel,
    language,

    // Connection state
    sessionStatus,
    reconnectAttempts,
    
    // Room state
    roomUrl,
    setRoomUrl,

    // Personality state
    activePersonality,
    
    // Current persona name for bot detection
    currentPersonaName,
    setCurrentPersonaName,

    // Call control state (shared across all components)
    callStatus,
    toggleCall,
    setCallStatus,
    setToggleCall,

    // Advanced state
    isCallEnding,
    canAssistantAnimate,
    isAssistantGeneratingText,
    lastAssistantMessage,
    assistantSpeechConfidence,
    transcriptQuality,
    speechTimestamp,

    // Transcript state (lifted from useVoiceSession for Sprite access)
    messages,
    activeTranscript,
    setMessages,
    setActiveTranscript,

    // Sprite voice state
    activeSpriteId,
    activeSpriteVoice,
    spriteVoiceWasPaused,
    spriteStartedSession,
    setActiveSpriteId,
    setActiveSpriteVoice,
    setSpriteVoiceWasPaused,
    setSpriteStartedSession,

    // Sprite voice helper actions
    enableSpriteVoice,
    disableSpriteVoice,
    getPendingSpriteConfig,
    clearPendingSpriteConfig,
    setModePersonalityVoiceConfig,

    // Daily call singleton functions
    getCallObject,
    destroyCallObject,
  };

  return (
    <VoiceSessionContext.Provider value={contextValue}>
      {children}
    </VoiceSessionContext.Provider>
  );
};

/**
 * Hook to access voice session context
 */
export function useVoiceSessionContext() {
  const context = useContext(VoiceSessionContext);
  if (!context) {
    throw new Error('useVoiceSessionContext must be used within VoiceSessionProvider');
  }
  return context;
}

