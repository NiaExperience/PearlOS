'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';
import {
  PEARLOS_USER_PREFERENCES_KEY,
  type PearlOSUserPreferences,
} from '@interface/lib/pearlos-user-preferences';

import type { IPublicPersona, IPrivateMemory } from '@nia/prism/core/blocks/userProfile.block';

/**
 * User Profile Context
 *
 * Single source of truth for user profile data. Loads once at app startup,
 * prevents race conditions from multiple components trying to fetch/create profiles.
 */

interface UserProfileContextType {
  /** User profile document ID */
  userProfileId: string | null;
  /** Social-shareable persona. Never assume it's populated. */
  publicPersona: IPublicPersona | null;
  /** User-Pearl-only memory. Never exposed outside the app. */
  privateMemory: IPrivateMemory | null;
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
  /** Merge PearlOS UI preferences into this user's private profile memory. */
  updatePearlOSPreferences: (patch: Partial<PearlOSUserPreferences>) => Promise<void>;
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

interface LoadedProfile {
  _id: string;
  publicPersona?: IPublicPersona | null;
  privateMemory?: IPrivateMemory | null;
  onboardingComplete?: boolean;
  overlayDismissed?: boolean;
}

export function UserProfileProvider({ children, tenantId }: UserProfileProviderProps) {
  const logger = useMemo(() => getClientLogger('[user_profile]'), []);
  const { data: session, status } = useResilientSession();
  const user = session?.user;

  const [userProfileId, setUserProfileId] = useState<string | null>(null);
  const [publicPersona, setPublicPersona] = useState<IPublicPersona | null>(null);
  const [privateMemory, setPrivateMemory] = useState<IPrivateMemory | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(false);
  const [overlayDismissed, setOverlayDismissed] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Track if this instance has already initiated profile operations
  const hasInitiatedRef = useRef(false);

  const applyProfile = useCallback((profile: LoadedProfile | null | undefined) => {
    if (!profile) {
      setUserProfileId(null);
      setPublicPersona(null);
      setPrivateMemory(null);
      setOnboardingComplete(false);
      setOverlayDismissed(false);
      return;
    }
    setUserProfileId(profile._id);
    setPublicPersona(profile.publicPersona ?? null);
    setPrivateMemory(profile.privateMemory ?? null);
    setOnboardingComplete(!!profile.onboardingComplete);
    setOverlayDismissed(!!profile.overlayDismissed);
  }, []);

  /**
   * Create welcome note for user (deduplicated at module level)
   */
  const createWelcomeNote = useCallback(async (userId: string) => {
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
  const createProfile = useCallback(async (userId: string, email: string | null | undefined, name: string | null | undefined): Promise<LoadedProfile | null> => {
    if (profileCreationInFlight && profileCreationUserId === userId) {
      logger.debug('Profile creation already in flight, waiting', { userId });
      await profileCreationInFlight;
      const response = await fetch(`/api/userProfile?userId=${encodeURIComponent(userId)}`);
      if (response.ok) {
        const data = await response.json();
        return data.items?.[0] || null;
      }
      return null;
    }

    profileCreationUserId = userId;
    let createdProfile: LoadedProfile | null = null;

    profileCreationInFlight = (async () => {
      try {
        logger.info('Creating user profile', { userId, email });
        const createResponse = await fetch('/api/userProfile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            first_name: name?.split(' ')[0] || 'User',
            email,
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
      let profile: LoadedProfile | null = data.items?.[0] ?? null;

      if (profile) {
        logger.info('User profile loaded', { userId: user.id, profileId: profile._id });
        applyProfile(profile);
        // NOTE: Do NOT trigger welcome note here - that's only on profile creation
      } else {
        profile = await createProfile(user.id, user.email, user.name);

        applyProfile(profile);
        if (profile) {
          // Trigger welcome note creation ONLY for newly created profiles
          await createWelcomeNote(user.id);
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load user profile';
      logger.error('Failed to load user profile', { error: message });
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.email, user?.name, createProfile, createWelcomeNote, logger, applyProfile]);

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
      const profile: LoadedProfile | null = data.items?.[0] ?? null;
      applyProfile(profile);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to refresh user profile';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [user?.id, applyProfile]);

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
        setOverlayDismissed(false);
      } else {
        logger.info('Overlay dismissal persisted successfully');
      }
    } catch (err) {
      logger.error('Failed to persist overlay dismissal', {
        error: err instanceof Error ? err.message : String(err),
      });
      setOverlayDismissed(false);
    }
  }, [userProfileId, logger]);

  const updatePearlOSPreferences = useCallback(async (patch: Partial<PearlOSUserPreferences>) => {
    if (!userProfileId) {
      logger.warn('Cannot persist PearlOS preferences: no profile ID');
      return;
    }

    const previousMemory = privateMemory;
    const existingPreferences = previousMemory?.preferences || {};
    const existingPearlOS =
      existingPreferences[PEARLOS_USER_PREFERENCES_KEY] &&
      typeof existingPreferences[PEARLOS_USER_PREFERENCES_KEY] === 'object' &&
      !Array.isArray(existingPreferences[PEARLOS_USER_PREFERENCES_KEY])
        ? existingPreferences[PEARLOS_USER_PREFERENCES_KEY] as PearlOSUserPreferences
        : {};
    const nextPearlOS = { ...existingPearlOS, ...patch };
    const nextMemory = {
      ...(previousMemory || {}),
      preferences: {
        ...existingPreferences,
        [PEARLOS_USER_PREFERENCES_KEY]: nextPearlOS,
      },
    };

    setPrivateMemory(nextMemory);

    try {
      const response = await fetch('/api/userProfile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: userProfileId,
          privateMemory: {
            preferences: {
              [PEARLOS_USER_PREFERENCES_KEY]: nextPearlOS,
            },
          },
        }),
      });

      if (!response.ok) {
        setPrivateMemory(previousMemory);
        logger.error('Failed to persist PearlOS preferences', { status: response.status });
      }
    } catch (err) {
      setPrivateMemory(previousMemory);
      logger.error('Failed to persist PearlOS preferences', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [userProfileId, privateMemory, logger]);

  const contextValue = useMemo<UserProfileContextType>(() => ({
    userProfileId,
    publicPersona,
    privateMemory,
    onboardingComplete,
    overlayDismissed,
    loading,
    error,
    refresh,
    dismissOverlay,
    updatePearlOSPreferences,
  }), [userProfileId, publicPersona, privateMemory, onboardingComplete, overlayDismissed, loading, error, refresh, dismissOverlay, updatePearlOSPreferences]);

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
