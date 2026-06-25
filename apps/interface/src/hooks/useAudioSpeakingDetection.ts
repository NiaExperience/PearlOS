"use client";

import { useState, useEffect, useRef } from "react";

/**
 * useAudioSpeakingDetection — Web Audio API-based speaking detection.
 *
 * Analyzes actual audio output levels from a MediaStreamTrack using an
 * AnalyserNode. This is the AUTHORITATIVE source for bot speaking state
 * because it reflects what the user actually hears, not metadata events.
 *
 * Design decisions to prevent the recurring lip sync bugs:
 *
 * 1. THROTTLED STATE UPDATES — poll at ~15fps (not 60fps via rAF) and only
 *    call setState when isSpeaking ACTUALLY CHANGES. Volume updates are
 *    throttled to ~4fps. This prevents render thrashing that caused the
 *    jittery animation behavior.
 *
 * 2. HYSTERESIS — separate start threshold (18) and stop threshold (6) to
 *    prevent flicker at the boundary. Must clearly exceed start to begin
 *    speaking, must clearly drop below stop to end.
 *
 * 3. GENEROUS STOP DEBOUNCE (350ms) — natural speech has pauses of 200-500ms
 *    between words. The previous 200ms debounce caused the avatar to flicker
 *    off during breath pauses mid-sentence. 350ms bridges word gaps while
 *    still stopping promptly after actual end of speech.
 *
 * 4. LOW SMOOTHING (0.05) — minimizes temporal smearing in the analyser so
 *    we detect actual audio start/stop quickly, not a smoothed average that
 *    lags behind reality.
 *
 * 5. REFS FOR MUTABLE STATE — all fast-changing values (isSpeaking flag,
 *    timers) are refs, not state. State is only set on actual transitions.
 */

interface AudioSpeakingState {
  isSpeaking: boolean;
  volumeLevel: number; // 0-1 normalized
}

export function useAudioSpeakingDetection(
  audioTrack: MediaStreamTrack | null | undefined
): AudioSpeakingState {
  const [state, setState] = useState<AudioSpeakingState>({
    isSpeaking: false,
    volumeLevel: 0,
  });

  // Refs for mutable state — never cause re-renders, no stale closures
  const isSpeakingRef = useRef(false);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastVolumeUpdateRef = useRef(0); // timestamp of last volume setState

  useEffect(() => {
    if (!audioTrack || audioTrack.readyState === "ended") {
      if (isSpeakingRef.current) {
        isSpeakingRef.current = false;
        setState({ isSpeaking: false, volumeLevel: 0 });
      }
      return;
    }

    let audioContext: AudioContext;
    try {
      audioContext = new AudioContext();
    } catch {
      console.warn("[useAudioSpeakingDetection] AudioContext not available");
      return;
    }

    const stream = new MediaStream([audioTrack]);
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.05; // minimal smoothing for fast response
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let intervalId: ReturnType<typeof setInterval>;
    let disposed = false;

    // Hysteresis thresholds
    const START_THRESHOLD = 18;
    const STOP_THRESHOLD = 6;
    const STOP_DEBOUNCE_MS = 350; // bridges natural speech pauses
    const VOLUME_THROTTLE_MS = 250; // update volume state at ~4fps max

    const poll = () => {
      if (disposed) return;

      analyser.getByteFrequencyData(dataArray);

      // RMS for stable level measurement
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSq += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sumSq / dataArray.length);
      const normalizedLevel = Math.min(rms / 128, 1);

      const wasSpeaking = isSpeakingRef.current;

      if (!wasSpeaking && rms > START_THRESHOLD) {
        // ── START SPEAKING ──
        // Cancel any pending stop (shouldn't exist, but defensive)
        if (stopTimerRef.current) {
          clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
        }
        isSpeakingRef.current = true;
        setState({ isSpeaking: true, volumeLevel: normalizedLevel });
        lastVolumeUpdateRef.current = Date.now();

      } else if (wasSpeaking && rms < STOP_THRESHOLD) {
        // ── SCHEDULE STOP (debounced) ──
        // Only schedule if not already scheduled
        if (!stopTimerRef.current) {
          stopTimerRef.current = setTimeout(() => {
            if (!disposed) {
              isSpeakingRef.current = false;
              setState({ isSpeaking: false, volumeLevel: 0 });
            }
            stopTimerRef.current = null;
          }, STOP_DEBOUNCE_MS);
        }
        // No volume state update here — the debounce timer handles the transition

      } else if (wasSpeaking && rms >= STOP_THRESHOLD) {
        // ── STILL SPEAKING ──
        // Cancel any pending stop
        if (stopTimerRef.current) {
          clearTimeout(stopTimerRef.current);
          stopTimerRef.current = null;
        }
        // Throttled volume update (only for visualization, not for isSpeaking)
        const now = Date.now();
        if (now - lastVolumeUpdateRef.current >= VOLUME_THROTTLE_MS) {
          setState({ isSpeaking: true, volumeLevel: normalizedLevel });
          lastVolumeUpdateRef.current = now;
        }
      }
      // else: !wasSpeaking && rms <= START_THRESHOLD — silence, do nothing
    };

    // Start polling and audio context
    const startPolling = () => {
      if (disposed) return;
      // Poll at ~15fps — more than enough for speech detection
      intervalId = setInterval(poll, 66);
    };

    if (audioContext.state === "suspended") {
      audioContext.resume().then(startPolling);
    } else {
      startPolling();
    }

    // Handle track ending mid-session
    const onTrackEnded = () => {
      if (!disposed) {
        isSpeakingRef.current = false;
        setState({ isSpeaking: false, volumeLevel: 0 });
      }
    };
    audioTrack.addEventListener("ended", onTrackEnded);

    return () => {
      disposed = true;
      clearInterval(intervalId);
      audioTrack.removeEventListener("ended", onTrackEnded);
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
        stopTimerRef.current = null;
      }
      isSpeakingRef.current = false;
      source.disconnect();
      analyser.disconnect();
      audioContext.close().catch(() => {});
    };
  }, [audioTrack]);

  return state;
}
