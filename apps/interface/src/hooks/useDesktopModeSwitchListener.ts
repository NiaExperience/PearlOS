'use client';

import { useCallback, useEffect } from 'react';
import { useDesktopMode } from '@interface/contexts/desktop-mode-context';
import { DesktopMode, DesktopModeSwitchResponse } from '@interface/types/desktop-modes';
import { NIA_EVENT_DESKTOP_MODE_SWITCH } from '@interface/features/DailyCall/events/niaEventRouter';
import type { NiaEventDetail } from '@interface/features/DailyCall/events/niaEventRouter';
import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { getClientLogger } from '@interface/lib/client-logger';
import { LAST_MODE_KEY, writeLocalPreference } from '@interface/lib/pearlos-user-preferences';

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
  const profile = useUserProfileOptional();

  const normalizeMode = useCallback((raw: string): DesktopMode => {
    let key = String(raw).toUpperCase().trim();
    const aliases: Partial<Record<string, keyof typeof DesktopMode>> = {
      CREATE: 'CREATIVE',
      FULL: 'DESKTOP',
    };
    key = aliases[key] ?? key;
    if (key in DesktopMode) return DesktopMode[key as keyof typeof DesktopMode];
    logger.warn(`Unknown desktop mode "${raw}", defaulting to HOME`);
    return DesktopMode.HOME;
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
        writeLocalPreference(LAST_MODE_KEY, targetMode);
        profile?.updatePearlOSPreferences({ lastDesktopMode: targetMode });
      }
      } catch (error) {
        logger.error('Error handling message event', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    // Handle NIA event router CustomEvent (nia:desktop.mode.switch).
    // The router dispatches `{ mode, timestamp }` directly as event.detail.
    // Older callers wrap it as `{ payload: { mode } }`. Accept both shapes so
    // bot voice tools, chat-mode tool handlers, and legacy code paths all
    // succeed in flipping the desktop mode.
    const handleNiaEvent = (event: CustomEvent<NiaEventDetail>) => {
      const detail = event.detail as Record<string, unknown> | undefined;
      const wrapped = (detail?.payload ?? {}) as Record<string, unknown>;
      const rawMode =
        (detail?.mode as string | undefined) ??
        (detail?.targetMode as string | undefined) ??
        (wrapped.mode as string | undefined) ??
        (wrapped.targetMode as string | undefined);
      if (rawMode && typeof rawMode === 'string') {
        const targetMode = normalizeMode(rawMode);
        logger.info(`[NiaEvent] Switching desktop mode to ${targetMode}`);
        setMode(targetMode);
        writeLocalPreference(LAST_MODE_KEY, targetMode);
        profile?.updatePearlOSPreferences({ lastDesktopMode: targetMode });
      }
    };

    // Handle legacy CustomEvent dispatched by browser-window.tsx
    const handleLegacyCustomEvent = (event: CustomEvent<DesktopModeSwitchResponse>) => {
      if (event.detail?.action === 'SWITCH_DESKTOP_MODE' && event.detail?.payload?.targetMode) {
        const targetMode = normalizeMode(event.detail.payload.targetMode);
        logger.info(`[CustomEvent] Switching desktop mode to ${targetMode}`);
        setMode(targetMode);
        writeLocalPreference(LAST_MODE_KEY, targetMode);
        profile?.updatePearlOSPreferences({ lastDesktopMode: targetMode });
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
  }, [setMode, normalizeMode, profile]);
}
