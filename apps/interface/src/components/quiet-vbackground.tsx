'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';

const SPLASH_DURATION_MS = 4500; // Splash background length (ms); adjust if asset changes.

type SummonLifecycleStatus = 'success' | 'cancelled' | 'error';
type SummonLifecycleDetail = {
  prompt?: string;
  requestId?: string;
  status?: SummonLifecycleStatus;
};

type SpriteReadyDetail = {
  prompt: string;
  requestId?: string;
};

type BackgroundPhase = 'idle' | 'progress' | 'splash';

const QuietVBackground = () => {
  const logger = getClientLogger('[quiet_background]');
  const [phase, setPhase] = useState<BackgroundPhase>('idle');
  const splashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const legacyRequestCounterRef = useRef(0);

  const clearSplashTimer = useCallback(() => {
    if (splashTimeoutRef.current) {
      clearTimeout(splashTimeoutRef.current);
      splashTimeoutRef.current = null;
    }
  }, []);

  const assignRequestId = useCallback((requestId?: string) => {
    if (requestId) {
      activeRequestIdRef.current = requestId;
      return requestId;
    }
    legacyRequestCounterRef.current += 1;
    const fallbackId = `legacy-${legacyRequestCounterRef.current}`;
    activeRequestIdRef.current = fallbackId;
    return fallbackId;
  }, []);

  useEffect(() => {
    logger.info('Quiet background is active');
  }, [logger]);

  useEffect(() => {
    const startProgress = (detail?: SummonLifecycleDetail) => {
      assignRequestId(detail?.requestId);
      clearSplashTimer();
      setPhase('progress');
    };

    const playSplash = (detail?: SpriteReadyDetail) => {
      if (detail?.requestId) {
        activeRequestIdRef.current = detail.requestId;
      }
      clearSplashTimer();
      setPhase('splash');
      splashTimeoutRef.current = setTimeout(() => {
        setPhase('idle');
        splashTimeoutRef.current = null;
        activeRequestIdRef.current = null;
      }, SPLASH_DURATION_MS);
    };

    const stopProgress = (detail?: SummonLifecycleDetail) => {
      if (detail?.status === 'success') {
        return; // Splash handler manages success completions.
      }
      if (detail?.requestId && detail.requestId !== activeRequestIdRef.current) {
        return;
      }
      clearSplashTimer();
      activeRequestIdRef.current = null;
      setPhase('idle');
    };

    const handleSummonStart = (event: Event) => {
      const customEvent = event as CustomEvent<SummonLifecycleDetail>;
      startProgress(customEvent.detail);
    };

    const handleSpriteReady = (event: Event) => {
      const customEvent = event as CustomEvent<SpriteReadyDetail>;
      playSplash(customEvent.detail);
    };

    const handleSummonStop = (event: Event) => {
      const customEvent = event as CustomEvent<SummonLifecycleDetail>;
      stopProgress(customEvent.detail);
    };

    window.addEventListener('sprite.summon.start', handleSummonStart);
    window.addEventListener('sprite.ready', handleSpriteReady);
    window.addEventListener('sprite.summon.stop', handleSummonStop);

    return () => {
      clearSplashTimer();
      window.removeEventListener('sprite.summon.start', handleSummonStart);
      window.removeEventListener('sprite.ready', handleSpriteReady);
      window.removeEventListener('sprite.summon.stop', handleSummonStop);
    };
  }, [assignRequestId, clearSplashTimer]);

  const layerBaseClasses = 'absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-300 ease-in-out';

  return (
    <>
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: -1 }}>
        <div
          className={`${layerBaseClasses} ${phase === 'idle' ? 'opacity-100' : 'opacity-0'}`}
          style={{
            backgroundImage: 'url("/quietModeBG.gif")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div
          className={`${layerBaseClasses} ${phase === 'progress' ? 'opacity-100' : 'opacity-0'}`}
          style={{
            backgroundImage: 'url("/quietbgloopprogress.gif")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div
          className={`${layerBaseClasses} ${phase === 'splash' ? 'opacity-100' : 'opacity-0'}`}
          style={{
            backgroundImage: 'url("/quietbgsplash.gif")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      </div>

      {/* Rain effect removed to keep quiet mode static */}
    </>
  );
};

export default QuietVBackground;


