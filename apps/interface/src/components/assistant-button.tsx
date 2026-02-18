'use client';

import { isFeatureEnabled } from '@nia/features';
import { PersonalityVoiceConfig } from '@nia/prism/core/blocks/assistant.block';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@interface/components/ui/button';
import { useUI } from '@interface/contexts/ui-context';
import { useIsMobile } from '@interface/hooks/use-is-mobile';
import { getClientLogger } from '@interface/lib/client-logger';

import PearlMultiMenu, { PearlMultiMenuRef } from '../features/PearlMultiMenu/components/PearlMultiMenu';
import { CALL_STATUS, useVoiceSession } from '../hooks/useVoiceSession';
import type { SoundtrackControlDetail } from '../features/Soundtrack/lib/events';
import { SOUNDTRACK_EVENTS } from '../features/Soundtrack/lib/events';

import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode } from '@interface/types/desktop-modes';

import { MODE_SELECTOR_UNLOCK_EVENT } from './desktop-mode-selector-events';
import { Skeleton } from './ui/skeleton';



const PEARL_WELCOME_DISMISS_EVENT = 'pearl-welcome-dismiss';

const AssistantButton = ({
  assistantName,
  toggleCall,
  callStatus,
  audioLevel: _audioLevel = 0,
  themeData: _themeData,
  supportedFeatures,
  startFullScreen,
  allowedPersonalities = {},
  currentPersonalityKey,
  onPersonalityChange
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}: { 
  assistantName: string; 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  themeData?: any; 
  supportedFeatures: string[] | undefined; 
  startFullScreen: boolean; 
  allowedPersonalities?: Record<string, PersonalityVoiceConfig>;
  currentPersonalityKey?: string; // Now composite key instead of UUID
  onPersonalityChange?: (config: PersonalityVoiceConfig) => void;
} & Partial<ReturnType<typeof useVoiceSession>>) => {
  const logger = getClientLogger('[assistant_button]');
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [callStartBuffer, setCallStartBuffer] = useState<AudioBuffer | null>(
    null
  );
  const [callEndBuffer, setCallEndBuffer] = useState<AudioBuffer | null>(null);
  const [callUnavailableBuffer, setCallUnavailableBuffer] = useState<AudioBuffer | null>(null);
  const [textPrompt, setTextPrompt] = useState(false);
  const seatrade = assistantName === 'seatrade' || assistantName === 'paddytest' || assistantName === 'seatrade-jdx';

  // Mobile detection for button sizing
  const isMobile = useIsMobile();

  // UI context and avatar control
  const { triggerAvatarPopup, triggerAvatarHide, setBellButtonRect, isBrowserWindowVisible, isAvatarVisible, isDailyCallActive, isNotesWindowOpen, isChatMode, setIsChatMode } = useUI();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pearlMultiMenuRef = useRef<PearlMultiMenuRef>(null);
  const menuHideTimeoutRef = useRef<number | null>(null);
  const soundtrackTimeoutRef = useRef<number | null>(null);
  const [isMenuRevealed, setIsMenuRevealed] = useState(false);
  const isMultiMenuEnabled = isFeatureEnabled('pearlMultiMenu', supportedFeatures);
  const wasAvatarVisibleBeforeChatRef = useRef(false);
  const previousDesktopModeRef = useRef<DesktopMode | null>(null);

  // Desktop mode context for chat mode integration
  const { currentMode: currentDesktopMode, setMode: setDesktopMode } = useDesktopMode();

  // Capture button position for avatar animation
  useEffect(() => {
    if (buttonRef.current) {
      const updateButtonRect = () => {
        const rect = buttonRef.current?.getBoundingClientRect();
        if (rect) {
          setBellButtonRect(rect);
        }
      };

      updateButtonRect();

      // Update position on window resize
      window.addEventListener('resize', updateButtonRect);
      window.addEventListener('scroll', updateButtonRect);

      return () => {
        window.removeEventListener('resize', updateButtonRect);
        window.removeEventListener('scroll', updateButtonRect);
      };
    }
  }, [setBellButtonRect, callStatus, isBrowserWindowVisible]); // Re-capture when call status changes (button size might change) or browser window visibility changes (button position changes)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Initialize the Web Audio API context
      const context = new AudioContext();
      setAudioContext(context);

      // Load audio files and decode them
      const loadSound = async (url: string): Promise<AudioBuffer> => {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        return await context.decodeAudioData(arrayBuffer);
      };

      // Load and set the audio buffers for start and end sounds
      loadSound('/sounds/magicbell4.wav')
        .then((buffer) => {
          setCallStartBuffer(buffer);
        })
        .catch((error) => logger.error('Error loading start sound', {
          error: error instanceof Error ? error.message : String(error),
        }));

      loadSound('/sounds/magicbell3.wav')
        .then((buffer) => {
          setCallEndBuffer(buffer);
        })
        .catch((error) => logger.error('Error loading end sound', {
          error: error instanceof Error ? error.message : String(error),
        }));
      if (assistantName === 'seatrade-jdx') {
        loadSound('/sounds/nia-quickbreak.wav')
          .then((buffer) => {
            setCallUnavailableBuffer(buffer);
          })
          .catch((error) => logger.error('Error loading nia unavailable sound', {
            error: error instanceof Error ? error.message : String(error),
          }));
      }
      if (assistantName === 'seatrade') {
        loadSound('/sounds/cruise-quickbreak.wav')
          .then((buffer) => {
            setCallUnavailableBuffer(buffer);
          })
          .catch((error) => logger.error('Error loading cruise agent unavailable sound', {
            error: error instanceof Error ? error.message : String(error),
          }));
      }
    }
  }, [assistantName]);


  // Ensure we have a usable AudioContext and resume it if the browser auto-suspended it.
  const getActiveAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') return null;

    let ctx = audioContext;

    // Recreate if the context was closed by the browser.
    if (!ctx || ctx.state === 'closed') {
      try {
        ctx = new AudioContext();
        setAudioContext(ctx);
      } catch (err) {
        logger.warn('Failed to create AudioContext', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (err) {
        logger.warn('Failed to resume AudioContext', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    return ctx;
  }, [audioContext]);

  const playSound = useCallback(async (buffer: AudioBuffer | null) => {
    if (!buffer) return;

    const ctx = await getActiveAudioContext();
    if (!ctx) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  }, [getActiveAudioContext]);

  // Track previous callStatus to prevent sound on initial mount
  const prevCallStatusRef = useRef<typeof callStatus>();
  useEffect(() => {
    if (callStatus === CALL_STATUS.UNAVAILABLE && callUnavailableBuffer) {
      playSound(callUnavailableBuffer);
      setTextPrompt(true);
    }
    // Only play call end sound if transitioning to INACTIVE from another state
    if (
      prevCallStatusRef.current !== undefined &&
      prevCallStatusRef.current !== CALL_STATUS.INACTIVE &&
      callStatus === CALL_STATUS.INACTIVE &&
      callEndBuffer
    ) {
      playSound(callEndBuffer);
    }
    prevCallStatusRef.current = callStatus;
  }, [callStatus, callUnavailableBuffer, callEndBuffer, playSound]);

  useEffect(() => {
    const handleForceStart = () => {
      // Ensure we capture the button rect before triggering avatar popup
      if (buttonRef.current) {
        try {
          const rect = buttonRef.current.getBoundingClientRect();
          setBellButtonRect(rect);
        } catch {
          // no-op
        }
      }

      if (callStatus === CALL_STATUS.INACTIVE) {
        triggerAvatarPopup();
        if (toggleCall) {
          if (callStartBuffer) {
            playSound(callStartBuffer);
          }
          toggleCall();
        }
        return;
      }

      if (callStatus === CALL_STATUS.UNAVAILABLE || callStatus === CALL_STATUS.LOADING) {
        triggerAvatarPopup();
      }
    };

    window.addEventListener('assistant:force-start', handleForceStart);
    return () => {
      window.removeEventListener('assistant:force-start', handleForceStart);
    };
  }, [callStatus, callStartBuffer, toggleCall, triggerAvatarPopup, playSound, setBellButtonRect]);

  const dismissPearlWelcome = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(PEARL_WELCOME_DISMISS_EVENT));
    }
  };

  const clearMenuHideTimeout = useCallback(() => {
    if (menuHideTimeoutRef.current !== null) {
      window.clearTimeout(menuHideTimeoutRef.current);
      menuHideTimeoutRef.current = null;
    }
  }, []);

  const showPearlMenu = useCallback(() => {
    if (!isMultiMenuEnabled || isMenuRevealed) {
      return;
    }
    clearMenuHideTimeout();
    pearlMultiMenuRef.current?.triggerAnimation();
    setIsMenuRevealed(true);
  }, [isMenuRevealed, isMultiMenuEnabled, setIsMenuRevealed, clearMenuHideTimeout]);

  const hidePearlMenu = useCallback(() => {
    if (!isMenuRevealed) {
      return;
    }
    clearMenuHideTimeout();
    pearlMultiMenuRef.current?.hideAnimation();
    setIsMenuRevealed(false);
  }, [isMenuRevealed, setIsMenuRevealed, clearMenuHideTimeout]);

  const scheduleMenuHide = useCallback(() => {
    clearMenuHideTimeout();
    menuHideTimeoutRef.current = window.setTimeout(() => {
      hidePearlMenu();
    }, 200);
  }, [clearMenuHideTimeout, hidePearlMenu]);

  const dispatchModeSelectorUnlock = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(MODE_SELECTOR_UNLOCK_EVENT));
    }
  }, []);

  const enterChatMode = useCallback(() => {
    if (isChatMode || isDailyCallActive) return;
    
    logger.info('Entering chat mode (silent)');
    wasAvatarVisibleBeforeChatRef.current = isAvatarVisible;
    
    // Switch to work desktop mode (store previous mode for restoration)
    previousDesktopModeRef.current = currentDesktopMode;
    if (currentDesktopMode !== DesktopMode.WORK) {
      setDesktopMode(DesktopMode.WORK);
    }
    
    // Show avatar silently (no sound)
    triggerAvatarPopup();
    
    // Set chat mode state
    setIsChatMode(true);
  }, [isChatMode, isDailyCallActive, isAvatarVisible, triggerAvatarPopup, setIsChatMode, currentDesktopMode, setDesktopMode]);

  const exitChatMode = useCallback(() => {
    if (!isChatMode) return;
    
    logger.info('Exiting chat mode');
    
    // Hide avatar if it wasn't visible before chat mode
    if (!wasAvatarVisibleBeforeChatRef.current) {
      triggerAvatarHide();
    }
    
    // Restore previous desktop mode
    if (previousDesktopModeRef.current !== null) {
      setDesktopMode(previousDesktopModeRef.current);
      previousDesktopModeRef.current = null;
    }
    
    setIsChatMode(false);
    wasAvatarVisibleBeforeChatRef.current = false;
  }, [isChatMode, triggerAvatarHide, setIsChatMode, setDesktopMode]);

  // Force-clear chat mode state without restoring previous desktop mode
  // Used when an external action (like taskbar Home button) changes the mode
  const forceClearChatMode = useCallback(() => {
    if (!isChatMode) return;

    logger.info('Force-clearing chat mode (external mode change)');

    // Always hide the avatar if the voice call isn't active.
    // Previously we only hid when !wasAvatarVisibleBeforeChatRef, but if the
    // voice session ended while chat mode was active, the avatar would remain
    // visible in an "awake" state with no active session (stuck avatar bug).
    const isCallActive = callStatus === CALL_STATUS.ACTIVE || callStatus === CALL_STATUS.LOADING;
    if (!isCallActive || !wasAvatarVisibleBeforeChatRef.current) {
      triggerAvatarHide();
    }

    // Clear chat mode WITHOUT restoring desktop mode (external action already set it)
    setIsChatMode(false);
    wasAvatarVisibleBeforeChatRef.current = false;
    previousDesktopModeRef.current = null;
  }, [isChatMode, callStatus, triggerAvatarHide, setIsChatMode]);

  // Auto-exit chat mode when desktop mode changes away from WORK (e.g., taskbar Home button)
  useEffect(() => {
    if (isChatMode && currentDesktopMode !== DesktopMode.WORK) {
      forceClearChatMode();
    }
  }, [currentDesktopMode, isChatMode, forceClearChatMode]);

  const handleChatModeToggle = useCallback(() => {
    if (isChatMode) {
      exitChatMode();
    } else {
      enterChatMode();
    }
  }, [isChatMode, enterChatMode, exitChatMode]);

  const handleAction = () => {
    dismissPearlWelcome();
    hidePearlMenu();
    dispatchModeSelectorUnlock();

    // Ensure we capture the latest bell button rect right at click time
    if (buttonRef.current) {
      try {
        const rect = buttonRef.current.getBoundingClientRect();
        setBellButtonRect(rect);

      } catch {
        // no-op
      }
    }
    // If chat mode is active and user taps Pearl, minimize the chat panel
    if (isChatMode && callStatus === CALL_STATUS.INACTIVE) {
      // Dispatch minimize event to ChatMode component
      window.dispatchEvent(new Event('pearl:chat-minimize'));
      return; // Don't start voice call
    }

    if (callStatus === CALL_STATUS.ACTIVE) {
      // Play call end sound
      if (toggleCall) {
        // Clear soundtrack timeout if call is ending before 5 seconds
        if (soundtrackTimeoutRef.current !== null) {
          window.clearTimeout(soundtrackTimeoutRef.current);
          soundtrackTimeoutRef.current = null;
        }

        toggleCall();
        playSound(callEndBuffer);
        // Do not immediately hide avatar here; let RiveAvatar drive Reverse Appear and hide itself
        const clearViewStateEvent = new CustomEvent('clearViewStateCache', {
          detail: { reason: 'user_closed_conversation' }
        });
        window.dispatchEvent(clearViewStateEvent);
      }
    } else if (callStatus === CALL_STATUS.INACTIVE) {

      // Trigger avatar popup animation first
      triggerAvatarPopup();

      // If startFullScreen flag is set, enter native fullscreen
      // DON'T set isBrowserWindowVisible here - that's for when apps are actually open
      if (startFullScreen) {
        // Enter native browser fullscreen mode
        if (document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch((err) => {
            logger.error('Failed to enter fullscreen', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }

      // Play call start sound and start call
      if (toggleCall) {
        playSound(callStartBuffer);
        toggleCall();
        
        // Start soundtrack after 5 seconds
        // Clear any existing soundtrack timeout
        if (soundtrackTimeoutRef.current !== null) {
          window.clearTimeout(soundtrackTimeoutRef.current);
          soundtrackTimeoutRef.current = null;
        }
        
        soundtrackTimeoutRef.current = window.setTimeout(() => {
          if (typeof window !== 'undefined' && isFeatureEnabled('soundtrack', supportedFeatures)) {
            const soundtrackEvent = new CustomEvent<SoundtrackControlDetail>(SOUNDTRACK_EVENTS.CONTROL, {
              detail: { action: 'play' }
            });
            window.dispatchEvent(soundtrackEvent);
            logger.info('Soundtrack playback triggered after 5 seconds');
          }
          soundtrackTimeoutRef.current = null;
        }, 5000);
      }
    }
  };

  const handleHoverStart = () => {
    clearMenuHideTimeout();
    showPearlMenu();
  };

  const handleHoverEnd = () => {
    scheduleMenuHide();
  };

  const handleMenuPointerEnter = () => {
    clearMenuHideTimeout();
    showPearlMenu();
  };

  const handleMenuPointerLeave = () => {
    scheduleMenuHide();
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

  useEffect(() => {
    return () => {
      clearMenuHideTimeout();
      // Cleanup soundtrack timeout on unmount
      if (soundtrackTimeoutRef.current !== null) {
        window.clearTimeout(soundtrackTimeoutRef.current);
        soundtrackTimeoutRef.current = null;
      }
    };
  }, [clearMenuHideTimeout]);

  const isCallInactive = callStatus === CALL_STATUS.INACTIVE || callStatus === CALL_STATUS.UNAVAILABLE;
  const backgroundColor = 'transparent';

  const getButtonSize = () => {
    // Check call status first - if inactive/unavailable, button should be large
    if (isCallInactive) {
      // Button is large when inactive, regardless of browser window state
      // On mobile, match RiveAvatar initial size (0.3 scale = 75px)
      if (isMobile) {
        return '75px';
      }
      // Desktop: keep original sizes
      return seatrade ? '128px' : '120px';
    }
    
    // During active call, button is smaller (or hidden by avatar)
    if (isBrowserWindowVisible) {
      // When browser window is visible during call, use active button size
      return seatrade ? '64px' : '62.5px';
    }
    
    // Default active size
    return seatrade ? '64px' : '120px';
  };

  const buttonSize = getButtonSize();

  const buttonStyle = {
    borderRadius: '50%',
    width: buttonSize,
    height: buttonSize,
    color: 'white',
    border: 'none',
    boxShadow: 'none',
    backgroundColor: backgroundColor,
    cursor: 'pointer',
    transition: 'all 0.3s ease-in-out',
    padding: '0px',
    display: 'block',
    zIndex: 2,
    pointerEvents: 'none' as const, // Disable pointer events on the button itself
    // border: '2px solid blue', // DEBUG BORDER
  };

  // Hide the bell button completely while the avatar is visible to prevent layout/z-index conflicts
  // OR when Daily Call is specifically active (work mode)
  // OR when inactive and notes window is open (mobile only)
  // Note: We no longer hide during LOADING - the bell should remain visible until the avatar actually appears
  const avatarFeatureOn = isFeatureEnabled('avatar', supportedFeatures);
  // Also hide the pearl orb when chat mode is active — tiny Pearl lives inside the chat bar instead
  const shouldHideBell = (avatarFeatureOn && isAvatarVisible) || (isDailyCallActive && isFeatureEnabled('dailyCall', supportedFeatures)) || (isCallInactive && isNotesWindowOpen && isMobile) || isChatMode;
  if (shouldHideBell) return null;

  return (
    <div className='relative'>
      <Button
        ref={buttonRef}
        style={{ ...buttonStyle, background: 'transparent' }}
        className={'transition ease-in-out flex items-center justify-center'}
      >
        <div
          className='flex justify-center items-center w-full h-full'
          style={{
            borderRadius: '50%',
            background: 'none',
            position: 'relative'
          }}
        >
          {/* PearlMultiMenu state machine - positioned behind the main animation */}
          {isFeatureEnabled('pearlMultiMenu', supportedFeatures) && (
            <PearlMultiMenu
              ref={pearlMultiMenuRef}
              className="pearl-multi-menu-layer"
              allowedPersonalities={allowedPersonalities}
              currentPersonalityKey={currentPersonalityKey}
              onPersonalityChange={onPersonalityChange}
              onMenuStateChange={(isRevealed) => {
                setIsMenuRevealed(isRevealed);
              }}
              onPointerEnter={handleMenuPointerEnter}
              onPointerLeave={handleMenuPointerLeave}
              onIconClick={(iconType) => {
                // Handle specific icon actions here
                handleIconAction(iconType);
              }}
            />
          )}
          
          <img
            src="/images/avatar/Pearlinactivenew.png"
            alt="Pearl inactive"
            className="w-full h-full"
            style={{
              backgroundColor: 'transparent',
              background: 'none',
              filter: seatrade ? 'none' : 'drop-shadow(2px 2px 2px black)',
              transform: 'scale(1)',
              transition: 'all 0.2s ease-in-out',
              position: 'relative',
              zIndex: 2,
              objectFit: 'contain',
              pointerEvents: 'none',
            }}
          />

          {/* Loading spinner removed - the bell now stays visible during LOADING 
              until the avatar appears, so we don't need a loading indicator here.
              The avatar entry animation itself indicates the session is starting. */}

          {/* Clickable area for the center pearl button */}
          <div
            className="absolute cursor-pointer"
            style={{
              top: '50%',
              left: '50%',
              width: '60%', // Smaller clickable area - just the pearl
              height: '60%',
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 3, // Above the animation
              pointerEvents: 'auto', // Enable clicking
              backgroundColor: 'transparent',
            }}
            onMouseEnter={handleHoverStart}
            onMouseLeave={handleHoverEnd}
            onFocus={handleHoverStart}
            onBlur={handleHoverEnd}
            onClick={handleAction}
            onTouchStart={dismissPearlWelcome}
            onTouchEnd={handleAction}
            onTouchCancel={handleHoverEnd}
            title="Click to start session"
          />
        </div>
      </Button>
      {/* Chat mode button - appears next to Pearl button when call is inactive */}
      {isCallInactive && !seatrade && !isDailyCallActive && (
        <button
          onClick={handleChatModeToggle}
          title={isChatMode ? 'Exit chat mode' : 'Chat with Pearl (silent)'}
          style={{
            position: 'absolute',
            bottom: isMobile ? '-2px' : '2px',
            right: isMobile ? '-8px' : '-14px',
            width: isMobile ? '32px' : '36px',
            height: isMobile ? '32px' : '36px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: isChatMode ? 'rgba(59, 130, 246, 0.9)' : 'transparent',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease-in-out',
            zIndex: 10,
            pointerEvents: 'auto',
            boxShadow: isChatMode ? '0 0 12px rgba(59, 130, 246, 0.5)' : 'none',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'rgba(59, 130, 246, 1)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.backgroundColor = isChatMode ? 'rgba(59, 130, 246, 0.9)' : 'transparent';
          }}
        >
          {isChatMode ? (
            // X icon when chat mode is active
            <svg width={isMobile ? '16' : '18'} height={isMobile ? '16' : '18'} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            // Chat icon
            <img src="/chaticon.png" alt="Chat" width={isMobile ? 20 : 22} height={isMobile ? 20 : 22} style={{ borderRadius: '50%' }} />
          )}
        </button>
      )}
      {seatrade && callStatus === CALL_STATUS.INACTIVE && !isBrowserWindowVisible && (
        <div style={{ zIndex: -1 }} className='absolute size-[180px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2'>
          <svg viewBox="0 0 156.59 157.39">
            <g fill='#ffffff'>
              <text transform="translate(71.86 13.26) rotate(3.27)"><tspan x="0" y="0">R</tspan></text>
              <text transform="translate(81 13.92) rotate(8.67)"><tspan x="0" y="0">I</tspan></text>
              <text transform="translate(85.34 14.43) rotate(14.84)"><tspan x="0" y="0">N</tspan></text>
              <text transform="translate(95.92 17.27) rotate(23.53)"><tspan x="0" y="0">G</tspan></text>
              <text transform="translate(105.79 21.8) rotate(29.43)"><tspan x="0" y="0"> </tspan></text>
              <text transform="translate(108.75 23.36) rotate(33.89)"><tspan x="0" y="0">T</tspan></text>
              <text transform="translate(115.76 28.01) rotate(41.51)"><tspan x="0" y="0">H</tspan></text>
              <text transform="translate(123.84 35.32) rotate(49.09)"><tspan x="0" y="0">E</tspan></text>
              <text transform="translate(129.29 41.79) rotate(54.01)"><tspan x="0" y="0"> </tspan></text>
              <text fill={assistantName === 'seatrade-jdx' ? '#FF7F00' : '#FFFFFF'} transform="translate(131.69 44.94) rotate(59.23)"><tspan x="0" y="0">B</tspan></text>
              <text fill={assistantName === 'seatrade-jdx' ? '#FF7F00' : '#FFFFFF'} transform="translate(136.33 52.83) rotate(66.21)"><tspan x="0" y="0">E</tspan></text>
              <text fill={assistantName === 'seatrade-jdx' ? '#FF7F00' : '#FFFFFF'} transform="translate(139.68 60.53) rotate(72.8)"><tspan x="0" y="0">L</tspan></text>
              <text fill={assistantName === 'seatrade-jdx' ? '#FF7F00' : '#FFFFFF'} transform="translate(142.04 68.23) rotate(79.26)"><tspan x="0" y="0">L</tspan></text>
            </g>
          </svg>
        </div>
      )}
      {seatrade && textPrompt &&
        <div style={{ position: 'absolute', textAlign: 'center', top: 'calc(100% + 24px)', color: assistantName === 'seatrade-jdx' ? 'var(--scg-sunset)' : '#FFFFFF' }}>
          {assistantName === 'seatrade-jdx' && <a href="sms://+17866736662?body=Hi%20Nia!">Send Nia an SMS Message</a>}
          {assistantName === 'seatrade' && <a href="sms://+14076026016?body=Hi%20Nia!">Send Nia an SMS Message</a>}
        </div>
      }
    </div>
  );
};

export { AssistantButton };
