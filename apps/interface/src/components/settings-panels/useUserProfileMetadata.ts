import { useEffect, useState, useMemo } from 'react';

import { useUserProfileOptional } from '@interface/contexts/user-profile-context';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

/**
 * Hook to fetch user profile metadata (read-only, for Settings panel)
 * 
 * NOTE: Profile creation and welcome note logic has been moved to UserProfileProvider.
 * This hook is now purely for reading metadata when the Settings panel is open.
 * 
 * For most use cases, prefer useUserProfile() from user-profile-context.tsx
 * This hook exists for backward compatibility and lazy-loading metadata.
 * 
 * @param enabled - Whether to fetch metadata (typically when panel is open)
 * @param _tenantId - Deprecated, kept for backward compatibility
 */
export function useUserProfileMetadata(enabled: boolean = true, _tenantId?: string) {
  const logger = useMemo(() => getClientLogger('[settings_panels]'), []);
  const { data: session, status } = useResilientSession();
  const user = session?.user;
  
  // Try to get base profile data from context (if available)
  const contextProfile = useUserProfileOptional();
  
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
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
      if (contextProfile.metadata) {
        setMetadata(contextProfile.metadata);
      }
    }
  }, [contextProfile?.onboardingComplete, contextProfile?.userProfileId, contextProfile?.metadata]);

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
    const fetchMetadata = async () => {
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
            logger.info('User profile metadata loaded', { userId: user.id });
            setUserProfileId(userProfile._id);
            setMetadata(userProfile.metadata || null);
            setOnboardingComplete(!!userProfile.onboardingComplete);
          } else {
            // Profile doesn't exist - UserProfileProvider should create it
            // Just set empty state here
            setMetadata(null);
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

    fetchMetadata();
    return () => {
      cancelled = true;
    };
  }, [enabled, logger, user?.id, status]);

  const refresh = async () => {
    if (!user?.id) return;
    
    // Also refresh context if available
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
        setMetadata(userProfile.metadata || null);
        setOnboardingComplete(!!userProfile.onboardingComplete);
      } else {
        setMetadata(null);
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

  return { metadata, userProfileId, loading, error, refresh, onboardingComplete };
}

