'use client';

import { useEffect } from 'react';
import { getClientLogger } from '@interface/lib/client-logger';

import { DesktopMode, DesktopModeSwitchResponse } from '../types/desktop-modes';

interface InitializeDesktopModeProps {
  mode: DesktopMode | string | undefined | null;
}

export default function InitializeDesktopMode({ mode }: InitializeDesktopModeProps) {
  const log = getClientLogger('InitializeDesktopMode');
  useEffect(() => {
    const DEBUG = process.env.NEXT_PUBLIC_DEBUG_DESKTOP_MODE === 'true';
    const normalizeMode = (m: DesktopMode | string | undefined | null): DesktopMode => {
      const v = (m ?? DesktopMode.HOME).toString().toLowerCase();
      return (Object.values(DesktopMode) as string[]).includes(v)
        ? (v as DesktopMode)
        : DesktopMode.HOME;
    };
    const selected = normalizeMode(mode);
    try {
      const detail: DesktopModeSwitchResponse = {
        success: true,
        mode: selected,
        message: 'Initialized from assistant.desktopMode',
        userRequest: null,
        timestamp: new Date().toISOString(),
        action: 'SWITCH_DESKTOP_MODE',
        payload: {
          targetMode: selected,
          previousMode: null,
          switchReason: 'assistant_default',
        },
      };
      // Defer one tick to ensure listeners (e.g., DesktopBackgroundSwitcher) are mounted
      setTimeout(() => {
        if (DEBUG) {
          log.debug('Dispatch desktopModeSwitch', { detail });
        }
        window.dispatchEvent(new CustomEvent('desktopModeSwitch', { detail }));
      }, 0);
    } catch (e) {
      log.warn('Failed to initialize desktop mode', { error: e });
    }
  }, [mode]);

  return null;
}
