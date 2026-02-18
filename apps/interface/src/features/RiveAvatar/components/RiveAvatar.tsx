/* eslint-disable */
"use client";

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { isFeatureEnabled } from '@nia/features';
import type { PersonalityVoiceConfig } from '@nia/prism/core/blocks/assistant.block';
import { useSession } from 'next-auth/react';

import { useBotParticipant, useBotSpeakingDetection } from '@interface/lib/daily';
import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { useUI } from '@interface/contexts/ui-context';
import { useIsMobile } from '@interface/hooks/use-is-mobile';
import { getClientLogger } from '@interface/lib/client-logger';

import { RiveAvatarProps } from '../types/rive-avatar-types';
import PearlMultiMenu, { PearlMultiMenuRef } from '@interface/features/PearlMultiMenu/components/PearlMultiMenu';
import { NIA_EVENT_WONDER_SCENE, NIA_EVENT_WONDER_CLEAR } from '@interface/features/DailyCall/events/niaEventRouter';

// GIF paths - Pearl avatar GIFs
const AVATAR_IDLE_GIFS = [
  '/images/avatar/pearlIdle1.gif',
  '/images/avatar/Pearlidle2.gif'
];
const AVATAR_TALKING_GIF = '/images/avatar/avatar-talking.gif';
const AVATAR_WAKEUP_GIF = '/images/avatar/StarupPearl.gif';
const AVATAR_SLEEP_GIF = '/images/avatar/PearlShutdown.gif';

const riveAvatarLogger = getClientLogger('RiveAvatar');

// Mobile positioning configuration - Position in bottom-left corner of viewport
// Pearl should be anchored to the bottom-left corner, not center-left
const MOBILE_POSITION = {
  // Avatar scale on mobile (0.3 = 75px rendered size from 250px base, same as initial button size)
  scale: 0.3, // rive size
  
  // Position from edges (in pixels)
  // Bottom-left corner positioning for proper avatar placement
  leftOffset: 10, // Distance from left edge
  bottomOffset: 30, // Distance from bottom edge (30px gap from bottom = bottom-left corner)
  
  // Notes window open: avatar stays in same position (bottom-left)
  notesOpenLeftOffset: 10, // Keep avatar near left edge when notes open
  notesOpenBottomOffset: 30, // Stay at bottom even when notes open
};

declare global {
  interface Window {
    __niaHandlePersonalityChange?: (config: PersonalityVoiceConfig) => void | Promise<void>;
    __niaPearlMenuState?: {
      allowedPersonalities: Record<string, PersonalityVoiceConfig>;
      currentPersonalityKey?: string;
    };
  }
}

function debug_log(msg: string, ...args: unknown[]) {
  const meta = args.length ? { args } : undefined;
  riveAvatarLogger.debug(`[RiveAvatar] ${msg}`, meta);
}

/**
 * Calculate avatar position for mobile based on N logo location
 * The N logo is part of the background image in the bottom-left corner
 * Returns position in pixels from top-left origin
 */
/**
 * Get the visible viewport height, preferring visualViewport API for iOS Safari
 * where window.innerHeight can be unreliable due to the dynamic address bar.
 */
function getVisibleViewportHeight(): number {
  if (typeof window !== 'undefined' && window.visualViewport) {
    return window.visualViewport.height;
  }
  return window.innerHeight;
}

function getMobileAvatarPosition(isNotesOpen: boolean): { x: number; y: number } {
  const avatarRenderedSize = 250 * MOBILE_POSITION.scale; // 75px
  const viewportHeight = getVisibleViewportHeight();
  
  if (isNotesOpen) {
    // When notes open, keep avatar in bottom-left (same as closed state)
    return {
      x: MOBILE_POSITION.notesOpenLeftOffset,
      y: viewportHeight - MOBILE_POSITION.notesOpenBottomOffset - avatarRenderedSize,
    };
  } else {
    // Notes closed: position near N logo in bottom-left corner
    // Use visualViewport for accurate height on iOS Safari
    return {
      x: MOBILE_POSITION.leftOffset,
      y: viewportHeight - MOBILE_POSITION.bottomOffset - avatarRenderedSize,
    };
  }
}

