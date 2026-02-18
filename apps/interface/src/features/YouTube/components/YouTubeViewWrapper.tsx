'use client';

import dynamic from 'next/dynamic';
import React, { forwardRef, useMemo } from 'react';

import { getClientLogger } from '@interface/lib/client-logger';
import { AssistantThemeProvider } from '@interface/theme/AssistantThemeContext';

import type { YouTubeViewProps } from '../types/youtube-types';


const logger = getClientLogger('YouTubeViewWrapper');

// Use dynamic with a promise wrapper to avoid direct TSX extension import (Node16 moduleResolution requirement)
const AdvancedYouTubeView = dynamic<YouTubeViewProps>(
  () => new Promise((resolve) => {
    // Defer to next tick to avoid blocking
    Promise.resolve().then(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
  // Filename is lowercase 'youtube-view.tsx'
  const mod = require('./youtube-view');
        resolve(mod.default || mod.YouTubeView);
      } catch (err) {
        logger.warn('Dynamic YouTube view import failed', { error: err });
        resolve(() => null);
      }
    });
  }),
  { ssr: false, loading: () => <div className="p-4 text-xs text-muted-foreground">Loading YouTube…</div> }
);

export interface BasicYouTubeViewProps extends YouTubeViewProps {
  fallbackText?: string;
  /** optional className wrapper */
  className?: string;
}

export const YouTubeViewWrapper = forwardRef<HTMLDivElement, BasicYouTubeViewProps>(function YouTubeViewWrapper({
  query = '',
  assistantName = 'Nia',
  fallbackText = 'Loading YouTube…',
  className = 'w-full h-full flex flex-col',
  ...rest
}, ref) {
  const Fallback = useMemo(() => (
    <div className="p-4 text-xs text-muted-foreground" role="status" aria-live="polite">{fallbackText}</div>
  ), [fallbackText]);

  return (
    <div ref={ref} className={className} data-component="YouTubeViewWrapper">
      <React.Suspense fallback={Fallback}>
        <AssistantThemeProvider theme={undefined}>
          <AdvancedYouTubeView query={query} assistantName={assistantName} {...rest} />
        </AssistantThemeProvider>
      </React.Suspense>
    </div>
  );
});

export default YouTubeViewWrapper;
