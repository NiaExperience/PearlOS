import { isFeatureEnabled } from '@nia/features';

import { getClientLogger } from '@interface/lib/client-logger';

type ProfileFetchResult = {
  first_name?: string | null;
};

export type ProfileGateReason =
  | 'feature-disabled'
  | 'no-session'
  | 'missing-profile'
  | 'missing-first-name'
  | 'fetch-error'
  | 'complete';

export interface ProfileGateResult {
  shouldGate: boolean;
  reason: ProfileGateReason;
}

export interface ProfileGateOptions {
  supportedFeatures?: string[] | null;
  userId?: string | null;
  fetchProfile: (userId: string) => Promise<ProfileFetchResult | null>;
}

export interface RequireProfileEvaluation {
  enabled: boolean;
  source: 'supported-features' | 'env';
  missing: string[];
}

export function evaluateRequireUserProfileGate(
  supportedFeatures?: string[] | null
): RequireProfileEvaluation {
  if (Array.isArray(supportedFeatures)) {
    const featureSet = new Set(supportedFeatures);
    const missing: string[] = [];
    if (!featureSet.has('requireUserProfile')) {
      missing.push('requireUserProfile');
    }
    if (!featureSet.has('dailyCall')) {
      missing.push('dailyCall');
    }

    return {
      enabled: missing.length === 0,
      source: 'supported-features',
      missing,
    };
  }

  const envEnabled = isFeatureEnabled('requireUserProfile');
  return {
    enabled: envEnabled,
    source: 'env',
    missing: envEnabled ? [] : ['requireUserProfile'],
  };
}

export async function shouldGateDailyCall(options: ProfileGateOptions): Promise<ProfileGateResult> {
  const { supportedFeatures, userId, fetchProfile } = options;

  const log = getClientLogger('[daily_call]');

  const evaluation = evaluateRequireUserProfileGate(supportedFeatures);
  if (!evaluation.enabled) {
    return { shouldGate: false, reason: 'feature-disabled' };
  }

  if (!userId) {
    return { shouldGate: false, reason: 'no-session' };
  }

  try {
    const profile = await fetchProfile(userId);
    if (!profile) {
      return { shouldGate: true, reason: 'missing-profile' };
    }

    const firstName = typeof profile.first_name === 'string' ? profile.first_name.trim() : '';
    if (!firstName) {
      return { shouldGate: true, reason: 'missing-first-name' };
    }

    return { shouldGate: false, reason: 'complete' };
  } catch (error) {
    log.warn('Failed to evaluate user profile for gating', {
      event: 'daily_call_profile_gate_fetch_error',
      userId,
      error,
    });
    return { shouldGate: true, reason: 'fetch-error' };
  }
}
