'use client';

import { useSession } from 'next-auth/react';
import { usePostHog } from 'posthog-js/react';
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

import { useVoiceSessionContext } from '@interface/contexts/voice-session-context';
import { getClientLogger } from '@interface/lib/client-logger';

import type { SoundtrackControlDetail } from '../lib/events';
import { SOUNDTRACK_TRACKS, shuffleTracks } from '../lib/tracks';
import type { SoundtrackContextValue } from '../types/soundtrack-types';

export const SoundtrackContext = createContext<SoundtrackContextValue | null>(null);

const DEFAULT_NORMAL_VOLUME = 0.1;
const DUCKED_VOLUME_RATIO = 0.5; // Duck to 50% of base volume when speaking

// iOS Safari has significantly higher audio output gain than desktop browsers.
// IMPORTANT: HTMLMediaElement.volume is READ-ONLY on iOS Safari — setting audio.volume
// has NO EFFECT. We must use Web Audio API GainNode to control volume on iOS.
// See: https://developer.apple.com/documentation/webkitjs/htmlmediaelement/1629801-volume
//      https://github.com/mdn/browser-compat-data/issues/13554
const IOS_VOLUME_REDUCER = 0.35; // Reduce iOS volume to 35% of desktop equivalent

/**
 * Detect if the current browser is iOS Safari (iPhone, iPad, iPod).
 */
function isIOSSafari(): boolean {
  if (typeof window === 'undefined') return false;
  
  const ua = window.navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebKit = /WebKit/.test(ua);
  const isNotChrome = !/CriOS|Chrome/.test(ua); // Exclude Chrome on iOS
  
  return isIOS && isWebKit && isNotChrome;
}

/**
 * Apply exponential volume scaling so low slider percentages produce
 * genuinely quiet output.  Linear 0-1 mapping makes 5% far too loud
 * because human hearing is logarithmic.  Using x^3 curve:
 *   5% slider  → 0.000125 actual volume  (practically silent)
 *   10% slider → 0.001
 *   25% slider → 0.0156
 *   50% slider → 0.125
 *  100% slider → 1.0
 *
 * NOTE: Does NOT apply iOS reduction here — that is handled in setEffectiveGain()
 * via the Web Audio API GainNode (the only mechanism that works on iOS Safari).
 */
function applyVolumeScaling(linear: number): number {
  return Math.pow(Math.max(0, Math.min(1, linear)), 3);
}
const VOLUME_STORAGE_KEY = 'nia:soundtrack:baseVolume';

/**
 * Initialize the Web Audio API pipeline for an audio element.
 *
 * On iOS Safari, HTMLMediaElement.volume is read-only and cannot be set
 * programmatically. The Web Audio API GainNode is the ONLY reliable way to
 * control audio volume on iOS. This function wires:
 *   audio element → MediaElementSourceNode → GainNode → AudioContext.destination
 *
 * Safe to call multiple times (no-op after first successful init).
 * AudioContext starts in `suspended` state on iOS; resume it after a user gesture.
 *
 * @returns true if initialization succeeded
 */
