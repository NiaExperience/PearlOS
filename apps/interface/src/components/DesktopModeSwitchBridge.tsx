'use client';

import { useDesktopModeSwitchListener } from '@interface/hooks/useDesktopModeSwitchListener';

/**
 * Invisible bridge component that listens for desktopModeSwitch events
 * (dispatched by browser-window.tsx) and updates the DesktopMode context.
 *
 * Previously this logic lived inside DesktopBackgroundSwitcher, which has been
 * replaced by Stage.  Stage doesn't handle mode-switch events, so this bridge
 * fills the gap.
 */
export default function DesktopModeSwitchBridge() {
  useDesktopModeSwitchListener();
  return null;
}
