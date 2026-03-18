/**
 * Hook to detect bot speaking state via Web Audio API AnalyserNode
 * 
 * Uses raw Web Audio API on the bot's actual MediaStreamTrack to get
 * ground-truth audio amplitude data. This replaces Daily's broken
 * useAudioLevelObserver which reports constant ~0.7 for any 'playable' track.
 * 
 * @example
 * ```tsx
 * const audioTrack = useMediaTrack(botId, 'audio');
 * const { isSpeaking, audioLevel } = useBotSpeakingDetection(audioTrack?.track);
 * ```
 */

import { useState, useRef, useEffect, useCallback } from 'react';

import { AUDIO_DETECTION } from '../constants';

export interface BotSpeakingOptions {
  /** RMS threshold (0-1) above which participant is considered speaking */
  threshold?: number;
  
  /** Debounce delay (ms) before marking speaking as stopped */
  debounceMs?: number;
  
  /** Callback when speaking state changes */
  onSpeakingChange?: (isSpeaking: boolean) => void;
  
  /** Callback on every audio level update */
  onAudioLevel?: (level: number) => void;
}

export interface UseBotSpeakingDetectionReturn {
  /** Whether the bot is currently speaking */
  isSpeaking: boolean;
  
  /** Current audio level (0-1 range, RMS) */
  audioLevel: number;
  
  /** Ref to current audio level (for RAF-based animations) */
  audioLevelRef: React.MutableRefObject<number>;
}

/**
 * Detect bot speaking state using Web Audio API AnalyserNode on the actual audio track.
 * 
 * @param track - The bot's MediaStreamTrack (from useMediaTrack().track)
 * @param options - Configuration options
 */
export function useBotSpeakingDetection(
  track: MediaStreamTrack | undefined | null,
  options: BotSpeakingOptions = {}
): UseBotSpeakingDetectionReturn {
  const {
    threshold = AUDIO_DETECTION.SPEAKING_THRESHOLD,
    debounceMs = AUDIO_DETECTION.DEBOUNCE_MS,
    onSpeakingChange,
    onAudioLevel,
  } = options;

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const audioLevelRef = useRef(0);
  
  // Refs for managing the RAF loop and debounce without re-creating effects
  const isSpeakingRef = useRef(false);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thresholdRef = useRef(threshold);
  const debounceMsRef = useRef(debounceMs);
  const onAudioLevelRef = useRef(onAudioLevel);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  
  // Keep refs in sync
  thresholdRef.current = threshold;
  debounceMsRef.current = debounceMs;
  onAudioLevelRef.current = onAudioLevel;
  onSpeakingChangeRef.current = onSpeakingChange;

  useEffect(() => {
    if (!track || track.readyState === 'ended') return;

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let rafId: number | null = null;
    let disposed = false;

    const setup = () => {
      try {
        const ACtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!ACtor) return;

        audioContext = new ACtor();
        
        // Handle suspended AudioContext (needs user gesture)
        if (audioContext.state === 'suspended') {
          const resume = () => {
            audioContext?.resume();
            document.removeEventListener('click', resume);
            document.removeEventListener('keydown', resume);
          };
          document.addEventListener('click', resume, { once: true });
          document.addEventListener('keydown', resume, { once: true });
        }

        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048; // Good resolution for speech RMS
        analyser.smoothingTimeConstant = 0.3; // Low smoothing for responsive detection

        const stream = new MediaStream([track]);
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);
        // Do NOT connect to destination — we don't want to double-play audio

        const timeDomainData = new Uint8Array(analyser.fftSize);

        const tick = () => {
          if (disposed || !analyser) return;

          analyser.getByteTimeDomainData(timeDomainData);

          // Calculate RMS from time-domain data
          // Values are 0-255 centered at 128 (silence)
          let sumSquares = 0;
          for (let i = 0; i < timeDomainData.length; i++) {
            const normalized = (timeDomainData[i] - 128) / 128; // -1 to 1
            sumSquares += normalized * normalized;
          }
          const rms = Math.sqrt(sumSquares / timeDomainData.length);

          // Update level refs/state
          audioLevelRef.current = rms;
          setAudioLevel(rms);
          onAudioLevelRef.current?.(rms);

          // Speaking detection: instant start, debounced stop
          const aboveThreshold = rms > thresholdRef.current;

          if (aboveThreshold) {
            // Clear any pending stop
            if (stopTimeoutRef.current) {
              clearTimeout(stopTimeoutRef.current);
              stopTimeoutRef.current = null;
            }
            if (!isSpeakingRef.current) {
              isSpeakingRef.current = true;
              setIsSpeaking(true);
            }
          } else if (isSpeakingRef.current && !stopTimeoutRef.current) {
            // Start debounced stop
            stopTimeoutRef.current = setTimeout(() => {
              stopTimeoutRef.current = null;
              isSpeakingRef.current = false;
              setIsSpeaking(false);
            }, debounceMsRef.current);
          }

          rafId = requestAnimationFrame(tick);
        };

        rafId = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[BotSpeaking] Web Audio setup failed:', err);
      }
    };

    setup();

    return () => {
      disposed = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      if (stopTimeoutRef.current) {
        clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = null;
      }
      if (source) { try { source.disconnect(); } catch {} }
      if (audioContext) { try { audioContext.close(); } catch {} }
      // Reset state on cleanup
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      setAudioLevel(0);
      audioLevelRef.current = 0;
    };
  }, [track]); // Only re-setup when the track changes

  // Notify parent of speaking state changes
  useEffect(() => {
    onSpeakingChangeRef.current?.(isSpeaking);
  }, [isSpeaking]);

  return { isSpeaking, audioLevel, audioLevelRef };
}