const RiveAvatar: React.FC<RiveAvatarProps> = ({ className = '', supportedFeatures }) => {
  // Get UI states from contexts
  const { 
    isBrowserWindowVisible, 
    isAvatarVisible, 
    triggerAvatarHide, 
    bellButtonRect,
    isNotesWindowOpen,
    isFullscreen,
    setIsFullscreen,
    isDailyCallActive,
    isChatMode
  } = useUI();
  
  // Get callStatus and toggleCall from shared context (instead of creating separate session)
  // Also get activeSpriteVoice to suppress Pearl speaking when Sprite is active
  // Get currentPersonaName for bot participant detection
  // Get disableSpriteVoice to hot-switch back to OS personality when avatar clicked during sprite session
  // Get spriteStartedSession to know if sprite initiated the session (affects end behavior)
  const { callStatus, toggleCall, getCallObject, activeSpriteVoice, disableSpriteVoice, spriteStartedSession, setSpriteStartedSession, currentPersonaName } = useVoiceSessionContext();
  
  // Track session for logout detection
  const { data: session } = useSession();
  const prevSessionRef = useRef(session);

  // Bot participant discovery using shared hook
  const callObject = useMemo(() => {
    return callStatus === 'active' ? getCallObject() : null;
  }, [callStatus, getCallObject]);
  
  // Pass expected persona name to improve bot detection accuracy
  const { botParticipantId } = useBotParticipant(callObject, {
    expectedPersonaName: currentPersonaName || undefined,
  });

  // Bot speaking detection using shared hook with callObject for manual monitoring
  const { isSpeaking: isAssistantSpeaking } = useBotSpeakingDetection(botParticipantId || '', {
    threshold: 0.012,
    debounceMs: 500,
    callObject: callObject, // Pass callObject for voice-only monitoring
  });

  const [hasStarted, setHasStarted] = useState(false);
  const [hasCompletedStartAnimation, setHasCompletedStartAnimation] = useState(false);
  const [isFloating, setIsFloating] = useState(false);
  const [currentIdleGifIndex, setCurrentIdleGifIndex] = useState(0);
  const [isShowingWakeup, setIsShowingWakeup] = useState(false);
  const [isShowingSleep, setIsShowingSleep] = useState(false);
  
  // Use mobile detection hook (screen width + touch capability)
  const isMobile = useIsMobile();

  // Track Wonder Canvas active state — hide sprite when Wonder Canvas is displaying content
  const [wonderCanvasActive, setWonderCanvasActive] = useState(false);

  // Listen for Wonder Canvas scene/clear events to hide/show sprite
  useEffect(() => {
    const handleWonderScene = () => setWonderCanvasActive(true);
    const handleWonderClear = () => setWonderCanvasActive(false);
    window.addEventListener(NIA_EVENT_WONDER_SCENE, handleWonderScene);
    window.addEventListener(NIA_EVENT_WONDER_CLEAR, handleWonderClear);
    return () => {
      window.removeEventListener(NIA_EVENT_WONDER_SCENE, handleWonderScene);
      window.removeEventListener(NIA_EVENT_WONDER_CLEAR, handleWonderClear);
    };
  }, []);

  const bubble_float = () => {
    setIsFloating(true);
    // Add bubble-float animation class
    const avatarElement = document.querySelector('.rive-avatar');
    if (avatarElement) {
      avatarElement.classList.add('animate-bubble-float');
    }
  };

  // Determine which GIF to show based on state priority: sleep > wakeup > speaking > idle
  // When activeSpriteVoice is true, suppress Pearl's talking animation (Sprite is speaking instead)
  const effectiveSpeaking = isAssistantSpeaking && !activeSpriteVoice;
  const currentGifSrc = isShowingSleep
    ? AVATAR_SLEEP_GIF
    : isShowingWakeup
    ? AVATAR_WAKEUP_GIF
    : effectiveSpeaking 
    ? AVATAR_TALKING_GIF 
    : AVATAR_IDLE_GIFS[currentIdleGifIndex];

  // Cycle through idle GIFs when not speaking (change every 3-5 seconds)
  // Use effectiveSpeaking which accounts for Sprite voice being active
  React.useEffect(() => {
    if (!effectiveSpeaking && isAvatarVisible) {
      const cycleInterval = setInterval(() => {
        setCurrentIdleGifIndex(prev => {
          // Randomly pick next idle GIF (could be same or different)
          return Math.floor(Math.random() * AVATAR_IDLE_GIFS.length);
        });
      }, 3000 + Math.random() * 2000); // Random interval between 3-5 seconds

      return () => clearInterval(cycleInterval);
    } else if (effectiveSpeaking) {
      // When starting to speak, randomly select a new idle GIF for next idle cycle
      setCurrentIdleGifIndex(Math.floor(Math.random() * AVATAR_IDLE_GIFS.length));
    }
  }, [effectiveSpeaking, isAvatarVisible]);

  // Animation transition states
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [avatarPosition, setAvatarPosition] = useState({ x: 0, y: 0 });
  const [avatarScale, setAvatarScale] = useState(1);
  const [isAnimationOverlapping, setIsAnimationOverlapping] = useState(false);
  const [hasEntered, setHasEntered] = useState(false);
  const [isMenuRevealed, setIsMenuRevealed] = useState(false);

  // Track previous call status to detect session start/restart
  const prevCallStatusRef = useRef<string | null>(null);
  // One-shot guards to avoid double-running animations/effects
  const entryTransitionStartedRef = useRef(false);
  const stageZeroStartedRef = useRef(false);
  const returnAnimationStartedRef = useRef(false);
  // Timeout refs for cleanup to avoid duplicate timers
  const startToStage1TimeoutRef = useRef<number | null>(null);
  const returnOverlapTimeoutRef = useRef<number | null>(null);
  const returnHideTimeoutRef = useRef<number | null>(null);
  const pearlMultiMenuRef = useRef<PearlMultiMenuRef>(null);
  const menuHideTimeoutRef = useRef<number | null>(null);
  const isMultiMenuEnabled = isFeatureEnabled('pearlMultiMenu', supportedFeatures);
  const [allowedPersonalities, setAllowedPersonalities] = useState<Record<string, PersonalityVoiceConfig>>({});
  const [currentPersonalityKey, setCurrentPersonalityKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyState = (detail: { allowedPersonalities: Record<string, PersonalityVoiceConfig>; currentPersonalityKey?: string }) => {
      if (detail.allowedPersonalities) {
        setAllowedPersonalities(detail.allowedPersonalities);
      }
      setCurrentPersonalityKey(detail.currentPersonalityKey);
    };

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ allowedPersonalities: Record<string, PersonalityVoiceConfig>; currentPersonalityKey?: string }>).detail;
      if (detail) {
        applyState(detail);
      }
    };

    if (window.__niaPearlMenuState) {
      applyState(window.__niaPearlMenuState);
    }

    window.addEventListener('nia:pearl-menu:update', handler as EventListener);
    return () => {
      window.removeEventListener('nia:pearl-menu:update', handler as EventListener);
    };
  }, []);

  // When a session starts or restarts, initialize the avatar position at the bell button
  // eslint-disable-next-line complexity
  useEffect(() => {
    const prev = prevCallStatusRef.current;
    const startingNow =
      (prev === null || prev === 'inactive' || prev === 'unavailable') &&
      (callStatus === 'loading' || callStatus === 'active');

    if (startingNow && bellButtonRect) {
      const canSeed = !isAvatarVisible && !isTransitioning && !hasEntered;
      if (!canSeed) {
        debug_log('[EntryInit] Skipping seed; already visible or mid-entry.', {
          isAvatarVisible,
          isTransitioning,
          hasEntered,
          prev,
          now: callStatus
        });
      } else {
        debug_log('[EntryInit] Session starting; seeding position at bell. prev:', prev, 'now:', callStatus);
        // Initialize position at the bell button center with initial small scale
        const buttonCenterX = bellButtonRect.left + bellButtonRect.width / 2;
        const buttonCenterY = bellButtonRect.top + bellButtonRect.height / 2;

        // Adjust scale for mobile - with transformOrigin '0 0', visual top-left = translate pos
        const initialScale = isMobile ? 0.3 : 0.48;
        const renderedSize = 250 * initialScale;
        const seedX = buttonCenterX - renderedSize / 2;
        const seedY = buttonCenterY - renderedSize / 2;
        setAvatarPosition({ x: seedX, y: seedY });
        setAvatarScale(initialScale);
        // Ensure we don't accidentally animate the seed
        setIsTransitioning(false);
        debug_log('[EntryInit] Seeded start pos:', { x: seedX, y: seedY, scale: initialScale });

        // Ensure the appear/start sequence can run afresh
        setHasStarted(false);
        // Reset one-shot guards for a fresh entry sequence
        entryTransitionStartedRef.current = false;
        stageZeroStartedRef.current = false;
      }
    }

    prevCallStatusRef.current = callStatus;
  }, [callStatus, bellButtonRect, isAvatarVisible, isTransitioning, hasEntered]);

  // Effect to handle call status changes
  useEffect(() => {
    if (callStatus === 'active') {
      bubble_float();
    } else {
      // Remove bubble-float animation when call ends
      const avatarElement = document.querySelector('.rive-avatar');
      if (avatarElement) {
        avatarElement.classList.remove('animate-bubble-float');
      }
      setIsFloating(false);
    }
  }, [callStatus]);

  // Mobile detection is now handled by useIsMobile hook

  // Detect fullscreen mode changes
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isCurrentlyFullscreen);
      debug_log('[Fullscreen] State changed:', isCurrentlyFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
    document.addEventListener('MSFullscreenChange', handleFullscreenChange);

    // Check initial state
    handleFullscreenChange();

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
    };
  }, [setIsFullscreen]);

  // FLOW TRACE: high-signal logs for debugging user flow
  React.useEffect(() => {
    debug_log('[Flow] callStatus changed →', callStatus);
  }, [callStatus]);
  React.useEffect(() => {
    debug_log('[Flow] isAvatarVisible →', isAvatarVisible);
  }, [isAvatarVisible]);
  React.useEffect(() => {
    debug_log('[Flow] isBrowserWindowVisible →', isBrowserWindowVisible);
  }, [isBrowserWindowVisible]);
  React.useEffect(() => {
    debug_log('[Flow] Speech flags → assistant:', isAssistantSpeaking);
  }, [isAssistantSpeaking]);

  // GIF-based avatar - no Rive state machine needed

  // Force canvas and container transparency (strengthened)
  React.useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .rive-avatar, .rive-avatar * {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
        border-radius: 0 !important;
      }
      .rive-avatar canvas {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
      }
      .rive-avatar div {
        background: transparent !important;
        background-color: transparent !important;
        border: none !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Debug logging for GIF avatar
  React.useEffect(() => {
    debug_log('🔧 GIF Avatar Debug Info:');
    debug_log('- Current GIF:', currentGifSrc);
    debug_log('- Is assistant speaking:', isAssistantSpeaking);
    debug_log('- Is browser window visible:', isBrowserWindowVisible);
    debug_log('- Is avatar visible:', isAvatarVisible);
    debug_log('- Has started:', hasStarted);
  }, [currentGifSrc, isAssistantSpeaking, isBrowserWindowVisible, isAvatarVisible, hasStarted]);

  // Log transform/position/scale changes to detect snapping
  React.useEffect(() => {
    debug_log('[Transform] pos:', avatarPosition, 'scale:', avatarScale, 'isTransitioning:', isTransitioning, 'isReturning:', isReturning);
  }, [avatarPosition, avatarScale, isTransitioning, isReturning]);

  // Trigger stage 0 when avatar becomes visible (bell button pressed)
  // eslint-disable-next-line complexity
  React.useEffect(() => {
  // eslint-disable-next-line complexity
    // If avatar just became visible and we're not in a transition yet, ensure we start at the bell
    if (isAvatarVisible && !isTransitioning && !hasEntered && bellButtonRect) {
  debug_log('[Visibility] Avatar visible; ensuring start at bell. Flags:', { isTransitioning, hasEntered });
      const buttonCenterX = bellButtonRect.left + bellButtonRect.width / 2;
      const buttonCenterY = bellButtonRect.top + bellButtonRect.height / 2;
      const initialScale = isMobile ? 0.3 : 0.48;
      const renderedSize = 250 * initialScale;
      setAvatarPosition({ x: buttonCenterX - renderedSize / 2, y: buttonCenterY - renderedSize / 2 });
      setAvatarScale(initialScale);
  debug_log('[Visibility] Positioned at bell:', { x: buttonCenterX - renderedSize / 2, y: buttonCenterY - renderedSize / 2, scale: initialScale });
    }
    // Wait until the entry transition (button -> corner) has completed
    if (isAvatarVisible && !hasStarted && hasEntered && !isTransitioning && !stageZeroStartedRef.current) {
      debug_log('🎬 Avatar became visible - starting GIF animation');
      setHasStarted(true);
      stageZeroStartedRef.current = true; // guard to prevent double scheduling in StrictMode/rerenders
      // Mark start animation as complete immediately for GIFs (no delay needed)
      setHasCompletedStartAnimation(true);
    }

    // Reset state when avatar becomes invisible (so it can start fresh next time)
    if (!isAvatarVisible && hasStarted) {
      debug_log('🔄 Avatar hidden - resetting state for next appearance');
      debug_log('[Reset] Clearing hasStarted/hasEntered');
      setHasStarted(false);
      setHasEntered(false);
      setHasCompletedStartAnimation(false); // Reset for next session
      setIsShowingWakeup(false); // Reset wakeup state
      setIsShowingSleep(false); // Reset sleep state
      // Do not snap to full size; keep at seeded (button) size on next entry
      // Position/scale will be properly seeded on session start and on visibility with bell rect
      setAvatarPosition(prev => prev);
      setAvatarScale(prev => prev);
      // Clear timers and reset guards on hide
      if (startToStage1TimeoutRef.current) {
        clearTimeout(startToStage1TimeoutRef.current);
        startToStage1TimeoutRef.current = null;
      }
      entryTransitionStartedRef.current = false;
      stageZeroStartedRef.current = false;
      returnAnimationStartedRef.current = false;
    }
  }, [isAvatarVisible, hasStarted, hasEntered, isTransitioning, bellButtonRect, isMobile]);

  // Reusable function to trigger return animation with reverse sparks
  const triggerReturnAnimation = React.useCallback((reason: string) => {
    if (!bellButtonRect || !isAvatarVisible || returnAnimationStartedRef.current) {
      debug_log(`[Return] Skipping return animation. Reason: ${reason}`, {
        bellButtonRect: !!bellButtonRect,
        isAvatarVisible,
        returnAnimationStarted: returnAnimationStartedRef.current
      });
      return;
    }

    debug_log(`📞 ${reason} - starting return animation`);
    debug_log('[Return] Before return: pos:', avatarPosition, 'scale:', avatarScale, 'isNotesWindowOpen:', isNotesWindowOpen);

    // Start showing sleep GIF
    setIsShowingSleep(true);
    setIsReturning(true);
    returnAnimationStartedRef.current = true;

    // Calculate return position - button is horizontally centered
    // Container: bottom 72px, padding 12px (p-3)
    // Button: 62.5px height
    // Button center from bottom: 72 + 12 (padding) + 31.25 (half button) = 115.25px
    const buttonCenterX = window.innerWidth / 2;
    const buttonCenterY = getVisibleViewportHeight() - 115.25;
    
    // Avatar is 250px base, scaled down. With transformOrigin '0 0', the visual top-left = translate position.
    // We want avatar center on button center, so offset by half the rendered size.
    const renderedSize = 250 * (isMobile ? 0.3 : 0.48);
    const targetX = buttonCenterX - renderedSize / 2;
    const targetY = buttonCenterY - renderedSize / 2;

    // Animate back to button position over 3 seconds using transform transition
    setIsTransitioning(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsReturning(true);
        setIsTransitioning(true);
        setAvatarPosition({ x: targetX, y: targetY });
        // Use same initial scale as entry: 0.3 for mobile, 0.48 for desktop
        const returnScale = isMobile ? 0.3 : 0.48;
        setAvatarScale(returnScale);
        debug_log('[Return] Target button position:', { x: targetX, y: targetY, scale: returnScale, isFullscreen });
      });
    });

    // Clear any previous timers
    if (returnOverlapTimeoutRef.current) {
      clearTimeout(returnOverlapTimeoutRef.current);
      returnOverlapTimeoutRef.current = null;
    }
    if (returnHideTimeoutRef.current) {
      clearTimeout(returnHideTimeoutRef.current);
    }

    // After the 3-second ending animation completes, hide avatar and show button
    returnHideTimeoutRef.current = window.setTimeout(() => {
      // Stop showing sleep GIF
      setIsShowingSleep(false);
      // Reset all animation state flags
      setIsReturning(false);
      setIsAnimationOverlapping(false);
      returnAnimationStartedRef.current = false;
      
      // Reset stage flags for next call
      setHasStarted(false);
      setHasEntered(false);
      setHasCompletedStartAnimation(false);
      entryTransitionStartedRef.current = false;
      stageZeroStartedRef.current = false;
      
      // Hide the avatar so the button can take over
      triggerAvatarHide();
      
      // Dispatch event so button knows avatar is hidden
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('avatarHidden'));
      }
      
      debug_log('[Return] Completed; avatar hidden, button will take over');
      returnHideTimeoutRef.current = null;
    }, 3000);
  }, [bellButtonRect, isAvatarVisible, isNotesWindowOpen, isFullscreen, avatarPosition, avatarScale, triggerAvatarHide, isMobile]);

  // Trigger stage 3 when call ends — use callStatus falling edge (ACTIVE/LOADING → INACTIVE)
  const prevCallStatusForReturnRef = useRef<string | null>(null);
  React.useEffect(() => {
    const prev = prevCallStatusForReturnRef.current;
    prevCallStatusForReturnRef.current = callStatus;

    const wasActiveOrLoading = prev === 'active' || prev === 'loading';
    // Treat both INACTIVE and UNAVAILABLE as terminal states requiring a resting/return transition
    const nowTerminal = callStatus === 'inactive' || callStatus === 'unavailable';

    if (wasActiveOrLoading && nowTerminal) {
      triggerReturnAnimation('Call ended (status)');
    }
  }, [callStatus, triggerReturnAnimation]);

  // Safety net: if the avatar is visible but there's no active voice session and no
  // return animation in progress, hide the avatar. This catches edge cases where
  // the avatar gets stuck in a visible/awake state after mode transitions (e.g.,
  // desktop-to-home) that bypass the normal return animation flow.
  React.useEffect(() => {
    const isTerminal = callStatus === 'inactive' || callStatus === 'unavailable';
    if (isAvatarVisible && isTerminal && !isReturning && !isTransitioning && hasEntered) {
      debug_log('[SafetyNet] Avatar visible with no active session — triggering return animation');
      triggerReturnAnimation('Safety net (no active session)');
    }
  }, [isAvatarVisible, callStatus, isReturning, isTransitioning, hasEntered, triggerReturnAnimation]);

  // Listen for logout start event to trigger return animation before session is cleared
  React.useEffect(() => {
    const handleLogoutStart = (event: Event) => {
      const customEvent = event as CustomEvent<{ reason: string }>;
      
      // Trigger return animation if avatar is visible, regardless of call status
      // This ensures the animation plays even if call already ended
      if (isAvatarVisible) {
        debug_log('🚪 Logout initiated - triggering return animation with reverse sparks');
        
        // End the call if it's still active
        const isCallActive = callStatus === 'active' || callStatus === 'loading';
        if (isCallActive && toggleCall) {
          debug_log('🚪 Ending call due to logout');
          toggleCall();
        }
        
        triggerReturnAnimation(`User logged out (${customEvent.detail?.reason || 'unknown'})`);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('user:logout:start', handleLogoutStart);
      return () => {
        window.removeEventListener('user:logout:start', handleLogoutStart);
      };
    }
  }, [callStatus, isAvatarVisible, triggerReturnAnimation, toggleCall]);

  // Also detect logout via session change as a fallback
  React.useEffect(() => {
    const prevSession = prevSessionRef.current;
    prevSessionRef.current = session;

    // Detect logout: session was present but is now null/undefined
    const wasLoggedIn = prevSession !== null && prevSession !== undefined;
    const isNowLoggedOut = session === null || session === undefined;

    // Only trigger if animation hasn't already started (to avoid duplicate animations)
    // Trigger if avatar is visible, regardless of call status
    if (wasLoggedIn && isNowLoggedOut && isAvatarVisible && !returnAnimationStartedRef.current) {
      debug_log('🚪 Logout detected via session change - triggering return animation with reverse sparks');
      
      // End the call if it's still active
      const isCallActive = callStatus === 'active' || callStatus === 'loading';
      if (isCallActive && toggleCall) {
        debug_log('🚪 Ending call due to logout (session change)');
        toggleCall();
      }
      
      triggerReturnAnimation('User logged out (session cleared)');
    }
  }, [session, callStatus, isAvatarVisible, triggerReturnAnimation, toggleCall]);

  // Handle transition animation from button to corner position (top-left if notes open, bottom-left otherwise)
  // eslint-disable-next-line complexity
  React.useEffect(() => {
    if (isAvatarVisible && !bellButtonRect && !hasStarted) {
      riveAvatarLogger.warn('[EntryTransition] Skipping transition: bellButtonRect missing');
      return;
    }
    if (isAvatarVisible && bellButtonRect && !hasStarted && !entryTransitionStartedRef.current) {
      debug_log('[EntryTransition] Begin; flags:', { isAvatarVisible, hasStarted, isTransitioning, hasEntered, isNotesWindowOpen, isFullscreen });
      entryTransitionStartedRef.current = true; // guard to avoid double start

      // Calculate starting position (button center)
      const buttonCenterX = bellButtonRect.left + bellButtonRect.width / 2;
      const buttonCenterY = bellButtonRect.top + bellButtonRect.height / 2;

      // Set starting position at button location without transition
      // With transformOrigin '0 0', position = visual top-left
      const entryScale = isMobile ? 0.3 : 0.48;
      const entryRendered = 250 * entryScale;
      setIsTransitioning(false);
      setAvatarPosition({ x: buttonCenterX - entryRendered / 2, y: buttonCenterY - entryRendered / 2 });
      setAvatarScale(entryScale);
      debug_log('[EntryTransition] Start at bell:', { x: buttonCenterX - entryRendered / 2, y: buttonCenterY - entryRendered / 2, scale: entryScale });

      // Wait a bit for fullscreen mode to activate if it's going to (gives time for F11 to take effect)
      // This prevents the avatar from going to the wrong position first
      setTimeout(() => {
        // Determine final position based on notes window state and mobile (checked after delay to catch fullscreen)
        let finalX: number;
        let finalY: number;
        let finalScale: number;
        
        if (isMobile) {
          // Mobile positioning: Position near N logo in bottom-left corner
          const mobilePos = getMobileAvatarPosition(isNotesWindowOpen);
          finalX = mobilePos.x;
          finalY = mobilePos.y;
          finalScale = MOBILE_POSITION.scale;
          
          debug_log('[EntryTransition] Mobile - Target position near N logo', { 
            finalX, 
            finalY, 
            scale: finalScale,
            isNotesOpen: isNotesWindowOpen,
            viewportWidth: window.innerWidth, 
            viewportHeight: window.innerHeight 
          });
        } else {
          // Desktop positioning
          if (isNotesWindowOpen) {
            // Bottom-left position when notes are open (grid layout)
            finalX = 20;
            finalY = getVisibleViewportHeight() - 120 - 60;
            finalScale = 0.48; // Same size as initial (120px from 250px base)
            debug_log('[EntryTransition] Target: top-left (notes open)');
          } else {
            // Bottom-left position when notes are closed
            // Avatar is 250px base size * 0.48 scale = 120px rendered
            // 20px gap from left, 60px gap from bottom (40px higher than before)
            finalX = 20;
            finalY = getVisibleViewportHeight() - 120 - 60; // Adapts to viewport height, 40px higher
            finalScale = 0.48; // Same size as initial (120px from 250px base)
            debug_log('[EntryTransition] Target: bottom-left (notes closed)', { finalY, viewportHeight: window.innerHeight });
          }
        }

        // Animate to final position with appropriate scale
        // Use single rAF to ensure the browser has painted the initial state
        requestAnimationFrame(() => {
          // Start showing wakeup GIF
          setIsShowingWakeup(true);
          // Enable transition and set final position
          setIsTransitioning(true);
          setAvatarPosition({ x: finalX, y: finalY });
          setAvatarScale(finalScale);
          debug_log('[EntryTransition] Animating to final position:', { 
            x: finalX, 
            y: finalY, 
            scale: finalScale 
          });

          // Animation complete after 1s (matches CSS transition)
          setTimeout(() => {
            // Stop showing wakeup GIF and switch to idle/talking
            setIsShowingWakeup(false);
            setIsTransitioning(false);
            setHasEntered(true);
            debug_log('[EntryTransition] Complete; hasEntered set true, wakeup finished');
          }, 1000);
        });
      }, 200); // 200ms delay to ensure initial render and allow fullscreen to activate
    }
  }, [isAvatarVisible, bellButtonRect, hasStarted, hasEntered, isTransitioning, isNotesWindowOpen, isFullscreen, isMobile]);

  // Handle position changes when notes opens/closes during active call
  // This makes the animation interruptible and responsive to notes state changes
  React.useEffect(() => {
    // Only apply during active call, after initial entry is complete, and not during return animation
    const isCallActive = callStatus === 'active' || callStatus === 'loading';
    debug_log('[NotesEffect] Running. Guards:', { isCallActive, hasEntered, isAvatarVisible, isReturning, isNotesWindowOpen, callStatus });
    if (!isCallActive || !hasEntered || !isAvatarVisible || isReturning) {
      debug_log('[NotesEffect] Skipping - guard condition not met');
      return;
    }

    // Calculate target position based on notes state and mobile
    let targetX: number;
    let targetY: number;
    
    if (isMobile) {
      // Mobile positioning: Position near N logo in bottom-left corner
      const mobilePos = getMobileAvatarPosition(isNotesWindowOpen);
      targetX = mobilePos.x;
      targetY = mobilePos.y;
      
      debug_log('[NotesPosition] Mobile - Repositioning near N logo', { 
        targetX, 
        targetY,
        isNotesOpen: isNotesWindowOpen,
        viewportWidth: window.innerWidth, 
        viewportHeight: window.innerHeight 
      });
    } else {
      // Desktop positioning
      if (isNotesWindowOpen) {
        // Bottom-left when notes open (grid layout)
        targetX = 20;
        targetY = getVisibleViewportHeight() - 120 - 60;
        debug_log('[NotesPosition] Notes opened - moving to top-left');
      } else {
        // Move to bottom-left when notes closed
        // 20px gap from left, 60px gap from bottom (40px higher than before)
        targetX = 20;
        targetY = getVisibleViewportHeight() - 120 - 60;
        debug_log('[NotesPosition] Notes closed - moving to bottom-left', { targetY, viewportHeight: window.innerHeight });
      }
    }

    // Only animate if position actually changed (avoid redundant animations)
    if (avatarPosition.x !== targetX || avatarPosition.y !== targetY) {
      // Smooth transition to new position
      setIsTransitioning(true);
      setAvatarPosition({ x: targetX, y: targetY });
      // Keep same scale during position change
      debug_log('[NotesPosition] Animating to:', { x: targetX, y: targetY, scale: avatarScale });
      
      // Clear transition flag after animation completes
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1000);
    }
  }, [isNotesWindowOpen, hasEntered, isAvatarVisible, callStatus, isReturning, avatarPosition.x, avatarPosition.y, avatarScale, isMobile]);

  // Handle real-time fullscreen changes - reposition avatar when entering/exiting fullscreen
  React.useEffect(() => {
    // Only apply during active call, after initial entry is complete, and not during return animation
    const isCallActive = callStatus === 'active' || callStatus === 'loading';
    if (!isCallActive || !hasEntered || !isAvatarVisible || isReturning) {
      return;
    }

    // Recalculate position based on current notes state, fullscreen mode, and mobile
    let targetX: number;
    let targetY: number;
    
    if (isMobile) {
      // Mobile positioning: Position near N logo (adapts to viewport changes)
      const mobilePos = getMobileAvatarPosition(isNotesWindowOpen);
      targetX = mobilePos.x;
      targetY = mobilePos.y;
      
      debug_log('[FullscreenPosition] Mobile - Recalculating position near N logo:', { 
        isFullscreen, 
        targetX, 
        targetY,
        isNotesOpen: isNotesWindowOpen,
        viewportWidth: window.innerWidth, 
        viewportHeight: window.innerHeight 
      });
    } else {
      // Desktop positioning
      if (isNotesWindowOpen) {
        // Bottom-left when notes open (grid layout)
        targetX = 20;
        targetY = getVisibleViewportHeight() - 120 - 60;
        debug_log('[FullscreenPosition] Notes open, recalculating for fullscreen:', isFullscreen);
      } else {
        // Bottom-left position when notes closed - adapts to viewport changes
        // 20px gap from left, 60px gap from bottom (40px higher than before)
        targetX = 20;
        targetY = getVisibleViewportHeight() - 120 - 60;
        debug_log('[FullscreenPosition] Notes closed, recalculating for viewport:', { isFullscreen, targetY, viewportHeight: window.innerHeight });
      }
    }

    // Only animate if position actually changed (avoid redundant animations)
    const positionChanged = Math.abs(avatarPosition.x - targetX) > 1 || Math.abs(avatarPosition.y - targetY) > 1;
    if (positionChanged) {
      debug_log('[FullscreenPosition] Repositioning avatar for screen change');
      
      // Smooth transition to new position
      setIsTransitioning(true);
      setAvatarPosition({ x: targetX, y: targetY });
      debug_log('[FullscreenPosition] Animating to:', { x: targetX, y: targetY, isFullscreen });
      
      // Clear transition flag after animation completes
      setTimeout(() => {
        setIsTransitioning(false);
      }, 1000);
    }
  }, [isFullscreen, hasEntered, isAvatarVisible, callStatus, isReturning, isNotesWindowOpen, avatarPosition.x, avatarPosition.y, isMobile]);

  // iOS Safari: listen to visualViewport resize (address bar show/hide) to reposition avatar
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    if (!hasEntered || !isAvatarVisible || isReturning) return;
    
    const handleViewportResize = () => {
      const isCallActive = callStatus === 'active' || callStatus === 'loading';
      if (!isCallActive) return;
      
      let targetX: number;
      let targetY: number;
      
      if (isMobile) {
        const mobilePos = getMobileAvatarPosition(isNotesWindowOpen);
        targetX = mobilePos.x;
        targetY = mobilePos.y;
      } else {
        if (isNotesWindowOpen) {
          targetX = 10;
          targetY = 100;
        } else {
          targetX = 20;
          targetY = getVisibleViewportHeight() - 120 - 60;
        }
      }
      
      const posChanged = Math.abs(avatarPosition.x - targetX) > 2 || Math.abs(avatarPosition.y - targetY) > 2;
      if (posChanged) {
        // Use no transition for viewport resize (address bar) to avoid jankiness
        setIsTransitioning(false);
        setAvatarPosition({ x: targetX, y: targetY });
      }
    };
    
    window.visualViewport.addEventListener('resize', handleViewportResize);
    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize);
    };
  }, [hasEntered, isAvatarVisible, isReturning, callStatus, isMobile, isNotesWindowOpen, avatarPosition.x, avatarPosition.y]);

  // Cleanup on unmount: clear all timers
  React.useEffect(() => {
    return () => {
      if (startToStage1TimeoutRef.current) clearTimeout(startToStage1TimeoutRef.current);
      if (returnOverlapTimeoutRef.current) clearTimeout(returnOverlapTimeoutRef.current);
      if (returnHideTimeoutRef.current) clearTimeout(returnHideTimeoutRef.current);
      if (menuHideTimeoutRef.current !== null) {
        window.clearTimeout(menuHideTimeoutRef.current);
        menuHideTimeoutRef.current = null;
      }
    };
  }, []);

  // Handle avatar action to toggle call (start or end)
  // const handleAvatarAction = () => {
  //   hideAvatarMenu();
  //   debug_log('[Click] Avatar clicked. callStatus:', callStatus, 'bellRect?', !!bellButtonRect);
    
  //   // Toggle call - starts if inactive, ends if active
  //   if (toggleCall) {
  //     debug_log('[Click] Toggling call. Current status:', callStatus);
  //     toggleCall();
  //   }
  // };

  const clearMenuHideTimeout = React.useCallback(() => {
    if (menuHideTimeoutRef.current !== null) {
      window.clearTimeout(menuHideTimeoutRef.current);
      menuHideTimeoutRef.current = null;
    }
  }, []);

  const showAvatarMenu = React.useCallback(() => {
    if (!isMultiMenuEnabled || isMenuRevealed) {
      return;
    }
    clearMenuHideTimeout();
    pearlMultiMenuRef.current?.triggerAnimation();
    setIsMenuRevealed(true);
  }, [isMenuRevealed, isMultiMenuEnabled, setIsMenuRevealed, clearMenuHideTimeout]);

  const hideAvatarMenu = React.useCallback(() => {
    if (!isMenuRevealed) {
      return;
    }
    clearMenuHideTimeout();
    pearlMultiMenuRef.current?.hideAnimation();
    setIsMenuRevealed(false);
  }, [isMenuRevealed, setIsMenuRevealed, clearMenuHideTimeout]);

  const scheduleAvatarMenuHide = React.useCallback(() => {
    clearMenuHideTimeout();
    menuHideTimeoutRef.current = window.setTimeout(() => {
      hideAvatarMenu();
    }, 200);
  }, [clearMenuHideTimeout, hideAvatarMenu]);

  const resolvePersonalityKey = React.useCallback((config: PersonalityVoiceConfig) => {
    const entry = Object.entries(allowedPersonalities).find(([_, value]) =>
      value === config || (
        value.personalityId === config.personalityId &&
        value.voice.provider === config.voice.provider &&
        value.voice.voiceId === config.voice.voiceId
      )
    );
    return entry?.[0];
  }, [allowedPersonalities]);

  const handleAvatarPersonalityChange = React.useCallback((config: PersonalityVoiceConfig) => {
    const compositeKey = resolvePersonalityKey(config);
    if (compositeKey) {
      setCurrentPersonalityKey(compositeKey);
    }
    if (typeof window !== 'undefined' && typeof window.__niaHandlePersonalityChange === 'function') {
      window.__niaHandlePersonalityChange(config);
    }
  }, [resolvePersonalityKey]);

  const handleAvatarHoverStart = () => {
    clearMenuHideTimeout();
    showAvatarMenu();
  };

  const handleAvatarHoverEnd = () => {
    scheduleAvatarMenuHide();
  };

  const handleAvatarClick = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    debug_log('[RiveAvatar] handleAvatarClick called', { callStatus, toggleCall: !!toggleCall });
    hideAvatarMenu();
    handleAvatarAction();
  };

  const handleAvatarTouchStart = () => {
    clearMenuHideTimeout();
    hideAvatarMenu();
  };

  const handleAvatarTouchEnd = () => {
    hideAvatarMenu();
    handleAvatarAction();
  };

  const handleAvatarMenuPointerEnter = () => {
    clearMenuHideTimeout();
    showAvatarMenu();
  };

  const handleAvatarMenuPointerLeave = () => {
    scheduleAvatarMenuHide();
  };

  // Handle icon clicks from PearlMultiMenu
  const handleIconAction = (iconType: string) => {
    switch (iconType) {
      case 'top':
        // Add action for top icon (e.g., open notes)
        break;
      case 'top-right':
        // Add action for top-right icon (e.g., open calendar)
        break;
      case 'bottom-right':
        // Add action for bottom-right icon (e.g., open settings)
        break;
      case 'bottom-left':
        // Add action for bottom-left icon (e.g., open browser)
        break;
      case 'top-left':
        // Add action for top-left icon (e.g., open messages)
        break;
      default:
        // Unknown icon type
    }
  };

  const handleAvatarAction = () => {
    debug_log('[RiveAvatar] handleAvatarAction called', { callStatus, toggleCall: !!toggleCall, activeSpriteVoice, spriteStartedSession });
    
    // If sprite voice is active, clicking the avatar hot-switches to OS personality
    // The voice session stays active - user clicked Pearl because they want to talk to Pearl
    if (activeSpriteVoice && callStatus === 'active') {
      debug_log('[RiveAvatar] Sprite voice active, hot-switching to OS personality (keeping session)');
      // Clear the spriteStartedSession flag since we're transitioning to OS
      if (spriteStartedSession) {
        setSpriteStartedSession(false);
      }
      disableSpriteVoice(); // This sends updateBotConfig to restore OS personality
      return;
    }
    
    if (toggleCall) {
      debug_log('[RiveAvatar] Invoking toggleCall');
      toggleCall();
    } else {
      debug_log('[RiveAvatar] toggleCall is null/undefined');
    }
  };
  // GIF-based avatar doesn't need state machine updates
  // The GIF switches automatically based on isAssistantSpeaking

  // GIF-based avatar - no manual control functions needed



  // Only render when avatar should be visible
  // Hide avatar during Daily Call (video bot) handoff,
  // or when chat mode is active (tiny Pearl in the chat bar replaces the floating avatar)
  // Note: Wonder Canvas no longer hides the avatar — Pearl floats above canvas content (z-index 500 > 1)
  if (!isAvatarVisible || isDailyCallActive || isChatMode) {
    return null;
  }

  // Calculate dynamic positioning and styling
  // Always drive position via top/left using avatarPosition to avoid initial snap to bottom-left
  const transitionValue = isReturning
    ? 'transform 3s cubic-bezier(0.4, 0, 0.2, 1)'
    : isTransitioning
    ? 'transform 1s cubic-bezier(0.4, 0, 0.2, 1)'
    : undefined;

  const dynamicStyle = {
    position: 'fixed' as const,
    left: '0px',
    top: '0px',
    transform: `translate(${avatarPosition.x}px, ${avatarPosition.y}px) scale(${avatarScale})`,
    transformOrigin: '0 0' as const,
    willChange: 'transform',
    zIndex: 500, // Z-scale: avatar layer
    pointerEvents: 'auto' as const,
    ...(transitionValue ? { transition: transitionValue } : {}),
  };

  return (
    <>
      {/* PearlMultiMenu positioned outside the avatar container to avoid canvas clipping */}
      {isFeatureEnabled('pearlMultiMenu', supportedFeatures) && (
        <div
          style={{
            position: 'fixed',
            left: '0px',
            top: '0px',
            transform: `translate(${avatarPosition.x}px, ${avatarPosition.y}px) scale(${avatarScale})`,
            transformOrigin: '0 0',
            width: '250px',
            height: '250px',
            zIndex: 499, // Z-scale: just behind the avatar
            pointerEvents: 'none', // Keep container non-interactive, let individual elements handle their own pointer events
            ...(transitionValue ? { transition: transitionValue } : {}), // Follow avatar transitions
          }}
        >
          <PearlMultiMenu
            ref={pearlMultiMenuRef}
            className="pearl-multi-menu-layer"
            allowedPersonalities={allowedPersonalities}
            currentPersonalityKey={currentPersonalityKey}
            onMenuStateChange={(isRevealed) => {
              setIsMenuRevealed(isRevealed);
            }}
            onPersonalityChange={handleAvatarPersonalityChange}
            onPointerEnter={handleAvatarMenuPointerEnter}
            onPointerLeave={handleAvatarMenuPointerLeave}
            onIconClick={(iconType) => {
              // Handle specific icon actions here
              handleIconAction(iconType);
            }}
          />
        </div>
      )}

      <div
        className={`${className}`}
        style={{
          ...dynamicStyle,
          cursor: 'default',
          pointerEvents: 'none' // Disable pointer events on the container
        }}
        onMouseLeave={(e) => {
          handleAvatarHoverEnd();
        }}
      >
        {/* Avatar Container - Fully Transparent */}
        <div
          className="rive-avatar relative w-[250px] h-[250px] overflow-hidden"
          style={{
            background: 'transparent',
            backgroundColor: 'transparent',
            border: 'none',
            borderRadius: '0',
          }}
        >
          <div
            className="w-full h-full relative"
            style={{
              background: 'transparent',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '0',
            }}
          >
            {/* GIF Avatar Image */}
            <img
              src={currentGifSrc}
              alt="Avatar"
              className="w-full h-full pointer-events-none object-contain"
              style={{
                background: 'transparent',
                backgroundColor: 'transparent',
                border: 'none',
                borderRadius: '0',
              }}
            />
            {/* Clickable area for the center avatar pearl - always present when avatar visible */}
            <div
              className="absolute cursor-pointer"
              style={{
                top: '50%',
                left: '50%',
                width: '100%', // Full container clickable area
                height: '100%',
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                zIndex: 10, // Above the animation
                pointerEvents: 'auto', // Enable clicking
                backgroundColor: 'transparent',
              }}
              onMouseEnter={handleAvatarHoverStart}
              onMouseLeave={handleAvatarHoverEnd}
              onFocus={handleAvatarHoverStart}
              onBlur={handleAvatarHoverEnd}
              onClick={(e) => {
                debug_log('[RiveAvatar] Click detected on overlay', { callStatus, toggleCall: !!toggleCall });
                handleAvatarClick(e);
              }}
              onTouchStart={handleAvatarTouchStart}
              onTouchEnd={handleAvatarTouchEnd}
              title={callStatus === 'active' ? 'Click to end session' : 'Click to start session'}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default RiveAvatar;
