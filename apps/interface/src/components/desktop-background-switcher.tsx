'use client';

import { isFeatureEnabled } from '@nia/features';
import type { ModePersonalityVoiceConfig } from '@nia/prism';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorBoundary } from '@interface/components/ErrorBoundary';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { useUserProfile } from '@interface/contexts/user-profile-context';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { NIA_EVENT_ONBOARDING_COMPLETE, NIA_EVENT_SPRITE_OPEN } from '@interface/features/DailyCall/events/niaEventRouter';
import { updateBotConfig } from '@interface/features/DailyCall/lib/botClient';
import { getClientLogger } from '@interface/lib/client-logger';

import { DesktopMode, DesktopModeSwitchResponse } from '../types/desktop-modes';

import DesktopBackground from './desktop-background'; //Home Background
import DesktopBackgroundCreative from './desktop-background-creative'; //Creative Background
import DesktopBackgroundWork from './desktop-background-work'; //Work Background
import { MODE_SELECTOR_UNLOCK_EVENT } from './desktop-mode-selector-events';
import DesktopTaskbar from './desktop-taskbar';
import FloatingHomeButton from './floating-home-button';
import QuietVBackground from './quiet-vbackground'; //Quiet Background
import SummonSpritePrompt from '@interface/components/summon-sprite/SummonSpritePrompt';

type Provider = 'openai' | 'anthropic' | 'gemini';

