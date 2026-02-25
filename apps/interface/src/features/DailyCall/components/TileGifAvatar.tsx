'use client';

import React, { useState, useEffect, useRef } from 'react';

interface TileGifAvatarProps {
  className?: string;
  isSpeaking: boolean;
  isCallActive?: boolean; // drives wake/sleep transitions
  audioLevelRef: React.MutableRefObject<number>;
  userName?: string;
}

// GIF paths
const AVATAR_IDLE_GIFS = [
  '/images/avatar/pearlIdle1.gif',
  '/images/avatar/Pearlidle2.gif'
];
const AVATAR_TALKING_GIFS = [
  '/images/avatar/avatar-talking.gif',
  '/images/avatar/PearlTalking1.gif',
];
const AVATAR_WAKEUP_GIF = '/images/avatar/StarupPearl.gif';
const AVATAR_SLEEP_GIF = '/images/avatar/PearlShutdown.gif';
const AVATAR_INACTIVE_PNG = '/images/avatar/Pearlinactivenew.png';

type AvatarState = 'sleep' | 'waking' | 'idle' | 'talking' | 'sleeping';

const WAKING_DURATION = 2500;
const SLEEPING_DURATION = 2000;

/**
 * GIF-based avatar component for Pearl bot in Daily Call tiles.
 * Full state machine: sleep → waking → idle ↔ talking → sleeping → sleep
 */
export const TileGifAvatar: React.FC<TileGifAvatarProps> = ({ 
  className = '',
  isSpeaking,
  isCallActive = true,
  audioLevelRef: _audioLevelRef,
  userName: _userName,
}) => {
  const [state, setState] = useState<AvatarState>('sleep');
  const [currentIdleGifIndex, setCurrentIdleGifIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // ── Wake/Sleep transitions ──
  useEffect(() => {
    if (isCallActive && (state === 'sleep' || state === 'sleeping')) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState('waking');
      timerRef.current = setTimeout(() => {
        setState(isSpeaking ? 'talking' : 'idle');
      }, WAKING_DURATION);
    } else if (!isCallActive && state !== 'sleep' && state !== 'sleeping') {
      if (timerRef.current) clearTimeout(timerRef.current);
      setState('sleeping');
      timerRef.current = setTimeout(() => {
        setState('sleep');
      }, SLEEPING_DURATION);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCallActive]);

  // ── Idle/Talking transitions ──
  useEffect(() => {
    if (state === 'idle' && isSpeaking) {
      setState('talking');
    } else if (state === 'talking' && !isSpeaking) {
      setState('idle');
    }
  }, [isSpeaking, state]);

  // ── Cycle idle GIFs with cache-busting so non-looping GIFs replay ──
  const [idleCacheBust, setIdleCacheBust] = useState(Date.now());
  useEffect(() => {
    if (state !== 'idle') return;
    // Force replay when entering idle
    setIdleCacheBust(Date.now());
    const cycleInterval = setInterval(() => {
      setCurrentIdleGifIndex(prev => (prev + 1) % AVATAR_IDLE_GIFS.length);
      setIdleCacheBust(Date.now());
    }, 3000 + Math.random() * 2000);
    return () => clearInterval(cycleInterval);
  }, [state]);

  // ── Cycle talking GIFs with cache-busting so non-looping GIFs replay ──
  const [talkingGifIndex, setTalkingGifIndex] = useState(0);
  const [talkingCacheBust, setTalkingCacheBust] = useState(Date.now());
  useEffect(() => {
    if (state !== 'talking') return;
    // Force replay when entering talking
    setTalkingCacheBust(Date.now());
    const cycleInterval = setInterval(() => {
      setTalkingGifIndex(prev => {
        let next;
        do {
          next = Math.floor(Math.random() * AVATAR_TALKING_GIFS.length);
        } while (AVATAR_TALKING_GIFS.length > 1 && next === prev);
        return next;
      });
      setTalkingCacheBust(Date.now());
    }, 2500 + Math.random() * 1500);
    return () => clearInterval(cycleInterval);
  }, [state]);

  // Resolve current GIF
  let currentGifSrc: string;
  if (state === 'waking') {
    currentGifSrc = `${AVATAR_WAKEUP_GIF}?t=${Date.now()}`;
  } else if (state === 'sleeping') {
    currentGifSrc = `${AVATAR_SLEEP_GIF}?t=${Date.now()}`;
  } else if (state === 'sleep') {
    currentGifSrc = AVATAR_INACTIVE_PNG;
  } else if (state === 'talking') {
    currentGifSrc = `${AVATAR_TALKING_GIFS[talkingGifIndex]}?t=${talkingCacheBust}`;
  } else {
    currentGifSrc = `${AVATAR_IDLE_GIFS[currentIdleGifIndex]}?t=${idleCacheBust}`;
  }

  return (
    <div className={`tile-rive-avatar ${className}`} style={{ pointerEvents: 'none' }}>
      <img
        src={currentGifSrc}
        alt="Avatar"
        style={{ 
          width: '130%',
          height: '130%',
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          transformOrigin: 'center center',
          objectFit: 'cover',
          background: 'transparent',
          backgroundColor: 'transparent',
          pointerEvents: 'none',
          opacity: state === 'sleep' ? 0.6 : 1,
          transition: 'opacity 0.3s ease',
        }} 
      />
    </div>
  );
};
