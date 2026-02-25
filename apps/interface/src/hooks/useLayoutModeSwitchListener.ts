'use client';

import { useCallback, useEffect } from 'react';
import { useLayoutMode, LayoutMode } from '@interface/contexts/layout-mode-context';
import { NIA_EVENT_LAYOUT_MODE_SWITCH } from '@interface/features/DailyCall/events/niaEventRouter';
import type { NiaEventDetail } from '@interface/features/DailyCall/events/niaEventRouter';
import { getClientLogger } from '@interface/lib/client-logger';

const logger = getClientLogger('useLayoutModeSwitchListener');

/**
 * Listens for layout-mode-switch events and updates the layout override.
 *
 * Handles:
 * 1. NIA_EVENT_LAYOUT_MODE_SWITCH from the event router (bot tool / voice command)
 * 2. window.postMessage with action SWITCH_LAYOUT_MODE
 */
export function useLayoutModeSwitchListener() {
  const { setLayoutMode } = useLayoutMode();

  const normalizeMode = useCallback((raw: string): LayoutMode => {
    const lower = String(raw).toLowerCase().trim();
    switch (lower) {
      case 'desktop':
        return 'desktop';
      case 'mobile':
        return 'mobile';
      case 'auto':
      case 'automatic':
      case 'default':
        return 'auto';
      default:
        logger.warn(`Unknown layout mode "${raw}", defaulting to auto`);
        return 'auto';
    }
  }, []);

  useEffect(() => {
    const handleNiaEvent = (event: CustomEvent<NiaEventDetail>) => {
      const payload = event.detail?.payload as Record<string, unknown> | undefined;
      const rawMode = payload?.mode ?? payload?.layoutMode;
      if (rawMode && typeof rawMode === 'string') {
        const mode = normalizeMode(rawMode);
        logger.info(`[NiaEvent] Switching layout mode to ${mode}`);
        setLayoutMode(mode);
      }
    };

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = event.data;
        if (data?.action === 'SWITCH_LAYOUT_MODE' && data?.payload?.mode) {
          const mode = normalizeMode(data.payload.mode);
          logger.info(`[postMessage] Switching layout mode to ${mode}`);
          setLayoutMode(mode);
        }
      } catch (error) {
        logger.error('Error handling layout mode message', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener(NIA_EVENT_LAYOUT_MODE_SWITCH, handleNiaEvent as EventListener);
    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener(NIA_EVENT_LAYOUT_MODE_SWITCH, handleNiaEvent as EventListener);
      window.removeEventListener('message', handleMessage);
    };
  }, [setLayoutMode, normalizeMode]);
}
