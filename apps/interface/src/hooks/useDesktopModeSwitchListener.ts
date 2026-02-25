'use client';

import { useCallback, useEffect } from 'react';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode, DesktopModeSwitchResponse } from '@interface/types/desktop-modes';
import { NIA_EVENT_DESKTOP_MODE_SWITCH } from '@interface/features/DailyCall/events/niaEventRouter';
import type { NiaEventDetail } from '@interface/features/DailyCall/events/niaEventRouter';
import { getClientLogger } from '@interface/lib/client-logger';

const logger = getClientLogger('useDesktopModeSwitchListener');

/**
 * Listens for desktop-mode-switch events from the Nia event router and
 * updates the desktop mode via context.
 *
 * Handles three event sources:
 * 1. NIA_EVENT_DESKTOP_MODE_SWITCH (`nia.event.desktopModeSwitch`) — from the
 *    event router when the bot fires `bot_switch_desktop_mode`.
 * 2. Legacy `desktopModeSwitch` CustomEvent — from browser-window.tsx.
 * 3. window.postMessage — from iframes.
 */
export function useDesktopModeSwitchListener() {
  const { setMode } = useDesktopMode();

  const normalizeMode = useCallback((raw: string): DesktopMode => {
    const key = String(raw).toUpperCase().trim();
    if (key in DesktopMode) return DesktopMode[key as keyof typeof DesktopMode];
    // Common aliases
    switch (key) {
      case 'DESKTOP':
        return DesktopMode.WORK;
      case 'CREATE':
        return DesktopMode.CREATIVE;
      default:
        logger.warn(`Unknown desktop mode "${raw}", defaulting to HOME`);
        return DesktopMode.HOME;
    }
  }, []);

  useEffect(() => {
    // Handle window.postMessage style events
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = event.data;
        if (data?.action === 'SWITCH_DESKTOP_MODE' && data?.payload?.targetMode) {
          const targetMode = normalizeMode(data.payload.targetMode);
          logger.info(`[postMessage] Switching desktop mode to ${targetMode}`);
          setMode(targetMode);
        }
      } catch (error) {
        logger.error('Error handling message event', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Handle NIA event router CustomEvent (nia.event.desktopModeSwitch)
    const handleNiaEvent = (event: CustomEvent<NiaEventDetail>) => {
      console.log('[DesktopModeSwitchBridge] Received NIA event:', event.type, event.detail);
      const payload = event.detail?.payload as Record<string, unknown> | undefined;
      const rawMode = payload?.mode ?? payload?.targetMode;
      if (rawMode && typeof rawMode === 'string') {
        const targetMode = normalizeMode(rawMode);
        logger.info(`[NiaEvent] Switching desktop mode to ${targetMode}`);
        setMode(targetMode);
      }
    };

    // Handle legacy CustomEvent dispatched by browser-window.tsx
    const handleLegacyCustomEvent = (event: CustomEvent<DesktopModeSwitchResponse>) => {
      if (event.detail?.action === 'SWITCH_DESKTOP_MODE' && event.detail?.payload?.targetMode) {
        const targetMode = normalizeMode(event.detail.payload.targetMode);
        logger.info(`[CustomEvent] Switching desktop mode to ${targetMode}`);
        setMode(targetMode);
      }
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, handleNiaEvent as EventListener);
    window.addEventListener('desktopModeSwitch', handleLegacyCustomEvent as EventListener);

    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener(NIA_EVENT_DESKTOP_MODE_SWITCH, handleNiaEvent as EventListener);
      window.removeEventListener('desktopModeSwitch', handleLegacyCustomEvent as EventListener);
    };
  }, [setMode, normalizeMode]);
}