function initWebAudio(
  audio: HTMLAudioElement,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
  gainNodeRef: React.MutableRefObject<GainNode | null>,
  webAudioReadyRef: React.MutableRefObject<boolean>,
  logger: ReturnType<typeof getClientLogger>
): boolean {
  if (webAudioReadyRef.current) return true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as (typeof AudioContext) | undefined;
    if (!AC) {
      logger.warn('[WebAudio] AudioContext not available');
      return false;
    }
    const ctx = new AC();
    const source = ctx.createMediaElementSource(audio);
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);
    audioContextRef.current = ctx;
    gainNodeRef.current = gain;
    webAudioReadyRef.current = true;
    logger.info('[WebAudio] GainNode pipeline initialized for iOS volume control', {
      contextState: ctx.state,
    });
    return true;
  } catch (err) {
    logger.warn('[WebAudio] Initialization failed — falling back to audio.volume', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Apply a scaled volume value to the correct target:
 *  - iOS Safari: Web Audio API GainNode (audio.volume is read-only on iOS)
 *  - Desktop/other: HTMLMediaElement.volume (works reliably)
 *
 * @param scaledVolume  Output of applyVolumeScaling() — already x^3 scaled (0..1)
 * @param audio         The HTMLAudioElement (used for desktop fallback)
 * @param gainNodeRef   GainNode ref (used on iOS)
 * @param audioContextRef AudioContext ref (used to resume if suspended on iOS)
 * @param isIOS         Whether we're on iOS Safari
 */
function setEffectiveGain(
  scaledVolume: number,
  audio: HTMLAudioElement,
  gainNodeRef: React.MutableRefObject<GainNode | null>,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
  isIOS: boolean
): void {
  if (isIOS && gainNodeRef.current && audioContextRef.current) {
    // Apply iOS-specific volume reduction through GainNode.
    // This is the ONLY mechanism that actually works on iOS Safari.
    const iosGain = scaledVolume * IOS_VOLUME_REDUCER;
    gainNodeRef.current.gain.value = iosGain;
    // Resume AudioContext if it was suspended (iOS requires user gesture to resume)
    if (audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => { /* ignore */ });
    }
  } else {
    // Desktop: audio.volume works correctly
    audio.volume = scaledVolume;
  }
}

export function SoundtrackProvider({ children }: { children: React.ReactNode }) {
  const logger = useRef(getClientLogger('SoundtrackProvider')).current;
  const didLogMount = useRef(false);
  const { data: session, status: sessionStatus } = useSession();

  useEffect(() => {
    if (didLogMount.current) return;
    if (sessionStatus === 'loading') return;

    const sessionUser = (session?.user as Record<string, unknown>) || {};
    const sessionId = (session as Record<string, unknown> | null | undefined)?.sessionId as string | undefined;
    const userScopedSessionId = (sessionUser as Record<string, unknown>).sessionId as string | undefined;

    logger.info('SoundtrackProvider mounted', {
      sessionId: sessionId || userScopedSessionId || null,
      userId: (sessionUser as Record<string, unknown>).id as string | null ?? null,
      userName: (sessionUser as Record<string, unknown>).name as string | null ?? null,
      platform: isIOSSafari() ? 'iOS Safari' : 'desktop/other',
      volumeMethod: isIOSSafari() ? `Web Audio GainNode (reducer: ${IOS_VOLUME_REDUCER}x)` : 'HTMLMediaElement.volume',
    });
    didLogMount.current = true;
  }, [logger, session, sessionStatus]);
  const posthog = usePostHog();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio API refs — used on iOS Safari where HTMLMediaElement.volume is read-only.
  // On iOS, all volume control goes through the GainNode instead of audio.volume.
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const webAudioReadyRef = useRef(false);
  const { isUserSpeaking, isAssistantSpeaking } = useVoiceSessionContext(); // Get speech state from context
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  
  // Initialize with SSR-safe default; load from localStorage in useEffect to avoid hydration mismatch.
  const [baseVolume, setBaseVolume] = useState(DEFAULT_NORMAL_VOLUME);
  
  // Current volume (may be ducked during speech)
  const [volume, setVolume] = useState(baseVolume);
  const [shuffledTracks] = useState(() => shuffleTracks(SOUNDTRACK_TRACKS));
  
  // Track local speaking state from Daily events for responsive volume ducking
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Track if music was playing before forum opened (for auto-restart)
  const wasPlayingBeforeForumRef = useRef(false);
  
  // Track if music was playing before YouTube opened (for auto-restart)
  const wasPlayingBeforeYouTubeRef = useRef(false);
  
  // Ref to track current playing state for forum/YouTube event handlers (avoid stale closures)
  const isPlayingRef = useRef(isPlaying);
  
  // Track last non-zero volume to restore when stopping with 0% volume
  const lastNonZeroVolumeRef = useRef<number | null>(null);

  // Load base volume from localStorage after hydration (SSR-safe)
  const volumeLoadedRef = useRef(false);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
      if (stored !== null) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
          setBaseVolume(parsed);
        }
      }
    } catch (e) {
      logger.warn('Failed to load volume from localStorage', { error: e });
    }
    volumeLoadedRef.current = true;
  }, []);

  // Save base volume to localStorage whenever it changes (skip initial default)
  useEffect(() => {
    if (!volumeLoadedRef.current) return;
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, baseVolume.toString());
    } catch (e) {
      logger.warn('Failed to save volume to localStorage', { error: e });
    }
  }, [baseVolume]);

  // Initialize audio element
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const audio = new Audio();
    audio.loop = false; // We'll handle looping manually to track endings
    // playsInline is required for iOS Safari to allow audio playback
    audio.setAttribute('playsinline', 'true');
    audio.setAttribute('preload', 'auto');
    audioRef.current = audio;

    // Initialize Web Audio API pipeline for iOS volume control.
    // On iOS Safari, HTMLMediaElement.volume is read-only and ignored — we MUST
    // route audio through a GainNode to achieve any volume reduction.
    // Safe to call on all platforms; no-ops gracefully on desktop.
    const isiOS = isIOSSafari();
    if (isiOS) {
      initWebAudio(audio, audioContextRef, gainNodeRef, webAudioReadyRef, logger);
    }

    // Set initial volume via the appropriate mechanism
    const initialScaled = applyVolumeScaling(baseVolume || DEFAULT_NORMAL_VOLUME);
    setEffectiveGain(initialScaled, audio, gainNodeRef, audioContextRef, isiOS);

    // Handle track ending
    const handleEnded = () => {
      setCurrentTrackIndex((prev) => (prev + 1) % shuffledTracks.length);
    };

    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      audio.src = '';
      // Clean up Web Audio API resources
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => { /* ignore */ });
        audioContextRef.current = null;
        gainNodeRef.current = null;
        webAudioReadyRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shuffledTracks.length]);

  // Load and play current track
  // NOTE: baseVolume/speaking state intentionally excluded from deps — volume changes
  // are handled by the separate ducking useEffect. Including them here would re-set
  // audio.src and restart the song every time volume changes.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !isPlaying) return;

    const track = shuffledTracks[currentTrackIndex];
    if (!track) return;

    // Set initial volume before playing
    const isiOS = isIOSSafari();
    setEffectiveGain(applyVolumeScaling(baseVolume), audio, gainNodeRef, audioContextRef, isiOS);

    audio.src = track.path;
    audio.load();
    
    const attemptPlay = (origin: string) => {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setAutoplayBlocked(false);
            logger.info('Soundtrack playback started', { 
              title: track.title, 
              artist: track.artist,
              origin,
            });
          })
          .catch((error) => {
            setAutoplayBlocked(true);
            logger.warn('Soundtrack playback blocked (autoplay restriction)', { 
              error: error instanceof Error ? error.message : String(error),
              title: track.title,
              artist: track.artist,
              origin,
              hint: 'User interaction may be required on mobile devices'
            });
            // Don't set isPlaying to false - keep it true so we can retry on user interaction
          });
      }
    };
    
    attemptPlay('initial');
    
    // Retry after delay if still paused (helps with some mobile browsers)
    const retryTimeout = setTimeout(() => {
      if (audio.paused && isPlaying) {
        attemptPlay('retry-delay');
      }
    }, 500);
    
    return () => {
      clearTimeout(retryTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackIndex, isPlaying, shuffledTracks, logger]);

  // Listen for Daily.co audio level events for responsive volume ducking
  useEffect(() => {
    const handleAudioLevel = (event: Event) => {
      const { detail } = event as CustomEvent<{ 
        botParticipantId: string; 
        level: number; 
        isSpeaking: boolean;
      }>;
      
      if (detail) {
        setIsSpeaking(detail.isSpeaking);
      }
    };

    window.addEventListener('daily:audioLevel', handleAudioLevel as EventListener);

    return () => {
      window.removeEventListener('daily:audioLevel', handleAudioLevel as EventListener);
    };
  }, []);

  // Keep isPlayingRef in sync with isPlaying state
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Track last non-zero volume whenever baseVolume changes
  useEffect(() => {
    if (baseVolume > 0) {
      lastNonZeroVolumeRef.current = baseVolume;
    }
  }, [baseVolume]);

  // Volume ducking based on speech state (from context or events)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const speaking = isUserSpeaking || isAssistantSpeaking || isSpeaking;
    const targetVolume = speaking ? baseVolume * DUCKED_VOLUME_RATIO : baseVolume;
    setEffectiveGain(applyVolumeScaling(targetVolume), audio, gainNodeRef, audioContextRef, isIOSSafari());
    setVolume(targetVolume);
  }, [isUserSpeaking, isAssistantSpeaking, isSpeaking, baseVolume]);

  // Speech state is now managed by SpeechProvider via Pipecat bot events

  // Auto-start soundtrack on mount at low volume.
  // If autoplay is blocked (most browsers), queue for first user gesture.
  const didAttemptAutoStart = useRef(false);
  useEffect(() => {
    if (didAttemptAutoStart.current) return;
    didAttemptAutoStart.current = true;

    // Auto-start playback
    setIsPlaying(true);
    logger.info('Soundtrack auto-start attempted on mount');
  }, [logger]);

  // Autoplay recovery: when autoplay was blocked, unlock on ANY user gesture
  // (touch/click/pointerdown). This handles both iOS Safari and desktop browsers
  // that block autoplay. The soundtrack starts on first tap anywhere on the page.
  useEffect(() => {
    if (!autoplayBlocked || !isPlaying) return;

    const unlockAudio = () => {
      const audio = audioRef.current;
      // Resume Web Audio API context on iOS (required after user gesture)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume().catch(() => { /* ignore */ });
      }
      // Also ensure Web Audio pipeline is initialized (may have been blocked earlier)
      if (isIOSSafari() && audio && !webAudioReadyRef.current) {
        initWebAudio(audio, audioContextRef, gainNodeRef, webAudioReadyRef, logger);
      }
      if (audio && audio.paused && isPlayingRef.current) {
        audio.play()
          .then(() => {
            setAutoplayBlocked(false);
            logger.info('Soundtrack playback unlocked by user gesture');
            // Remove all listeners after successful unlock
            cleanup();
          })
          .catch((error) => {
            logger.warn('Soundtrack playback still blocked after user gesture', {
              error: error instanceof Error ? error.message : String(error)
            });
          });
      }
    };

    const events = ['touchstart', 'click', 'pointerdown', 'keydown'];
    events.forEach(evt => window.addEventListener(evt, unlockAudio, { once: false, passive: true }));

    // Also listen for explicit bot play commands
    const handleBotPlay = (event: Event) => {
      const customEvent = event as CustomEvent<SoundtrackControlDetail>;
      if (customEvent.detail?.action === 'play') {
        unlockAudio();
      }
    };
    window.addEventListener('soundtrackControl', handleBotPlay);

    const cleanup = () => {
      events.forEach(evt => window.removeEventListener(evt, unlockAudio));
      window.removeEventListener('soundtrackControl', handleBotPlay);
    };

    return cleanup;
  }, [autoplayBlocked, isPlaying, logger]);

  // Listen for soundtrack control events
  useEffect(() => {
    logger.info('Setting up soundtrackControl event listener');
    const handleSoundtrackControl = (event: Event) => {
      const customEvent = event as CustomEvent<SoundtrackControlDetail>;
      const { action, volume: targetVolume, direction, step = 0.05 } = customEvent.detail || {};

      logger.debug('Soundtrack control received', { action, detail: customEvent.detail });

      switch (action) {
        case 'play':
          setIsPlaying(true);
          posthog?.capture('soundtrack_play', { source: 'event' });
          logger.info('Soundtrack started', { source: 'event' });
          break;
        case 'stop':
          setIsPlaying(false);
          posthog?.capture('soundtrack_stop', { source: 'event' });
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
          // If volume is 0%, restore to last non-zero volume to prevent 0% from persisting to next session
          if (baseVolume === 0 && lastNonZeroVolumeRef.current !== null) {
            setBaseVolume(lastNonZeroVolumeRef.current);
            logger.info('Volume was 0% when stopping, restored to last non-zero volume', { 
              restoredVolume: Math.round(lastNonZeroVolumeRef.current * 100) 
            });
          } else if (baseVolume === 0 && lastNonZeroVolumeRef.current === null) {
            // Fallback to default if no previous non-zero volume was tracked
            setBaseVolume(DEFAULT_NORMAL_VOLUME);
            logger.info('Volume was 0% when stopping, restored to default (no previous non-zero volume)', { 
              restoredVolume: Math.round(DEFAULT_NORMAL_VOLUME * 100) 
            });
          }
          logger.info('Soundtrack stopped', { source: 'event' });
          break;
        case 'next':
          setCurrentTrackIndex((prev) => (prev + 1) % shuffledTracks.length);
          posthog?.capture('soundtrack_next', { source: 'event' });
          logger.info('Next track', { source: 'event' });
          break;
        case 'volume':
          if (targetVolume !== undefined) {
            const clampedVolume = Math.max(0, Math.min(1, targetVolume));
            setBaseVolume(clampedVolume);
            posthog?.capture('soundtrack_volume_set', { source: 'event', volume: clampedVolume });
            logger.info('Volume set', { source: 'event', volume: Math.round(clampedVolume * 100) });
          }
          break;
        case 'adjustVolume':
          if (direction === 'increase' || direction === 'decrease') {
            const clampedStep = Math.max(0, Math.min(1, step));
            setBaseVolume((prevBaseVolume) => {
              const newBaseVolume = direction === 'increase'
                ? Math.min(1, prevBaseVolume + clampedStep)
                : Math.max(0, prevBaseVolume - clampedStep);
              
              posthog?.capture('soundtrack_volume_adjusted', { 
                source: 'event', 
                direction, 
                step: clampedStep,
                newVolume: newBaseVolume 
              });
              logger.info('Volume adjusted', {
                source: 'event',
                direction,
                step: clampedStep,
                volume: Math.round(newBaseVolume * 100),
              });
              
              return newBaseVolume;
            });
          }
          break;
        default:
          logger.warn('Unknown soundtrack control action', { action });
      }
    };

    window.addEventListener('soundtrackControl', handleSoundtrackControl);

    return () => {
      window.removeEventListener('soundtrackControl', handleSoundtrackControl);
    };
  }, [shuffledTracks.length, posthog, logger, baseVolume]);

  // Listen for forum (DailyCall) and YouTube window open/close events to auto-stop/restart music
  useEffect(() => {
    const handleForumOpen = () => {
      // Store current playing state before stopping (use ref to avoid stale closure)
      wasPlayingBeforeForumRef.current = isPlayingRef.current;
      if (isPlayingRef.current) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        logger.info('Soundtrack auto-stopped due to forum window opening');
      }
    };

    const handleForumClose = () => {
      // Restart music if it was playing before forum opened
      if (wasPlayingBeforeForumRef.current) {
        setIsPlaying(true);
        wasPlayingBeforeForumRef.current = false;
        logger.info('Soundtrack auto-restarted after forum window closed');
      }
    };

    const handleYouTubeOpen = () => {
      // Store current playing state before stopping (use ref to avoid stale closure)
      wasPlayingBeforeYouTubeRef.current = isPlayingRef.current;
      if (isPlayingRef.current) {
        setIsPlaying(false);
        if (audioRef.current) {
          audioRef.current.pause();
        }
        logger.info('Soundtrack auto-stopped due to YouTube window opening');
      }
    };

    const handleYouTubeClose = () => {
      // Restart music if it was playing before YouTube opened
      if (wasPlayingBeforeYouTubeRef.current) {
        setIsPlaying(true);
        wasPlayingBeforeYouTubeRef.current = false;
        logger.info('Soundtrack auto-restarted after YouTube window closed');
      }
    };

    // Listen for window lifecycle events for forum (dailyCall viewType) and YouTube
    const handleWindowOpen = (event: Event) => {
      const customEvent = event as CustomEvent<{ viewType?: string } | undefined>;
      const detail = customEvent.detail;
      if (detail?.viewType === 'dailyCall') {
        handleForumOpen();
      } else if (detail?.viewType === 'youtube') {
        handleYouTubeOpen();
      }
    };

    const handleWindowClose = (event: Event) => {
      const customEvent = event as CustomEvent<{ viewType?: string } | undefined>;
      const detail = customEvent.detail;
      if (detail?.viewType === 'dailyCall') {
        handleForumClose();
      } else if (detail?.viewType === 'youtube') {
        handleYouTubeClose();
      }
    };

    // Using string-based event names to avoid import issues
    window.addEventListener('nia.window.open-request', handleWindowOpen as EventListener);
    window.addEventListener('nia.window.close-request', handleWindowClose as EventListener);

    return () => {
      window.removeEventListener('nia.window.open-request', handleWindowOpen as EventListener);
      window.removeEventListener('nia.window.close-request', handleWindowClose as EventListener);
    };
  }, [logger]);

  const play = useCallback(() => {
    setIsPlaying(true);
    posthog?.capture('soundtrack_play', { source: 'ui' });
  }, []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    posthog?.capture('soundtrack_stop', { source: 'ui' });
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    // If volume is 0%, restore to last non-zero volume to prevent 0% from persisting to next session
    if (baseVolume === 0 && lastNonZeroVolumeRef.current !== null) {
      setBaseVolume(lastNonZeroVolumeRef.current);
      logger.info('Volume was 0% when stopping, restored to last non-zero volume', { 
        restoredVolume: Math.round(lastNonZeroVolumeRef.current * 100) 
      });
    } else if (baseVolume === 0 && lastNonZeroVolumeRef.current === null) {
      // Fallback to default if no previous non-zero volume was tracked
      setBaseVolume(DEFAULT_NORMAL_VOLUME);
      logger.info('Volume was 0% when stopping, restored to default (no previous non-zero volume)', { 
        restoredVolume: Math.round(DEFAULT_NORMAL_VOLUME * 100) 
      });
    }
  }, [baseVolume, logger]);

  const next = useCallback(() => {
    setCurrentTrackIndex((prev) => (prev + 1) % shuffledTracks.length);
    posthog?.capture('soundtrack_next', { source: 'ui' });
  }, [shuffledTracks.length]);

  const getCurrentTrack = useCallback(() => {
    const track = shuffledTracks[currentTrackIndex];
    if (!track) return null;
    return { title: track.title, artist: track.artist };
  }, [currentTrackIndex, shuffledTracks]);

  // Broadcast soundtrack state to bot gateway for bot_get_current_soundtrack tool
  useEffect(() => {
    const track = shuffledTracks[currentTrackIndex];
    const state = {
      is_playing: isPlaying,
      track_title: track?.title ?? null,
      track_artist: track?.artist ?? null,
    };

    // Fire-and-forget POST to gateway
    const gatewayBase = typeof window !== 'undefined'
      ? (() => {
          const host = window.location.hostname;
          const proto = window.location.protocol;
          // RunPod proxy rewrite
          const runpodMatch = host.match(/^(.+)-\d+(\.proxy\.runpod\.net)$/);
          if (runpodMatch) return `${proto}//${runpodMatch[1]}-4444${runpodMatch[2]}`;
          if (host !== 'localhost' && host !== '127.0.0.1') return `${proto}//${window.location.host}/gateway`;
          return `${proto}//${host}:4444`;
        })()
      : null;

    if (gatewayBase) {
      fetch(`${gatewayBase}/api/soundtrack/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      }).catch(() => { /* ignore */ });
    }
  }, [isPlaying, currentTrackIndex, shuffledTracks]);

  const value: SoundtrackContextValue = {
    isPlaying,
    currentTrackIndex,
    volume,
    baseVolume,
    isSpeaking: isUserSpeaking || isAssistantSpeaking || isSpeaking,
    autoplayBlocked,
    play,
    stop,
    next,
    getCurrentTrack,
    setBaseVolume,
  };

  return (
    <SoundtrackContext.Provider value={value}>
      {children}
    </SoundtrackContext.Provider>
  );
}

export function useSoundtrack(): SoundtrackContextValue {
  const context = useContext(SoundtrackContext);
  if (!context) {
    throw new Error('useSoundtrack must be used within SoundtrackProvider');
  }
  return context;
}

