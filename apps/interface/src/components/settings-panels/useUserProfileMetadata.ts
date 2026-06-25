import { useEffect, useState, useMemo } from 'react';

import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

import type { IPrivateMemory, IPublicPersona } from '@nia/prism/core/blocks/userProfile.block';

/**
 * Hook to fetch user profile "stored information" for the Settings panel.
 *
 * The underlying storage used to be a flat `metadata` bag; it's now structured
 * as `privateMemory.preferences` (the free-form preferences field of the new
 * UserProfile schema). The hook exposes both `preferences` (for the settings
 * UI editor) and the full `publicPersona` / `privateMemory` objects so callers
 * don't have to refetch.
 *
 * For most cases prefer `useUserProfile()` from user-profile-context.tsx.
 * This hook still exists for lazy-loading the full profile when the settings
 * panel opens.
 *
 * @param enabled - Whether to fetch data (typically when panel is open)
 * @param _tenantId - Deprecated, kept for backward compatibility
 */
export function useUserProfileMetadata(enabled: boolean = true, _tenantId?: string) {
  const logger = useMemo(() => getClientLogger('[settings_panels]'), []);
  const { data: session, status } = useResilientSession();
  const user = session?.user;

  // Try to get base profile data from context (if available)
  const contextProfile = useUserProfileOptional();

  const [publicPersona, setPublicPersona] = useState<IPublicPersona | null>(null);
  const [privateMemory, setPrivateMemory] = useState<IPrivateMemory | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(
    contextProfile?.onboardingComplete ?? false
  );
  const [userProfileId, setUserProfileId] = useState<string | null>(
    contextProfile?.userProfileId ?? null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sync from context if available
  useEffect(() => {
    if (contextProfile) {
      setOnboardingComplete(contextProfile.onboardingComplete);
      setUserProfileId(contextProfile.userProfileId);
      if (contextProfile.publicPersona) setPublicPersona(contextProfile.publicPersona);
      if (contextProfile.privateMemory) setPrivateMemory(contextProfile.privateMemory);
    }
  }, [
    contextProfile?.onboardingComplete,
    contextProfile?.userProfileId,
    contextProfile?.publicPersona,
    contextProfile?.privateMemory,
  ]);

  useEffect(() => {
    logger.debug('useUserProfileMetadata effect triggered', { enabled, userId: user?.id, status });

    if (status === 'loading') {
      return;
    }

    if (!enabled || !user?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
        if (!response.ok) {
          logger.error('Failed to fetch user profile', { status: response.status });
          throw new Error('Failed to fetch user profile');
        }
        const data = await response.json();
        if (!cancelled) {
          const userProfile = data.items?.[0];
          if (userProfile) {
            logger.info('User profile loaded', { userId: user.id });
            setUserProfileId(userProfile._id);
            setPublicPersona(userProfile.publicPersona ?? null);
            setPrivateMemory(userProfile.privateMemory ?? null);
            setOnboardingComplete(!!userProfile.onboardingComplete);
          } else {
            // Profile doesn't exist - UserProfileProvider should create it
            setPublicPersona(null);
            setPrivateMemory(null);
            setUserProfileId(null);
            setOnboardingComplete(false);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const message = e instanceof Error ? e.message : 'Failed to load stored information';
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchProfile();
    return () => {
      cancelled = true;
    };
  }, [enabled, logger, user?.id, status]);

  const refresh = async () => {
    if (!user?.id) return;

    if (contextProfile?.refresh) {
      await contextProfile.refresh();
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch user profile');
      }
      const data = await response.json();
      const userProfile = data.items?.[0];
      if (userProfile) {
        setUserProfileId(userProfile._id);
        setPublicPersona(userProfile.publicPersona ?? null);
        setPrivateMemory(userProfile.privateMemory ?? null);
        setOnboardingComplete(!!userProfile.onboardingComplete);
      } else {
        setPublicPersona(null);
        setPrivateMemory(null);
        setUserProfileId(null);
        setOnboardingComplete(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load stored information';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // `preferences` is the free-form store that replaced the legacy `metadata` bag.
  // The Settings "Stored Information" panel edits this.
  const preferences = privateMemory?.preferences ?? null;

  return {
    preferences,
    publicPersona,
    privateMemory,
    userProfileId,
    loading,
    error,
    refresh,
    onboardingComplete,
  };
}
