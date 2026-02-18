import { useState, useEffect, useCallback, useRef } from 'react';

export type SpriteAnimationState =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'thinking'
  | 'summoning'
  | 'dismissing';

interface UseSpriteStateOptions {
  isVoiceActive: boolean;
  isAssistantSpeaking: boolean;
  isLoading: boolean;
  hasSprite: boolean;
  activeSpriteVoice: boolean;
}

/**
 * Animation state machine for sprite lifecycle.
 * Derives the current animation state from voice/loading/presence signals.
 */
export function useSpriteState({
  isVoiceActive,
  isAssistantSpeaking,
  isLoading,
  hasSprite,
  activeSpriteVoice,
}: UseSpriteStateOptions) {
  const [state, setState] = useState<SpriteAnimationState>('idle');
  const [hasSummoned, setHasSummoned] = useState(false);
  const prevHasSpriteRef = useRef(hasSprite);
  const summonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect summoning: sprite just appeared
  useEffect(() => {
    if (hasSprite && !prevHasSpriteRef.current) {
      setState('summoning');
      setHasSummoned(true);
      summonTimerRef.current = setTimeout(() => setState('idle'), 1200);
    }
    prevHasSpriteRef.current = hasSprite;
    return () => {
      if (summonTimerRef.current) clearTimeout(summonTimerRef.current);
    };
  }, [hasSprite]);

  // Derive state from signals (after summoning completes)
  useEffect(() => {
    if (state === 'summoning' || state === 'dismissing') return;
    if (!hasSprite) return;

    if (isLoading) {
      setState('thinking');
    } else if (activeSpriteVoice && isVoiceActive && isAssistantSpeaking) {
      setState('speaking');
    } else if (activeSpriteVoice && isVoiceActive) {
      setState('listening');
    } else {
      setState('idle');
    }
  }, [isVoiceActive, isAssistantSpeaking, isLoading, hasSprite, activeSpriteVoice, state]);

  const triggerDismiss = useCallback((onComplete: () => void) => {
    setState('dismissing');
    setTimeout(() => {
      onComplete();
      setState('idle');
      setHasSummoned(false);
    }, 600);
  }, []);

  return { state, hasSummoned, triggerDismiss };
}
