/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import type { DailyCall, DailyParticipantsObject } from '@daily-co/daily-js';
import { isFeatureEnabled } from '@nia/features';
import type { PersonalityVoiceConfig } from '@nia/prism';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { AssistantButton } from '@interface/components/assistant-button';
import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUI } from '@interface/contexts/ui-context';
import { useUserProfile } from '@interface/contexts/user-profile-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { NIA_EVENT_ONBOARDING_COMPLETE } from '@interface/features/DailyCall/events/niaEventRouter';
import { isScreenShareSupported, isSecureContext } from '@interface/features/DailyCall/lib/screenShare';
import { VoiceInputBox } from '@interface/features/VoiceInput';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { CALL_STATUS, useVoiceSession } from '@interface/hooks/useVoiceSession';
import { getClientLogger } from '@interface/lib/client-logger';
import type { VoiceParametersInput } from '@interface/lib/voice/kokoro';

interface AssistantWrapperProps {
  assistantName: string;
  clientLanguage?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  themeData?: any;
  supportedFeatures: string[];
  startFullScreen: boolean;
  personalityId?: string; // OS personality ID for voice-only sessions
  tenantId?: string;
  persona?: string; // Bot display name from Assistant.persona_name (e.g., "Pearl")
  voiceId?: string; // Preferred TTS voice id (ElevenLabs)
  voiceProvider?: string;
  voiceParameters?: VoiceParametersInput;
  allowedPersonalities?: Record<string, PersonalityVoiceConfig>; // Map of composite key (name-provider-voiceId) -> personality config
  modePersonalityVoiceConfig?: Record<string, any>;
  dailyCallPersonalityVoiceConfig?: Record<string, any>;
  sessionOverride?: Record<string, any>;
}

const logger = getClientLogger('[assistant_canvas]');

