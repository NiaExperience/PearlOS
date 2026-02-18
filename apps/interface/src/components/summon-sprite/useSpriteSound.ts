import { useCallback } from 'react';

/**
 * Programmatic sound effects using Web Audio API.
 * Uses a singleton AudioContext to avoid leaking contexts on repeated mounts
 * (browsers limit to ~6 concurrent AudioContexts).
 */

let _sharedCtx: AudioContext | null = null;

function getSharedAudioContext(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  // Resume if suspended (e.g. after autoplay policy)
  if (_sharedCtx.state === 'suspended') {
    _sharedCtx.resume();
  }
  return _sharedCtx;
}

export function useSpriteSound() {
  /** Soft "bloop" for message received */
  const playBloop = useCallback(() => {
    try {
      const ctx = getSharedAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.15);
    } catch {
      // Silently fail if audio isn't available
    }
  }, []);

  /** Sparkle sound for interactions */
  const playSparkle = useCallback(() => {
    try {
      const ctx = getSharedAudioContext();
      // Two quick ascending tones
      for (let i = 0; i < 2; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.06;
        osc.frequency.setValueAtTime(800 + i * 400, t);
        osc.frequency.exponentialRampToValueAtTime(1200 + i * 400, t + 0.08);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

        osc.start(t);
        osc.stop(t + 0.1);
      }
    } catch {
      // Silently fail
    }
  }, []);

  /** Dismiss sound — descending whoosh */
  const playDismiss = useCallback(() => {
    try {
      const ctx = getSharedAudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.3);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Silently fail
    }
  }, []);

  /** Summon chime — ascending magical tone */
  const playSummonChime = useCallback(() => {
    try {
      const ctx = getSharedAudioContext();
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.08;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

        osc.start(t);
        osc.stop(t + 0.3);
      });
    } catch {
      // Silently fail
    }
  }, []);

  return { playBloop, playSparkle, playDismiss, playSummonChime };
}