interface DesktopBackgroundSwitcherProps {
  providers?: Record<Provider, string[]>;
  selectedModelInfo?: { provider: Provider; model: string } | null;
  onModelChange?: (provider: Provider, model: string) => void;
  supportedFeatures: string[]; // List of supported feature keys
  // Optional initial mode to use on first render; falls back to HOME
  // initialMode prop is deprecated in favor of DesktopModeContext
  initialMode?: DesktopMode;
  modePersonalityVoiceConfig?: ModePersonalityVoiceConfig;
  assistantName?: string;
  tenantId?: string;
  isAdmin?: boolean;
  initialResourceId?: string;
  initialResourceType?: string;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

const DesktopBackgroundSwitcher = ({
  providers,
  selectedModelInfo,
  onModelChange = () => {}, // Default no-op function
  supportedFeatures,
  initialMode,
  modePersonalityVoiceConfig,
  assistantName,
  tenantId,
  isAdmin,
  initialResourceId,
  initialResourceType,
}: DesktopBackgroundSwitcherProps) => {
  const logger = getClientLogger('[desktop_background_switcher]');
  const DEBUG = process.env.NEXT_PUBLIC_DEBUG_DESKTOP_MODE === 'true';
  const { data: session } = useSession();
  const { roomUrl, callStatus, activeSpriteVoice, activeSpriteId } = useVoiceSessionContext() || {};
  const { currentMode, setMode: setCurrentMode } = useDesktopMode();
  const { onboardingComplete, refresh, userProfileId } = useUserProfile();
  const autoOpenTriggered = useRef(false);

  // Handle auto-opening of shared sprites
  useEffect(() => {
    if (initialResourceId && initialResourceType === 'Sprite' && !autoOpenTriggered.current) {
      autoOpenTriggered.current = true;
      
      // Force switch to Quiet mode where sprites live
      if (currentMode !== DesktopMode.QUIET) {
        setCurrentMode(DesktopMode.QUIET);
      }

      const timer = setTimeout(() => {
        const event = new CustomEvent(NIA_EVENT_SPRITE_OPEN, { 
          detail: { 
            payload: {
              spriteId: initialResourceId
            },
            autoOpen: true 
          } 
        });
        window.dispatchEvent(event);
      }, 1000); // 1s delay to ensure Listeners are mounted
      return () => clearTimeout(timer);
    }
  }, [initialResourceId, initialResourceType, currentMode, setCurrentMode]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolvedSessionId = (session as any)?.sessionId ?? (session?.user as any)?.sessionId;
  const resolvedUserId = session?.user?.id;
  const resolvedUserEmail = session?.user?.email ?? undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resolvedUserName = (session?.user as any)?.name ?? undefined;

  const normalizeMode = useCallback((m: DesktopMode | string | undefined | null): DesktopMode => {
    const v = (m ?? DesktopMode.HOME).toString().toLowerCase();
    return (Object.values(DesktopMode) as string[]).includes(v)
      ? (v as DesktopMode)
      : DesktopMode.HOME;
  }, []);
  
  // Local state for UI transitions only
  const [isModeSelectorUnlocked, setIsModeSelectorUnlocked] = useState(false);
  const [isCreativePreparing, setIsCreativePreparing] = useState(false);
  const creativeLaunchRequestedRef = useRef(false);
  const wasCreativeActiveRef = useRef(false);
  
  // Track previous mode to detect actual mode switches vs other dependency changes
  const prevModeRef = useRef<DesktopMode | null>(null);

  // Legacy support for the existing taskbar
  const isWorkMode = currentMode === DesktopMode.WORK;

  const handleModeChange = useCallback((isWork: boolean) => {
    const next = isWork ? DesktopMode.WORK : DesktopMode.HOME;
    if (DEBUG) {
      logger.debug('handleModeChange', { next });
    }
    setCurrentMode(next);
  }, [DEBUG]);

  const handleVoiceModeSwitch = useCallback((mode: DesktopMode | string) => {
    const next = normalizeMode(mode);
    if (DEBUG) {
      logger.debug('handleVoiceModeSwitch', { next });
    }
    setCurrentMode(next);
  }, [DEBUG, normalizeMode]);

  useEffect(() => {
    const handleOnboardingComplete = async () => {
      if (!userProfileId) return;
      try {
        // Onboarding status is now updated by the bot tool directly in the DB.
        // We just need to refresh our local SWR cache to reflect the change.
        if (DEBUG) {
          logger.debug('Onboarding complete event received, refreshing profile');
        }
        await refresh();
      } catch (e) {
        logger.error('Failed to refresh profile after onboarding complete', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    window.addEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingComplete);
    return () => {
      window.removeEventListener(NIA_EVENT_ONBOARDING_COMPLETE, handleOnboardingComplete);
    };
  }, [userProfileId, refresh, DEBUG]);

  // Listen for mode selector unlock events
  useEffect(() => {
    const handleUnlock = () => setIsModeSelectorUnlocked(true);
    window.addEventListener(MODE_SELECTOR_UNLOCK_EVENT, handleUnlock);
    return () => window.removeEventListener(MODE_SELECTOR_UNLOCK_EVENT, handleUnlock);
  }, []);

  // Update bot config ONLY when mode actually changes (not on other dependency changes)
  // This prevents overwriting sprite config when roomUrl/callStatus change triggers the effect
  useEffect(() => {
    // Track mode changes - always update the ref, but only proceed if mode actually changed
    const prevMode = prevModeRef.current;
    prevModeRef.current = currentMode;
    
    // CRITICAL: Only send config when mode ACTUALLY changed
    // Other dependency changes (roomUrl, callStatus, etc.) should not trigger config updates
    // Initial config is handled by room creation; this effect is for MODE SWITCHES only
    if (prevMode === null || prevMode === currentMode) {
      if (DEBUG && roomUrl && callStatus === 'active') {
        logger.debug('Skipping bot config update: mode not changed', { prevMode, currentMode });
      }
      return;
    }
    
    if (!roomUrl || callStatus !== 'active' || !modePersonalityVoiceConfig) return;

    // CRITICAL: Skip mode config updates when sprite voice is active
    // The sprite has its own personality/voice config that should not be overridden
    // Check BOTH activeSpriteVoice and activeSpriteId to handle React state batching race
    if (activeSpriteVoice || activeSpriteId) {
      if (DEBUG) {
        logger.debug('Sprite voice active: skipping bot config update', { activeSpriteVoice, activeSpriteId });
      }
      return;
    }

    const isOnboardingEnabled = isFeatureEnabled('onboarding');
    
    // If onboarding is enabled and not complete, do NOT update bot config.
    // We want to keep the default personality established at join time.
    if (isOnboardingEnabled && !onboardingComplete) {
      if (DEBUG) {
        logger.debug('Onboarding active: skipping bot config update');
      }
      return;
    }

    const effectiveMode = currentMode;
    const modeConfig = modePersonalityVoiceConfig[effectiveMode];
    
    if (modeConfig) {
      if (DEBUG) {
        logger.debug('Updating bot config for mode', { effectiveMode, modeConfig });
      }
      updateBotConfig(roomUrl, {
        personalityId: modeConfig.personalityId,
        voice: modeConfig.voice,
          mode: effectiveMode
        }, {
          sessionId: resolvedSessionId,
          sessionUserId: resolvedUserId,
          sessionUserEmail: resolvedUserEmail,
          sessionUserName: resolvedUserName,
      }).catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        const isTimeout = /timed out|abort/i.test(message);
        if (isTimeout) {
          logger.warn('Failed to update bot config (timeout)', { error: message });
          return;
        }
        logger.error('Failed to update bot config', { error: message });
      });
    }
  }, [currentMode, roomUrl, callStatus, activeSpriteVoice, activeSpriteId, modePersonalityVoiceConfig, onboardingComplete, DEBUG, resolvedSessionId, resolvedUserId, resolvedUserEmail, resolvedUserName]);

  // Listen for mode switch events from the bot
  useEffect(() => {
    const handleFunctionCall = (event: MessageEvent) => {
      try {
        const data = event.data;

        // Check if this is a desktop mode switch response
        if (data?.action === 'SWITCH_DESKTOP_MODE' && data?.payload?.targetMode) {
          const response = data as DesktopModeSwitchResponse;
          const targetMode = response.payload.targetMode as DesktopMode;

          // Validate the mode is supported
          if (DEBUG) {
            logger.debug('Message event received', { response });
          }
          handleVoiceModeSwitch(targetMode);
        }
      } catch (error) {
        logger.error('Error handling function call', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Listen for messages from the assistant
    window.addEventListener('message', handleFunctionCall);

    // Also listen for custom events (alternative communication method)
    const handleCustomEvent = (event: CustomEvent<DesktopModeSwitchResponse>) => {
      if (event.detail?.action === 'SWITCH_DESKTOP_MODE') {
        const targetMode = event.detail.payload.targetMode as DesktopMode;
        if (DEBUG) {
          logger.debug('Custom event received', { detail: event.detail });
        }
        handleVoiceModeSwitch(targetMode);
      }
    };

    window.addEventListener('desktopModeSwitch', handleCustomEvent as EventListener);

    return () => {
      window.removeEventListener('message', handleFunctionCall);
      window.removeEventListener('desktopModeSwitch', handleCustomEvent as EventListener);
    };
  }, [DEBUG, handleVoiceModeSwitch]);

  // If initialMode prop changes, seed the current mode once or when the prop actually changes.
  // Do NOT tie this effect to currentMode; we want event-driven changes to take precedence after mount.
  useEffect(() => {
    if (initialMode) {
      const next = normalizeMode(initialMode);
      if (DEBUG) {
        logger.debug('Seed from initialMode', { next });
      }
      setCurrentMode(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMode, normalizeMode, DEBUG]);

  useEffect(() => {
    ensureGohufont();
  }, []);

  // Helper functions to calculate transform classes for direct transitions
  // Layout: QUIET (left) - HOME (center) - WORK (right) horizontally
  //         CREATE (top) - HOME (center) vertically
  // Use translate-x-[200%] to move elements completely off-screen during direct transitions
  const getQuietTransform = useCallback((mode: DesktopMode): string => {
    if (mode === DesktopMode.QUIET) return 'translate-x-0 translate-y-0';
    
    // When other modes are active, position QUIET relative to them
    if (mode === DesktopMode.HOME || mode === DesktopMode.DEFAULT) {
      // HOME -> QUIET: QUIET is to the left of HOME
      return '-translate-x-full translate-y-0';
    }
    if (mode === DesktopMode.WORK) {
      // WORK -> QUIET: QUIET is to the left of WORK (direct right transition)
      return '-translate-x-full translate-y-0';
    }
    if (mode === DesktopMode.CREATIVE) {
      // CREATE -> QUIET: QUIET is above CREATE (CREATE slides down, QUIET slides up from above)
      return 'translate-x-0 -translate-y-full';
    }
    
    // Default: off-screen to the left
    return '-translate-x-full translate-y-0';
  }, []);

  const getHomeTransform = useCallback((mode: DesktopMode): string => {
    if (mode === DesktopMode.HOME || mode === DesktopMode.DEFAULT) return 'translate-x-0 translate-y-0';
    
    // Direct transitions: HOME should be positioned relative to active mode
    // When not part of a direct transition, position HOME completely off-screen
    if (mode === DesktopMode.QUIET) {
      // QUIET -> HOME: HOME is to the right of QUIET (move to left transition)
      // But during QUIET -> WORK direct transition, HOME should be completely off-screen
      // Position HOME far off-screen to the right to avoid showing during QUIET -> WORK
      return 'translate-x-[200%] translate-y-0';
    }
    if (mode === DesktopMode.WORK) {
      // WORK -> HOME: HOME is to the left of WORK (move to right transition)
      // But during WORK -> QUIET direct transition, HOME should be completely off-screen
      // Position HOME far off-screen to the left to avoid showing during WORK -> QUIET
      return '-translate-x-[200%] translate-y-0';
    }
    if (mode === DesktopMode.CREATIVE) {
      // CREATE -> HOME: HOME is above CREATE (CREATE slides down, HOME slides up from above)
      return 'translate-x-0 -translate-y-full';
    }
    
    // Default: off-screen to the left
    return '-translate-x-[200%] translate-y-0';
  }, []);

  const getWorkTransform = useCallback((mode: DesktopMode): string => {
    if (mode === DesktopMode.WORK) return 'translate-x-0 translate-y-0';
    
    // Direct transitions: WORK should be positioned relative to active mode
    if (mode === DesktopMode.QUIET) {
      // QUIET -> WORK: WORK is to the right of QUIET (direct left transition, no HOME in between)
      // Position WORK at translate-x-full so it's beside QUIET for smooth transition
      // However, this causes WORK to be visible during QUIET -> CREATE transition
      // To fix: position WORK far off-screen, and it will slide in from further away during QUIET -> WORK
      // The faster transition (400ms) makes this acceptable
      return 'translate-x-[200%] translate-y-0';
    }
    if (mode === DesktopMode.HOME || mode === DesktopMode.DEFAULT) {
      // HOME -> WORK: WORK is to the right of HOME
      return 'translate-x-full translate-y-0';
    }
    if (mode === DesktopMode.CREATIVE) {
      // CREATE -> WORK: WORK is above CREATE (CREATE slides down, WORK slides up from above)
      return 'translate-x-0 -translate-y-full';
    }
    
    // Default: off-screen to the right, far off-screen to avoid showing during other transitions
    return 'translate-x-[200%] translate-y-0';
  }, []);

  const getCreativeTransform = useCallback((mode: DesktopMode): string => {
    if (mode === DesktopMode.CREATIVE) return 'translate-x-0 translate-y-0';
    
    // CREATE slides up from the bottom when transitioning to other modes
    // When inactive, position CREATE below the screen (off-screen at bottom)
    return 'translate-x-0 translate-y-full';
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden bg-black" data-desktop-mode={currentMode}>
      {/* Background Container with Slide Transition */}
      <div className="relative h-full w-full bg-black">
        {/* Quiet Background */}
        <div
          data-testid="quiet-bg-container"
          className={`absolute inset-0 transition-transform duration-[400ms] ease-in-out ${getQuietTransform(currentMode)}`}
        >
          <ErrorBoundary>
            <QuietVBackground />
          </ErrorBoundary>
          {currentMode === DesktopMode.QUIET && isFeatureEnabled('summonSpriteTool', supportedFeatures) && (
            <div className="pointer-events-auto absolute inset-0 flex items-end justify-end p-6">
              <SummonSpritePrompt tenantId={tenantId} supportedFeatures={supportedFeatures} />
            </div>
          )}
        </div>

        {/* Home Background */}
        <div
          data-testid="home-bg-container"
          className={`absolute inset-0 transition-transform duration-[400ms] ease-in-out ${getHomeTransform(currentMode)}`}
        >
          <ErrorBoundary>
            <DesktopBackground showModeSelector={isModeSelectorUnlocked} />
          </ErrorBoundary>
        </div>

        {/* Work Background */}
        <div
          data-testid="work-bg-container"
          className={`absolute inset-0 transition-transform duration-[400ms] ease-in-out ${getWorkTransform(currentMode)}`}
        >
          <ErrorBoundary>
            <DesktopBackgroundWork
              supportedFeatures={supportedFeatures}
              assistantName={assistantName}
              tenantId={tenantId}
              isAdmin={isAdmin}
            />
          </ErrorBoundary>
        </div>

        {/* Creative Background */}
        <div
          data-testid="creative-bg-container"
          className={`absolute inset-0 transition-transform duration-[400ms] ease-in-out ${getCreativeTransform(currentMode)}`}
        >
          <ErrorBoundary>
            <DesktopBackgroundCreative assistantName={assistantName} />
          </ErrorBoundary>

          {isCreativePreparing && currentMode === DesktopMode.CREATIVE && (
            <div className="pointer-events-auto absolute inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-slate-950/60 transition-opacity duration-300">
              <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-white/30">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              </div>
              <div
                className="rounded-2xl bg-white/95 px-8 py-6 text-center shadow-2xl"
                style={{ fontFamily: 'Gohufont, monospace' }}
              >
                <p className="text-lg font-semibold uppercase tracking-[0.3em] text-slate-800">
                  Preparing your environment
                </p>
                <p className="mt-2 text-sm text-slate-600">Getting ready for the experience…</p>
              </div>
            </div>
          )}
        </div>

        {/* Future modes can be added here */}
        {/* Gaming Mode - Coming Soon */}
        {currentMode === DesktopMode.GAMING && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900 via-blue-900 to-green-900">
            <div className="text-center text-white">
              <h2 className="mb-4 text-4xl font-bold">🎮 Gaming Mode</h2>
              <p className="text-xl opacity-75">Gaming environment coming soon...</p>
            </div>
          </div>
        )}

        {/* Focus Mode - Coming Soon */}
        {currentMode === DesktopMode.FOCUS && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-900 via-slate-900 to-zinc-900">
            <div className="text-center text-white">
              <h2 className="mb-4 text-4xl font-bold">🎯 Focus Mode</h2>
              <p className="text-xl opacity-75">Focus environment coming soon...</p>
            </div>
          </div>
        )}

        {/* Relaxation Mode - Coming Soon */}
        {currentMode === DesktopMode.RELAXATION && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cyan-900 via-teal-900 to-blue-900">
            <div className="text-center text-white">
              <h2 className="mb-4 text-4xl font-bold">🧘 Relaxation Mode</h2>
              <p className="text-xl opacity-75">Relaxation environment coming soon...</p>
            </div>
          </div>
        )}
      </div>

      {/* Floating Home Button — always accessible on touch/mobile for canvas escape */}
      <FloatingHomeButton />

      {/* Desktop Taskbar */}
      <ErrorBoundary>
        <DesktopTaskbar
          isWorkMode={isWorkMode}
          onModeChange={handleModeChange}
          providers={providers}
          selectedModelInfo={selectedModelInfo}
          onModelChange={onModelChange}
          supportedFeatures={supportedFeatures}
        />
      </ErrorBoundary>
    </div>
  );
};

export default DesktopBackgroundSwitcher;