function getParticipantsSnapshot(callObject: DailyCall | null): DailyParticipantsObject | null {
  if (!callObject) {
    return null;
  }
  try {
    return typeof callObject.participants === 'function'
      ? callObject.participants()
      : callObject.participants();
  } catch (error) {
    logger.error('Failed to read participants snapshot', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

// Helper: Find composite key by matching personalityId (for migration from old UUID-based keys)
function findKeyByPersonalityId(
  allowedPersonalities: Record<string, PersonalityVoiceConfig>,
  personalityId: string
): string | undefined {
  // First check if the personalityId itself is a key (old format or composite key)
  if (allowedPersonalities[personalityId]) {
    return personalityId;
  }
  // Search for matching personalityId in configs
  const entry = Object.entries(allowedPersonalities).find(
    ([_, config]) => config.personalityId === personalityId
  );
  return entry?.[0];
}

declare global {
  interface Window {
    __niaHandlePersonalityChange?: (config: PersonalityVoiceConfig) => void | Promise<void>;
    __niaPearlMenuState?: {
      allowedPersonalities: Record<string, PersonalityVoiceConfig>;
      currentPersonalityKey?: string;
    };
  }
}

const AssistantWrapper: React.FC<AssistantWrapperProps> = (props) => {
  // Extract props
  const { assistantName = '', clientLanguage = 'en', supportedFeatures = [], startFullScreen = false, personalityId, tenantId, persona, voiceId, voiceProvider, voiceParameters, allowedPersonalities = {}, modePersonalityVoiceConfig, dailyCallPersonalityVoiceConfig: _dailyCallPersonalityVoiceConfig, sessionOverride } = props;
  
  // Initialize personality state - check localStorage synchronously before first render
  const getInitialPersonalityKey = () => {
    // Check if PearlMultiMenu is enabled
    const isMultiMenuEnabled = isFeatureEnabled('pearlMultiMenu', supportedFeatures);

    // If feature is disabled, strictly fallback to props (return undefined key)
    if (!isMultiMenuEnabled) {
      return undefined;
    }

    // Only access localStorage on the client side
    if (typeof window === 'undefined') {
      // Server-side: use personalityId prop or first available
      if (personalityId) {
        return findKeyByPersonalityId(allowedPersonalities, personalityId);
      }
      return Object.keys(allowedPersonalities)[0];
    }
    
    try {
      const stored = localStorage.getItem(`nia-personality-${assistantName}`);
      if (stored) {
        const config = JSON.parse(stored);
        // Try to find by stored key first (might be composite key or UUID)
        if (config.key && allowedPersonalities[config.key]) {
          return config.key;
        }
        // Fallback: try to find by personalityId for migration
        if (config.personalityId) {
          const foundKey = findKeyByPersonalityId(allowedPersonalities, config.personalityId);
          if (foundKey) return foundKey;
        }
      }
    } catch (error) {
      logger.error('Failed to restore personality from localStorage', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Find initial key from props
    if (personalityId) {
      return findKeyByPersonalityId(allowedPersonalities, personalityId);
    }
    // Default to first available personality
    return Object.keys(allowedPersonalities)[0];
  };
  
  // State for current personality - now stores composite key
  const [currentPersonalityKey, setCurrentPersonalityKey] = useState<string | undefined>(getInitialPersonalityKey);
  
  // Gateway WebSocket is handled globally by GatewaySocketBridge in client-providers.tsx
  // No need for a second connection here.

  // Get current desktop mode to resolve mode-specific personality
  const { currentMode } = useDesktopMode();
  const { onboardingComplete, refresh: refreshMetadata } = useUserProfile();

  useEffect(() => {
    logger.info('AssistantCanvas mounted');
    return () => {
      logger.info('AssistantCanvas unmounted');
    };
  }, []);

  // Listen for onboarding toggle events from Settings
  useEffect(() => {
    const handleOnboardingUpdate = (e: Event) => {
      logger.info('Received NIA_EVENT_ONBOARDING_COMPLETE');
      refreshMetadata();
    };

    window.addEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingUpdate);
    return () => window.removeEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingUpdate);
  }, [refreshMetadata]);

  const { isBrowserWindowVisible } = useUI();
  const { data: session } = useResilientSession();
  
  const isOnboardingEnabled = isFeatureEnabled('onboarding');
  const effectiveIsOnboarding = isOnboardingEnabled ? !onboardingComplete : false;

  // Derive effective personality config from currentPersonalityKey OR currentMode
  const effectivePersonalityConfig = React.useMemo(() => {
    
    // -1. Check for session override first (preempts onboarding and current mode)
    if (sessionOverride?.mode && modePersonalityVoiceConfig?.[sessionOverride.mode]) {
      const config = modePersonalityVoiceConfig[sessionOverride.mode];
      const voice = config.voice || {};
      return {
        personalityId: config.personalityId,
        name: config.personaName || config.personalityName || config.name,
        voiceId: voice.voiceId || config.voiceId,
        voiceProvider: voice.provider || config.voiceProvider,
        voiceParameters: {
          stability: voice.stability,
          similarityBoost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
          optimizeStreamingLatency: voice.optimizeStreamingLatency,
          ...config.voiceParameters,
        },
      };
    }

    // 0. If onboarding is enabled and incomplete, use default personality (skip mode config)
    if (effectiveIsOnboarding) {
      // Return default config from props (or minimal config to force default)
      return {
        personalityId: personalityId,
        name: persona,
        voiceId: voiceId,
        voiceProvider: voiceProvider,
        voiceParameters: voiceParameters,
        isOnboarding: true,
      };
    }

    // 1. Check for mode-specific config first
    if (modePersonalityVoiceConfig && modePersonalityVoiceConfig[currentMode]) {
      const config = modePersonalityVoiceConfig[currentMode];
      // Handle new nested voice structure
      const voice = config.voice || {};
      return {
        personalityId: config.personalityId,
        name: config.personaName || config.personalityName || config.name,
        voiceId: voice.voiceId || config.voiceId,
        voiceProvider: voice.provider || config.voiceProvider,
        voiceParameters: {
          stability: voice.stability,
          similarityBoost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
          optimizeStreamingLatency: voice.optimizeStreamingLatency,
          ...config.voiceParameters, // Fallback to old flat params if any
        },
      };
    }

    // 2. Fallback to user-selected personality (if multi-menu enabled)
    if (currentPersonalityKey && allowedPersonalities[currentPersonalityKey]) {
      const config = allowedPersonalities[currentPersonalityKey];
      const voice = config.voice || {};
      return {
        personalityId: config.personalityId,
        name: config.personaName || config.personalityName || (config as any).name,
        voiceId: voice.voiceId || (config as any).voiceId,
        voiceProvider: voice.provider || (config as any).voiceProvider,
        voiceParameters: {
          stability: voice.stability,
          similarityBoost: voice.similarityBoost,
          style: voice.style,
          speed: voice.speed,
          optimizeStreamingLatency: voice.optimizeStreamingLatency,
          ...voice,
        },
      };
    }
    // 3. Fallback to original props (OS default)
    return {
      personalityId,
      name: persona || assistantName,
      voiceId,
      voiceProvider,
      voiceParameters,
    };
  }, [currentMode, modePersonalityVoiceConfig, currentPersonalityKey, allowedPersonalities, personalityId, voiceId, voiceProvider, voiceParameters, persona, assistantName, effectiveIsOnboarding, sessionOverride]);
  
  useEffect(() => {
    logger.info('Effective personality config changed', { 
      personalityId: effectivePersonalityConfig.personalityId,
      isOnboarding: effectivePersonalityConfig.isOnboarding 
    });
  }, [effectivePersonalityConfig]);

  // Audio element ref for playing bot audio in voice-only sessions
  const audioElementRef = React.useRef<HTMLAudioElement>(null);
  const [isLocalScreenSharing, setIsLocalScreenSharing] = useState(false);
  const [screenSharePromptVisible, setScreenSharePromptVisible] = useState(false);
  const [screenSharePromptDismissed, setScreenSharePromptDismissed] = useState(false);
  const [screenShareRequesting, setScreenShareRequesting] = useState(false);
  const [screenShareError, setScreenShareError] = useState<string | null>(null);
  const [screenShareAvailable, setScreenShareAvailable] = useState(true);
  const lastPersonalityHashRef = useRef<string | null>(null);
  const prevCallStatusRef = useRef<CALL_STATUS | null>(null);
  
  // Use voice session instead of VAPI (pass OS personality for voice-only sessions)
  const { toggleCall, callStatus, audioLevel, updatePersonality } = useVoiceSession({
    assistantName,
    clientLanguage,
    userId: session?.user?.id || 'anonymous',
    userName: (session?.user as any)?.name || undefined, // User's display name for Daily participant
    userEmail: session?.user?.email || undefined, // User's email for profile loading
    personalityId: effectivePersonalityConfig.personalityId, // Use selected personality
    tenantId,
    persona, // Bot display name from Assistant.persona_name
    voiceId: effectivePersonalityConfig.voiceId,
    voiceProvider: effectivePersonalityConfig.voiceProvider,
    voiceParameters: effectivePersonalityConfig.voiceParameters,
    supportedFeatures, // Pass feature flags to bot for tool filtering
    modePersonalityVoiceConfig, // Pass mode-specific config for hot-switching
    sessionOverride,
    config: effectivePersonalityConfig,
  });
  
  // Get Daily call object from context to monitor participants
  const { getCallObject } = useVoiceSessionContext();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    return () => setIsClient(false);
  }, []);
  
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      setScreenShareAvailable(isScreenShareSupported() && isSecureContext());
    } catch (error) {
      logger.error('Screen share capability check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      setScreenShareAvailable(false);
    }
  }, []);
  
  // Monitor Daily participants and attach bot audio tracks to audio element
  useEffect(() => {
    if (callStatus !== CALL_STATUS.ACTIVE) return;
    
    const callObject = getCallObject();
    if (!callObject || !audioElementRef.current) return;
    
    // Handler for participant updates - attach bot audio
    const handleParticipantUpdated = () => {
      const participants = getParticipantsSnapshot(callObject);
      if (!participants || !audioElementRef.current) return;
      
      // Find bot participant (non-local participant, usually named after persona)
      // We prioritize matching the persona name, but fallback to any non-local participant with audio
      // This ensures we still hear audio even if the bot name doesn't match the expected persona (e.g. "Wiz" vs "Pearl")
      const allParticipants = Object.values(participants);
      let botParticipant = allParticipants.find(
        (p: any) => !p.local && p.user_name?.toLowerCase().includes(persona?.toLowerCase() || 'pearl')
      );
      
      if (!botParticipant) {
        botParticipant = allParticipants.find((p: any) => !p.local && p.tracks?.audio?.track);
      }
      
      if (botParticipant && (botParticipant as any).tracks?.audio?.track) {
        const audioTrack = (botParticipant as any).tracks.audio.track;
        audioElementRef.current.srcObject = new MediaStream([audioTrack]);
        
        // Ensure playback (handle autoplay restrictions)
        audioElementRef.current.play().catch((err) => {
          logger.warn('Audio autoplay blocked, user interaction required', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    };
    
    // Listen for participant events
    callObject.on('participant-joined', handleParticipantUpdated);
    callObject.on('participant-updated', handleParticipantUpdated);
    callObject.on('track-started', handleParticipantUpdated);
    
    // Initial check in case bot already joined
    handleParticipantUpdated();
    
    return () => {
      callObject.off('participant-joined', handleParticipantUpdated);
      callObject.off('participant-updated', handleParticipantUpdated);
      callObject.off('track-started', handleParticipantUpdated);
    };
  }, [callStatus, getCallObject, persona]);

  useEffect(() => {
    if (callStatus !== CALL_STATUS.ACTIVE) {
      setIsLocalScreenSharing(false);
      setScreenSharePromptDismissed(false);
      setScreenSharePromptVisible(false);
      setScreenShareError(null);
      setScreenShareRequesting(false);
      return;
    }

    const callObject = getCallObject();
    if (!callObject) {
      return;
    }

    const updateScreenShareState = () => {
      const participants = getParticipantsSnapshot(callObject);
      const localParticipant = participants?.local;
      const screenTrack = localParticipant?.tracks?.screenVideo;
      const trackState = screenTrack?.state;
      const sharing = Boolean(screenTrack && trackState && trackState !== 'off' && trackState !== 'blocked');
      setIsLocalScreenSharing(sharing);
      if (sharing) {
        setScreenSharePromptVisible(false);
      }
    };

    updateScreenShareState();

    const listener = () => updateScreenShareState();
    const trackedEvents: Array<[string, () => void]> = [
      ['participant-updated', listener],
      ['track-started', listener],
      ['track-stopped', listener],
      ['left-meeting', () => {
        setIsLocalScreenSharing(false);
        setScreenSharePromptVisible(false);
        setScreenSharePromptDismissed(false);
      }],
    ];

    trackedEvents.forEach(([event, handler]) => {
      // @ts-expect-error - DailyCall event typing does not include every internal event we use
      callObject.on(event, handler);
    });

    return () => {
      trackedEvents.forEach(([event, handler]) => {
        // @ts-expect-error - DailyCall event typing does not include every internal event we use
        callObject.off(event, handler);
      });
    };
  }, [callStatus, getCallObject]);

  useEffect(() => {
    if (
      callStatus === CALL_STATUS.ACTIVE &&
      !isLocalScreenSharing &&
      !screenSharePromptDismissed &&
      screenShareAvailable &&
      isFeatureEnabled('screenSharePrompt', supportedFeatures)
    ) {
      setScreenSharePromptVisible(true);
    }
  }, [callStatus, isLocalScreenSharing, screenSharePromptDismissed, screenShareAvailable, supportedFeatures]);
  
  const { status, hasError } = useResilientSession();
  const handleStartScreenShare = useCallback(async () => {
    if (!screenShareAvailable) {
      setScreenShareError('Screen sharing is not supported on this browser or connection.');
      return;
    }

    try {
      const callObject = getCallObject();
      if (!callObject || typeof callObject.startScreenShare !== 'function') {
        throw new Error('Voice session is not ready to share the screen.');
      }
      setScreenShareRequesting(true);
      setScreenShareError(null);
      await callObject.startScreenShare();
      setScreenSharePromptVisible(false);
    } catch (error) {
      logger.error('Screen share failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      setScreenShareError(
        error instanceof Error ? error.message : 'Unable to start screen sharing. Please try again.'
      );
    } finally {
      setScreenShareRequesting(false);
    }
  }, [getCallObject, screenShareAvailable]);

  const handleSkipScreenSharePrompt = useCallback(() => {
    setScreenSharePromptDismissed(true);
    setScreenSharePromptVisible(false);
  }, []);

  const seatrade = assistantName === 'seatrade' || assistantName === 'paddytest' || assistantName === 'seatrade-jdx';

  // Handle personality change
  const handlePersonalityChange = useCallback(async (config: PersonalityVoiceConfig) => {
    if (sessionOverride?.locked) {
      logger.warn('Personality change blocked by locked session');
      return;
    }

    // Find the composite key for this config
    const compositeKey = Object.entries(allowedPersonalities).find(
      ([_, c]) => c === config || (
        c.personalityId === config.personalityId &&
        c.voice.provider === config.voice.provider &&
        c.voice.voiceId === config.voice.voiceId
      )
    )?.[0];
    
    if (compositeKey) {
      setCurrentPersonalityKey(compositeKey);
    }
    
    // Dispatch event for WindowControls and other components to listen
    window.dispatchEvent(new CustomEvent('personalityChanged', {
      detail: {
        personalityId: config.personalityId,
        name: config.personalityName,
        voiceId: config.voice.voiceId,
        voiceProvider: config.voice.provider,
        voiceParameters: config.voice,
        compositeKey, // Include the composite key for easier lookup
      }
    }));
    
    // Update voice session if active
    if (updatePersonality) {
      updatePersonality({
        personalityId: config.personalityId,
        name: config.personalityName,
        voiceId: config.voice.voiceId,
        voiceProvider: config.voice.provider,
        voiceParameters: config.voice,
      });
    }
    
    // Store selected personality in UserProfile for cross-device persistence
    // Falls back to localStorage if API fails or user not authenticated
    if (status === 'authenticated') {
      try {
        const response = await fetch('/api/userProfile/personality', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            personalityVoiceConfig: {
              personalityId: config.personalityId,
              name: config.personalityName,
              voiceId: config.voice.voiceId,
              voiceProvider: config.voice.provider,
              voiceParameters: config.voice,
              lastUpdated: new Date().toISOString()
            }
          })
        });

        if (!response.ok) {
          logger.warn('Failed to save personality to UserProfile, falling back to localStorage', {
            status: response.status,
          });
          throw new Error('UserProfile save failed');
        }
      } catch (error) {
        logger.error('Error saving personality to UserProfile', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Fallback to localStorage
        try {
          localStorage.setItem(`nia-personality-${assistantName}`, JSON.stringify({
            personalityId: config.personalityId,
            name: config.personalityName,
            voiceId: config.voice.voiceId,
            voiceProvider: config.voice.provider,
            voiceParameters: config.voice,
            timestamp: Date.now(),
          }));
        } catch (storageError) {
          logger.error('localStorage fallback also failed', {
            error: storageError instanceof Error ? storageError.message : String(storageError),
          });
        }
      }
    } else {
      // User not authenticated - use localStorage only
      try {
        localStorage.setItem(`nia-personality-${assistantName}`, JSON.stringify({
          personalityId: config.personalityId,
          name: config.personalityName,
          voiceId: config.voice.voiceId,
          voiceProvider: config.voice.provider,
          voiceParameters: config.voice,
          timestamp: Date.now(),
        }));
      } catch (storageError) {
        logger.error('Failed to save personality to localStorage', {
          error: storageError instanceof Error ? storageError.message : String(storageError),
        });
      }
    }
  }, [allowedPersonalities, assistantName, status, updatePersonality]);

  // Automatically update active session when effective personality changes (e.g. mode switch)
  useEffect(() => {
    // Determine effective mode to pass to bot
    let modeToPass: string = currentMode;
    if (sessionOverride?.mode) {
      modeToPass = sessionOverride.mode;
    } else if (effectiveIsOnboarding) {
      modeToPass = 'default';
    }

    const configHash = JSON.stringify({
      pid: effectivePersonalityConfig.personalityId,
      vid: effectivePersonalityConfig.voiceId,
      vp: effectivePersonalityConfig.voiceProvider,
      vparam: effectivePersonalityConfig.voiceParameters,
      mode: modeToPass,
    });

    // Skip dispatching on first activation of a session since the join payload already set personality/voice.
    const isNewlyActive = prevCallStatusRef.current !== CALL_STATUS.ACTIVE && callStatus === CALL_STATUS.ACTIVE;

    if (callStatus !== CALL_STATUS.ACTIVE) {
      if (prevCallStatusRef.current === CALL_STATUS.ACTIVE) {
        lastPersonalityHashRef.current = null;
      }
      prevCallStatusRef.current = callStatus;
      return;
    }

    prevCallStatusRef.current = callStatus;

    if (isNewlyActive) {
      lastPersonalityHashRef.current = configHash;
      return;
    }

    if (lastPersonalityHashRef.current === configHash) {
      return;
    }

    lastPersonalityHashRef.current = configHash;

    updatePersonality({
      personalityId: effectivePersonalityConfig.personalityId,
      name: effectivePersonalityConfig.name || '',
      voiceId: effectivePersonalityConfig.voiceId,
      voiceProvider: effectivePersonalityConfig.voiceProvider,
      voiceParameters: effectivePersonalityConfig.voiceParameters,
    }, modeToPass);
  }, [effectivePersonalityConfig, callStatus, updatePersonality, currentMode, effectiveIsOnboarding, sessionOverride]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.__niaHandlePersonalityChange = handlePersonalityChange;
    return () => {
      if (window.__niaHandlePersonalityChange === handlePersonalityChange) {
        window.__niaHandlePersonalityChange = undefined;
      }
    };
  }, [handlePersonalityChange]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const detail = {
      allowedPersonalities,
      currentPersonalityKey,
    };
    window.__niaPearlMenuState = detail;
    window.dispatchEvent(new CustomEvent('nia:pearl-menu:update', { detail }));
  }, [allowedPersonalities, currentPersonalityKey]);

  // Add this check for authentication
  useEffect(() => {
    if (hasError) {
      // Only redirect if there's an actual session error, not just no session
      logger.warn('Session error in AssistantWrapper, redirecting to signin');
      window.location.href = '/api/auth/signin';
    }
  }, [hasError]);

  // Note: Voice session health is now monitored through Daily.co connection state
  // No need for separate health polling - Daily handles reconnection automatically

  // If avatar feature is disabled for this assistant, do not render the Assistant button UI at all
  if (!isFeatureEnabled('avatar', supportedFeatures)) {
    return null;
  }

  // Handler: POST voice input text to bot gateway chat endpoint
  const handleVoiceInput = async ({ text, file: _file }: { text: string; file?: File }) => {
    if (!text.trim()) return;
    try {
      await fetch('http://localhost:4444/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, assistantName }),
      });
    } catch (err) {
      logger.warn('VoiceInputBox submit failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <>
      {/* Hidden audio element for playing bot audio in voice-only sessions */}
      <audio ref={audioElementRef} autoPlay playsInline style={{ display: 'none' }} />

      {/* Vacuum Tube Input — global overlay, opened via VoiceInputTrigger or custom event */}
      <VoiceInputBox onSubmit={handleVoiceInput} />
      
      <div
        className={`pointer-events-auto mt-auto fixed z-10 left-1/2 -translate-x-1/2 flex flex-col items-center justify-center ${!seatrade && 'p-3'} rounded-t-lg`}
        style={{
          transition: 'all 0.3s ease-in-out',
          bottom: seatrade ? (callStatus === CALL_STATUS.INACTIVE || callStatus === CALL_STATUS.UNAVAILABLE) && !isBrowserWindowVisible ? '50%' : 20 : 72,
          transform: seatrade && (callStatus === CALL_STATUS.INACTIVE || callStatus === CALL_STATUS.UNAVAILABLE) && !isBrowserWindowVisible ? 'translateY(50%) translateX(-50%)' : 'translateX(-50%)'
        }}
      >
        <AssistantButton
          assistantName={assistantName}
          audioLevel={audioLevel}
          callStatus={callStatus}
          toggleCall={toggleCall}
          supportedFeatures={supportedFeatures}
          startFullScreen={startFullScreen}
          allowedPersonalities={allowedPersonalities}
          currentPersonalityKey={currentPersonalityKey}
          onPersonalityChange={handlePersonalityChange}
        ></AssistantButton>
      </div>
      {assistantName === 'seatrade-jdx' && (callStatus === CALL_STATUS.INACTIVE || callStatus === CALL_STATUS.UNAVAILABLE) &&
        <footer className='pointer-events-auto w-full py-[16px] bottom-0 absolute'>
          <div className='flex items-end justify-center'>
            <p className='text-center uppercase text-[color:--scg-sunset]' style={{ fontWeight: 'bold' }}>
              Powered by
            </p>
            <img className='w-[128px] ml-2' src='/images/NiaLogo.png' alt='Nia Concierge AI' />
          </div>
        </footer>
      }

      {isClient && screenSharePromptVisible
        ? createPortal(
            <div className="fixed inset-0 z-[650] flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={handleSkipScreenSharePrompt}
                style={{ pointerEvents: screenShareRequesting ? 'none' : 'auto' }}
              />
              <Card className="relative z-[700] w-full max-w-lg border-gray-700 bg-gray-900 text-white shadow-2xl">
                <CardHeader className="space-y-2">
                  <CardTitle className="text-2xl font-normal" style={{ fontFamily: 'Gohufont, monospace' }}>
                    Help us capture your screen
                  </CardTitle>
                  <p className="text-sm text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>
                    Thanks for being part of the early access crew—sharing your screen helps us understand the real
                    workflow so we can keep polishing the experience.
                  </p>
                </CardHeader>
                <CardContent className="space-y-4" style={{ fontFamily: 'Gohufont, monospace' }}>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-gray-300">
                    <li>You’ll pick a window or monitor in the browser dialog.</li>
                    <li>The recording may be used in demos or highlight reels as we refine the product.</li>
                  </ul>

                  {screenShareError && (
                    <div className="rounded-md border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-200">
                      {screenShareError}
                    </div>
                  )}

                  {!screenShareAvailable && (
                    <div className="rounded-md border border-yellow-700 bg-yellow-900/30 px-3 py-2 text-sm text-yellow-200">
                      Screen sharing isn’t supported in this browser or context. Try Chrome on desktop for the best
                      experience.
                    </div>
                  )}

                  <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={handleSkipScreenSharePrompt}
                      disabled={screenShareRequesting}
                      className="text-gray-300 hover:text-white"
                    >
                      Not now
                    </Button>
                    <Button
                      type="button"
                      onClick={handleStartScreenShare}
                      disabled={screenShareRequesting || !screenShareAvailable}
                      className="bg-emerald-500 text-black hover:bg-emerald-400"
                    >
                      {screenShareRequesting ? 'Requesting…' : 'Share screen'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>,
            document.body
          )
        : null}
    </>
  );
};

export default AssistantWrapper;
