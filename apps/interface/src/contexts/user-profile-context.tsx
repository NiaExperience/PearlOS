'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';

/**
 * User Profile Context
 * 
 * Single source of truth for user profile data. Loads once at app startup,
 * prevents race conditions from multiple components trying to fetch/create profiles.
 */

interface UserProfileContextType {
  /** User profile document ID */
  userProfileId: string | null;
  /** User profile metadata (arbitrary key-value store) */
  metadata: Record<string, unknown> | null;
  /** Whether onboarding has been completed */
  onboardingComplete: boolean;
  /** Whether the Pearl overlay has been dismissed (sticky across sessions) */
  overlayDismissed: boolean;
  /** Whether profile is currently loading */
  loading: boolean;
  /** Error message if profile load failed */
  error: string | null;
  /** Manually refresh the profile data */
  refresh: () => Promise<void>;
  /** Mark the Pearl overlay as dismissed (persists to backend) */
  dismissOverlay: () => Promise<void>;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(undefined);

// Module-level singleton for profile creation to prevent race conditions
// across React StrictMode double-mounts and HMR
let profileCreationInFlight: Promise<void> | null = null;
let profileCreationUserId: string | null = null;

// Module-level singleton for welcome note creation
let welcomeNoteInFlight: Promise<void> | null = null;
let welcomeNoteUserId: string | null = null;

interface UserProfileProviderProps {
  children: React.ReactNode;
  /** Tenant ID for welcome note creation */
  tenantId?: string;
}

export function UserProfileProvider({ children, tenantId }: UserProfileProviderProps) {
  const logger = useMemo(() => getClientLogger('[user_profile]'), []);
  const { data: session, status } = useResilientSession();
  const user = session?.user;

  const [userProfileId, setUserProfileId] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown> | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(false);
  const [overlayDismissed, setOverlayDismissed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track if this instance has already initiated profile operations
  const hasInitiatedRef = useRef(false);

  /**
   * Create welcome note for user (deduplicated at module level)
   */
  const createWelcomeNote = useCallback(async (userId: string) => {
    // Check if already in flight for this user
    if (welcomeNoteInFlight && welcomeNoteUserId === userId) {
      logger.debug('Welcome note creation already in flight, waiting', { userId });
      await welcomeNoteInFlight;
      return;
    }

    welcomeNoteUserId = userId;
    welcomeNoteInFlight = (async () => {
      try {
        logger.info('Creating welcome note', { userId });
        const res = await fetch('/api/notes/welcome', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId }),
        });

        if (!res.ok) {
          logger.warn('Failed to create welcome note', { status: res.status });
        } else {
          logger.info('Welcome note created successfully', { userId });
        }
      } catch (e) {
        logger.warn('Failed to trigger welcome note creation', { error: e });
      } finally {
        // Clear after a delay to prevent re-triggering
        setTimeout(() => {
          if (welcomeNoteUserId === userId) {
            welcomeNoteInFlight = null;
            welcomeNoteUserId = null;
          }
        }, 5000);
      }
    })();

    await welcomeNoteInFlight;
  }, [logger, tenantId]);

  /**
   * Create user profile (deduplicated at module level)
   */
  const createProfile = useCallback(async (userId: string, email: string | null | undefined, name: string | null | undefined): Promise<{ _id: string; metadata: Record<string, unknown> | null; onboardingComplete: boolean } | null> => {
    // Check if already in flight for this user
    if (profileCreationInFlight && profileCreationUserId === userId) {
      logger.debug('Profile creation already in flight, waiting', { userId });
      await profileCreationInFlight;
      // After waiting, fetch the profile that was created
      const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(userId)}`);
      if (response.ok) {
        const data = await response.json();
        return data.items?.[0] || null;
      }
      return null;
    }

    profileCreationUserId = userId;
    let createdProfile: { _id: string; metadata: Record<string, unknown> | null; onboardingComplete: boolean } | null = null;

    profileCreationInFlight = (async () => {
      try {
        logger.info('Creating user profile', { userId, email });
        const createResponse = await fetch('/api/userProfile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: name?.split(' ')[0] || 'User',
            email,
            metadata: {},
            // NOTE: Do NOT set onboardingComplete here - let the bot control this
          }),
        });

        if (createResponse.ok) {
          const createData = await createResponse.json();
          if (createData.success && createData.data) {
            createdProfile = createData.data;
            logger.info('User profile created successfully', { userId, profileId: createdProfile?._id });
          }
        } else if (createResponse.status === 409) {
          // Profile already exists (race condition) - fetch it
          logger.warn('Profile already exists (409), fetching existing', { userId });
          const retryResponse = await fetch(`/api/userProfile?userId=${encodeURIComponent(userId)}`);
          if (retryResponse.ok) {
            const retryData = await retryResponse.json();
            createdProfile = retryData.items?.[0] || null;
          }
        } else {
          logger.error('Failed to create user profile', { status: createResponse.status });
        }
      } catch (err) {
        logger.error('Failed to create user profile', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        // Clear after completion
        profileCreationInFlight = null;
        profileCreationUserId = null;
      }
    })();

    await profileCreationInFlight;
    return createdProfile;
  }, [logger]);

  /**
   * Fetch user profile, creating if necessary
   */
  const fetchProfile = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    // Prevent multiple simultaneous fetches from this instance
    if (hasInitiatedRef.current) {
      logger.debug('Profile fetch already initiated by this instance, skipping');
      return;
    }
    hasInitiatedRef.current = true;

    setLoading(true);
    setError(null);

    try {
      logger.debug('Fetching user profile', { userId: user.id });
      const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch user profile');
      }

      const data = await response.json();
      let profile = data.items?.[0];

      if (profile) {
        // Profile exists
        logger.info('User profile loaded', { userId: user.id, profileId: profile._id });
        setUserProfileId(profile._id);
        setMetadata(profile.metadata || null);
        setOnboardingComplete(!!profile.onboardingComplete);
        setOverlayDismissed(!!profile.overlayDismissed);
        // NOTE: Do NOT trigger welcome note here - that's only on profile creation
      } else {
        // Profile doesn't exist - create it
        profile = await createProfile(user.id, user.email, user.name);
        
        if (profile) {
          setUserProfileId(profile._id);
          setMetadata(profile.metadata || null);
          setOnboardingComplete(!!profile.onboardingComplete);
          setOverlayDismissed(!!profile.overlayDismissed);
          
          // Trigger welcome note creation ONLY for newly created profiles
          await createWelcomeNote(user.id);
        } else {
          setUserProfileId(null);
          setMetadata(null);
          setOnboardingComplete(false);
          setOverlayDismissed(false);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load user profile';
      logger.error('Failed to load user profile', { error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.email, user?.name, createProfile, createWelcomeNote, logger]);

  /**
   * Refresh profile data (for manual refresh or after bot updates onboardingComplete)
   */
  const refresh = useCallback(async () => {
    if (!user?.id) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(user.id)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch user profile');
      }

      const data = await response.json();
      const profile = data.items?.[0];

      if (profile) {
        setUserProfileId(profile._id);
        setMetadata(profile.metadata || null);
        setOnboardingComplete(!!profile.onboardingComplete);
        setOverlayDismissed(!!profile.overlayDismissed);
      } else {
        setUserProfileId(null);
        setMetadata(null);
        setOnboardingComplete(false);
        setOverlayDismissed(false);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to refresh user profile';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // Initial profile fetch on mount (once session is ready)
  useEffect(() => {
    if (status === 'loading') return;
    if (!user?.id) {
      setLoading(false);
      return;
    }

    fetchProfile();
  }, [status, user?.id, fetchProfile]);

  // Reset initiation flag when user changes
  useEffect(() => {
    hasInitiatedRef.current = false;
  }, [user?.id]);

  /**
   * Dismiss the Pearl overlay and persist to backend
   */
  const dismissOverlay = useCallback(async () => {
    if (!userProfileId) {
      logger.warn('Cannot dismiss overlay: no profile ID');
      return;
    }

    // Optimistically update local state
    setOverlayDismissed(true);

    try {
      logger.info('Persisting overlay dismissal', { profileId: userProfileId });
      const response = await fetch('/api/userProfile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userProfileId,
          overlayDismissed: true,
        }),
      });

      if (!response.ok) {
        logger.error('Failed to persist overlay dismissal', { status: response.status });
        // Revert optimistic update on failure
        setOverlayDismissed(false);
      } else {
        logger.info('Overlay dismissal persisted successfully');
      }
    } catch (err) {
      logger.error('Failed to persist overlay dismissal', {
        error: err instanceof Error ? err.message : String(err),
      });
      // Revert optimistic update on error
      setOverlayDismissed(false);
    }
  }, [userProfileId, logger]);

  const contextValue = useMemo<UserProfileContextType>(() => ({
    userProfileId,
    metadata,
    onboardingComplete,
    overlayDismissed,
    loading,
    error,
    refresh,
    dismissOverlay,
  }), [userProfileId, metadata, onboardingComplete, overlayDismissed, loading, error, refresh, dismissOverlay]);

  return (
    <UserProfileContext.Provider value={contextValue}>
      {children}
    </UserProfileContext.Provider>
  );
}

/**
 * Hook to access user profile data from context.
 * Must be used within a UserProfileProvider.
 */
export function useUserProfile(): UserProfileContextType {
  const context = useContext(UserProfileContext);
  if (!context) {
    throw new Error('useUserProfile must be used within a UserProfileProvider');
  }
  return context;
}

/**
 * Optional hook that returns undefined if not within provider (for backward compatibility)
 */
export function useUserProfileOptional(): UserProfileContextType | undefined {
  return useContext(UserProfileContext);
}
