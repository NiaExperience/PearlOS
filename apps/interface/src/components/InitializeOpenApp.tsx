'use client';

import { useEffect, useRef } from 'react';

interface InitializeOpenAppProps {
  app: string | undefined | null;
}

const ALLOWED_QUERY_APPS = new Set([
  'notes',
  'notepad',
  'youtube',
  'video',
  'terminal',
  'cmd',
  'command',
  'browser',
  'chrome',
  'web',
  'news',
  'the-news',
  'pulse',
  'global-pulse',
  'social-pulse',
  'weather',
]);

function normalizeQueryApp(app: string | undefined | null): string | null {
  const value = (app ?? '').trim().toLowerCase();
  if (!value || !ALLOWED_QUERY_APPS.has(value)) return null;
  return value;
}

export default function InitializeOpenApp({ app }: InitializeOpenAppProps) {
  const openedRef = useRef<string | null>(null);

  useEffect(() => {
    const normalized = normalizeQueryApp(app);
    if (!normalized) return;
    if (openedRef.current === normalized) return;
    openedRef.current = normalized;

    const cleanupUrl = () => {
      try {
        const params = new URLSearchParams(window.location.search);
        params.delete('openApp');
        const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}${window.location.hash}`;
        window.history.replaceState({}, '', next);
      } catch {
        // Ignore history failures; the app has already been opened.
      }
    };

    const timer = window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('nia:desktop.openApp', {
          detail: {
            app: normalized,
          },
        }),
      );
      cleanupUrl();
    }, 300);

    return () => window.clearTimeout(timer);
  }, [app]);

  return null;
}
