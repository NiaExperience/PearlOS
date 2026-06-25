"use client";

import { useState, useEffect, useRef } from "react";

/**
 * useBotSpeakingDetection — Legacy audio-level-based speaking detection.
 *
 * Uses audio volume threshold analysis with a 500ms debounce to determine
 * if the bot is speaking. This is a FALLBACK only — prefer NIA bot events
 * (`isAssistantSpeaking` from VoiceSessionContext) as the authoritative source.
 *
 * @deprecated Use `isAssistantSpeaking` from `useVoiceSessionContext()` instead.
 *             This hook is retained only for environments where NIA events are unavailable.
 */
export function useBotSpeakingDetection(audioTrack: MediaStreamTrack | null): boolean {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!audioTrack) {
      setIsSpeaking(false);
      return;
    }

    const audioContext = new AudioContext();
    const stream = new MediaStream([audioTrack]);
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let animId: number;

    const THRESHOLD = 15; // audio level threshold
    const DEBOUNCE_MS = 500;

    const poll = () => {
      analyser.getByteFrequencyData(dataArray);
      const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;

      if (avg > THRESHOLD) {
        if (debounceRef.current) {
          clearTimeout(debounceRef.current);
          debounceRef.current = null;
        }
        setIsSpeaking(true);
      } else if (isSpeaking) {
        if (!debounceRef.current) {
          debounceRef.current = setTimeout(() => {
            setIsSpeaking(false);
            debounceRef.current = null;
          }, DEBOUNCE_MS);
        }
      }

      animId = requestAnimationFrame(poll);
    };

    animId = requestAnimationFrame(poll);

    return () => {
      cancelAnimationFrame(animId);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      source.disconnect();
      audioContext.close();
    };
  }, [audioTrack]);

  return isSpeaking;
}
