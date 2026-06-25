'use client';

import {
  INTERFACE_CUSTOMIZATION_CHANGED_EVENT,
  INTERFACE_CUSTOMIZATION_STORAGE_KEY,
  replaceInterfaceCustomization,
} from '@interface/lib/interface-customization';
import {
  DESKTOP_SHORTCUTS_CHANGED_EVENT,
  DESKTOP_SHORTCUTS_STORAGE_KEY,
} from '@interface/lib/personal-desktop-shortcuts';
import { defaultPearlOSCodeSettings } from '@interface/lib/pearlos-code-reset';

const INTERFACE_CUSTOMIZATION_OWNER_KEY = `${INTERFACE_CUSTOMIZATION_STORAGE_KEY}:owner`;
const OUR_PEARLOS_INSTALLED_FEATURES_KEY = 'pearlos:our-pearlos-installed-features:v1';

export function clearPearlOSCodeLocalState(): void {
  if (typeof window === 'undefined') return;
  const defaults = defaultPearlOSCodeSettings(Date.now()).interfaceCustomization;
  try {
    replaceInterfaceCustomization(defaults);
    window.localStorage.removeItem(INTERFACE_CUSTOMIZATION_OWNER_KEY);
    window.localStorage.removeItem(DESKTOP_SHORTCUTS_STORAGE_KEY);
    window.localStorage.removeItem(OUR_PEARLOS_INSTALLED_FEATURES_KEY);
    window.dispatchEvent(new CustomEvent(INTERFACE_CUSTOMIZATION_CHANGED_EVENT, { detail: defaults }));
    window.dispatchEvent(new CustomEvent(DESKTOP_SHORTCUTS_CHANGED_EVENT, { detail: { shortcuts: [] } }));
  } catch {
    // Reset is best-effort locally; the server profile reset remains authoritative.
  }
}
