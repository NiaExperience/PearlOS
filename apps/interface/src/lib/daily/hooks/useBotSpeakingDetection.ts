/**
 * Hook to detect bot speaking state via Daily audio level monitoring
 * 
 * Uses Daily's native useAudioLevelObserver to monitor bot audio levels
 * and determine speaking state with configurable threshold and debouncing.
 * 
 * NOTE: This hook requires either:
 * 1. Component wrapped in DailyProvider (for video calls), OR
 * 2. Manual audio level monitoring via callObject (for voice-only sessions)
 * 
 * @example
 * ```tsx
 * // With DailyProvider (video calls)
 * const { isSpeaking, audioLevel } = useBotSpeakingDetection(botParticipantId);
 * 
 * // Without DailyProvider (voice-only)
 * const { isSpeaking } = useBotSpeakingDetection(
 *   botParticipantId,
 *   { callObject: getCallObject() }
 * );
 * ```
 */

import type { DailyCall, DailyEventObjectTrack } from '@daily-co/daily-js';
import { useAudioLevelObserver } from '@daily-co/daily-react';
import { useCallback, useState, useRef, useEffect } from 'react';

import { AUDIO_DETECTION } from '../constants';
import { getClientLogger } from '../../client-logger';

export interface BotSpeakingOptions {
  /** Audio level threshold (0-1) above which participant is considered speaking */
  threshold?: number;
  
  /** Debounce delay (ms) before marking speaking as stopped */
  debounceMs?: number;
  
  /** Throttle delay (ms) for audio callbacks to reduce CPU load (optional) */
  throttleMs?: number;
  
  /** Callback when speaking state changes */
  onSpeakingChange?: (isSpeaking: boolean) => void;
  
  /** Callback on every audio level update (after throttling if configured) */
  onAudioLevel?: (level: number) => void;
  
  /** 
   * Daily call object for manual audio monitoring (voice-only sessions without DailyProvider)
   * If provided, uses manual polling instead of useAudioLevelObserver
   */
  callObject?: DailyCall | null;
}

export interface UseBotSpeakingDetectionReturn {
  /** Whether the bot is currently speaking */
  isSpeaking: boolean;
  
  /** Current audio level (0-1 range) */
  audioLevel: number;
  
  /** Ref to current audio level (for RAF-based animations) */
  audioLevelRef: React.MutableRefObject<number>;
}

const log = getClientLogger('[daily_bot_speaking]');

/**
 * Hook to detect bot speaking state via audio level monitoring
 * 
 * @param participantId - Daily participant ID (session_id) of the bot
 * @param options - Configuration options for detection behavior
 * @returns Object with isSpeaking state, audioLevel, and audioLevelRef
 */
export function useBotSpeakingDetection(
  participantId: string,
  options: BotSpeakingOptions = {}
): UseBotSpeakingDetectionReturn {
  const {
    threshold = AUDIO_DETECTION.SPEAKING_THRESHOLD,
    debounceMs = AUDIO_DETECTION.DEBOUNCE_MS,
    throttleMs = 0,
    onSpeakingChange,
    onAudioLevel,
    callObject,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelRef = useRef(0);
  const speakingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallbackTimeRef = useRef(0);
  const lastUpdateRef = useRef(0);

  const handleAudioLevel = useCallback((level: number) => {
    // Throttling (if enabled, for components with multiple participants like Tile.tsx)
    if (throttleMs > 0) {
      const now = Date.now();
      if (now - lastCallbackTimeRef.current < throttleMs) {
        audioLevelRef.current = level;
        return;
      }
      lastCallbackTimeRef.current = now;
    }

    // Update audio level state and ref
    setAudioLevel(level);
    audioLevelRef.current = level;
    
    // Call optional audio level callback
    onAudioLevel?.(level);

    // Update timestamp for lipsync animations (if needed)
    const now = Date.now();
    if (now - lastUpdateRef.current > AUDIO_DETECTION.LIPSYNC_UPDATE_MS) {
      lastUpdateRef.current = now;
    }

    // Speaking detection with threshold
    const shouldBeSpeaking = level > threshold;

    if (shouldBeSpeaking && !isSpeaking) {
      // Start speaking immediately
      setIsSpeaking(true);
      // Clear any pending stop timeout
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
    } else if (!shouldBeSpeaking && isSpeaking) {
      // Stop speaking with debounce to smooth out brief gaps
      if (!speakingTimeoutRef.current) {
        speakingTimeoutRef.current = setTimeout(() => {
          setIsSpeaking(false);
          speakingTimeoutRef.current = null;
        }, debounceMs);
      }
    }
  }, [isSpeaking, threshold, debounceMs, throttleMs, onAudioLevel]);

  // Use Daily's native audio level observer (if in DailyProvider context)
  useAudioLevelObserver(participantId || '', handleAudioLevel);

  // Manual audio monitoring for voice-only sessions (no DailyProvider)
  useEffect(() => {
    if (!callObject || !participantId) {
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let microphone: MediaStreamAudioSourceNode | null = null;
    let rafId: number | null = null;
    let isSetup = false;

    const setupAudioMonitoring = () => {
      // Prevent duplicate setup
      if (isSetup) return;

      try {
        const participants = callObject.participants();
        const participant = participants?.[participantId];
        
        if (!participant) return;

        // Get audio track
        const audioTrack = participant.tracks?.audio;
        
        if (!audioTrack?.track || audioTrack.state !== 'playable') {
          return;
        }

        // Mark as setup to prevent duplicates
        isSetup = true;
        
        // Create Web Audio API context for actual audio level analysis
        const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        
        audioContext = new AudioContextClass();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        // Connect audio track to analyser
        const stream = new MediaStream([audioTrack.track]);
        microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        // Poll audio levels using requestAnimationFrame
        const checkAudioLevel = () => {
          if (!analyser) return;

          analyser.getByteFrequencyData(dataArray);
          
          // Calculate average audio level (0-255 range)
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const average = sum / dataArray.length;
          
          // Normalize to 0-1 range
          const normalizedLevel = average / 255;
          
          // Pass to audio level handler
          handleAudioLevel(normalizedLevel);

          // Continue monitoring
          rafId = requestAnimationFrame(checkAudioLevel);
        };

        checkAudioLevel();
      } catch (error) {
        log.error('Error setting up audio monitoring', { error });
      }
    };

    // Setup monitoring when participant track is ready
    setupAudioMonitoring();

    // Also listen for track-started event - fires when track becomes playable
    const handleTrackStarted = (event?: DailyEventObjectTrack) => {
      // Only setup if this is our bot participant's audio track
      if (event?.participant?.session_id === participantId && event?.track?.kind === 'audio') {
        // Small delay to ensure track object is fully propagated
        setTimeout(() => {
          setupAudioMonitoring();
        }, 100);
      }
    };

    callObject.on('track-started', handleTrackStarted);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (microphone) microphone.disconnect();
      if (audioContext) audioContext.close();
      callObject.off('track-started', handleTrackStarted);
    };
  }, [callObject, participantId, handleAudioLevel]);

  // Notify parent of speaking state changes
  useEffect(() => {
    onSpeakingChange?.(isSpeaking);
  }, [isSpeaking, onSpeakingChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
      }
    };
  }, []);

  return { isSpeaking, audioLevel, audioLevelRef };
}
