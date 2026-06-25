'use client';

import { useEffect, useState } from 'react';

import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import {
  DEFAULT_INTERFACE_CUSTOMIZATION,
  INTERFACE_CUSTOMIZATION_CHANGED_EVENT,
  INTERFACE_CUSTOMIZATION_STORAGE_KEY,
  applyInterfaceCustomization,
  hasMeaningfulInterfaceCustomization,
  normalizeInterfaceCustomizationState,
  readInterfaceCustomization,
  replaceInterfaceCustomization,
  type InterfaceCustomizationState,
} from '@interface/lib/interface-customization';
import { getPearlOSPreferences } from '@interface/lib/pearlos-user-preferences';

const INTERFACE_CUSTOMIZATION_OWNER_KEY = `${INTERFACE_CUSTOMIZATION_STORAGE_KEY}:owner`;

function ownerForProfile(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(INTERFACE_CUSTOMIZATION_OWNER_KEY);
}

function markOwnerForProfile(profileId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INTERFACE_CUSTOMIZATION_OWNER_KEY, profileId);
}

function defaultCustomizationForProfile(): InterfaceCustomizationState {
  return {
    ...DEFAULT_INTERFACE_CUSTOMIZATION,
    backgrounds: { ...DEFAULT_INTERFACE_CUSTOMIZATION.backgrounds },
    icons: {},
    customThemes: [],
    updatedAt: Date.now(),
  };
}

export function useInterfaceCustomization(): InterfaceCustomizationState {
  const [state, setState] = useState<InterfaceCustomizationState>(DEFAULT_INTERFACE_CUSTOMIZATION);
  const profile = useUserProfileOptional();
  const [profileSyncedForUser, setProfileSyncedForUser] = useState<string | null>(null);
  const profileId = profile?.userProfileId || null;
  const profileLoading = profile?.loading ?? false;
  const profileMemory = profile?.privateMemory;
  const updatePearlOSPreferences = profile?.updatePearlOSPreferences;

  useEffect(() => {
    const refresh = () => {
      const next = readInterfaceCustomization();
      applyInterfaceCustomization(next);
      setState(next);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === INTERFACE_CUSTOMIZATION_STORAGE_KEY) {
        refresh();
      }
    };

    refresh();
    window.addEventListener(INTERFACE_CUSTOMIZATION_CHANGED_EVENT, refresh);
    window.addEventListener('storage', handleStorage);

    return () => {
      window.removeEventListener(INTERFACE_CUSTOMIZATION_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!profileId || profileLoading) return;
    if (profileSyncedForUser === profileId) return;

    const local = readInterfaceCustomization();
    const prefs = getPearlOSPreferences(profileMemory);
    const remote = normalizeInterfaceCustomizationState(prefs.interfaceCustomization);
    const localOwner = ownerForProfile();
    const localBelongsToProfile = localOwner === profileId;
    const localHasState = localBelongsToProfile && hasMeaningfulInterfaceCustomization(local);
    const remoteHasState = hasMeaningfulInterfaceCustomization(remote);
    const remoteHasAssetOverrides =
      Object.keys(remote.backgrounds).length > 0 || Object.keys(remote.icons).length > 0;
    const remoteDroppedLocalThemes = localBelongsToProfile &&
      local.customThemes.length > 0 && remote.customThemes.length === 0 && remoteHasAssetOverrides;
    const shouldUseRemote =
      remoteHasState &&
      !remoteDroppedLocalThemes &&
      (!localBelongsToProfile || !localHasState || remote.updatedAt > local.updatedAt);

    if (shouldUseRemote) {
      replaceInterfaceCustomization(remote);
      setState(remote);
      markOwnerForProfile(profileId);
    } else if (localHasState && updatePearlOSPreferences) {
      updatePearlOSPreferences({ interfaceCustomization: local }).catch(() => undefined);
    } else if (!remoteHasState) {
      const defaults = defaultCustomizationForProfile();
      replaceInterfaceCustomization(defaults);
      setState(defaults);
      markOwnerForProfile(profileId);
      Promise.resolve(updatePearlOSPreferences?.({ interfaceCustomization: defaults })).catch(() => undefined);
    }

    setProfileSyncedForUser(profileId);
  }, [profileId, profileLoading, profileMemory, profileSyncedForUser, updatePearlOSPreferences]);

  useEffect(() => {
    if (!profileId || profileLoading || !updatePearlOSPreferences) return;
    if (profileSyncedForUser !== profileId) return;
    if (!hasMeaningfulInterfaceCustomization(state)) return;

    const prefs = getPearlOSPreferences(profileMemory);
    const remote = normalizeInterfaceCustomizationState(prefs.interfaceCustomization);
    if (JSON.stringify(remote) === JSON.stringify(state)) return;

    const timer = window.setTimeout(() => {
      updatePearlOSPreferences({ interfaceCustomization: state }).catch(() => undefined);
    }, 900);

    return () => window.clearTimeout(timer);
  }, [profileId, profileLoading, profileMemory, profileSyncedForUser, state, updatePearlOSPreferences]);

  useEffect(() => {
    if (!profileId) {
      setProfileSyncedForUser(null);
    }
  }, [profileId]);

  useEffect(() => {
    if (!profileId || profileLoading) return;
    const poll = async () => {
      try {
        const response = await fetch('/api/interface-customization/apply', {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        if (!response.ok) return;
        const data = await response.json();
        const remote = normalizeInterfaceCustomizationState(data?.interfaceCustomization);
        const local = readInterfaceCustomization();
        if (remote.updatedAt > local.updatedAt) {
          replaceInterfaceCustomization(remote);
          setState(remote);
        }
      } catch {
        // Best effort: local/profile sync still works on reload.
      }
    };
    const timer = window.setInterval(poll, 5000);
    window.setTimeout(poll, 1000);
    return () => window.clearInterval(timer);
  }, [profileId, profileLoading]);

  return state;
}
