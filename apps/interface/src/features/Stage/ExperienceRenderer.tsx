'use client';

import { useCallback, useRef, useState } from 'react';
import { getBridgeScript, usePearlBridge, type PearlBridgeHandlers } from './PearlBridgeProvider';
import { getClientLogger } from '@interface/lib/client-logger';

const logger = getClientLogger('[experience_renderer]');

export interface ExperienceContent {
  html: string;
  css?: string;
  js?: string;
  transition?: 'fade' | 'slide' | 'instant';
}

interface ExperienceRendererProps {
  /** The experience content to render, or null to show nothing. */
  content: ExperienceContent | null;
  /** Called when the experience requests dismissal via pearl.dismiss(). */
  onDismiss?: () => void;
  /** Bridge handlers for pearl.* SDK calls from the experience. */
  bridgeHandlers?: PearlBridgeHandlers;
}

/**
 * Sandboxed iframe renderer for AI-generated experiences.
 * Injects the pearl.* Bridge SDK and renders HTML/CSS/JS content.
 */
export default function ExperienceRenderer({
  content,
  onDismiss,
  bridgeHandlers = {},
}: ExperienceRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [animState, setAnimState] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');

  // Wire up the pearl bridge
  usePearlBridge(iframeRef, {
    ...bridgeHandlers,
    onDismiss: onDismiss ?? bridgeHandlers.onDismiss,
  });

  // Build the full HTML document to inject
  const buildDocument = useCallback((exp: ExperienceContent): string => {
    const bridgeScript = getBridgeScript();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: 100%; height: 100%;
      background: transparent;
      color: #e0e0e8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      overflow: auto;
    }
    ${exp.css ?? ''}
  </style>
  ${bridgeScript}
</head>
<body>
  ${exp.html}
  ${exp.js ? `<script>${exp.js}</script>` : ''}
</body>
</html>`;
  }, []);

  if (!content) return null;

  const srcDoc = buildDocument(content);
  const transition = content.transition ?? 'fade';
  const animClass =
    transition === 'instant'
      ? ''
      : animState === 'entering' || animState === 'hidden'
        ? 'stage__experience--entering'
        : animState === 'exiting'
          ? 'stage__experience--exiting'
          : '';

  return (
    <div className={`stage__experience ${animClass}`}>
      <iframe
        ref={iframeRef}
        className="experience-frame"
        srcDoc={srcDoc}
        sandbox="allow-scripts allow-forms allow-popups"
        title="Pearl Experience"
        onLoad={() => {
          setAnimState('visible');
          logger.info('Experience loaded');
        }}
      />
    </div>
  );
}
