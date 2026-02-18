import { FeatureKeys, type FeatureKey } from '@nia/features';
import type { AssistantAccessFeatures } from '@nia/prism/core/utils/assistant-login';

export const LOGIN_FEATURE_KEYS = ['googleAuth', 'guestLogin', 'passwordLogin'] as const;
export const REQUIRED_LOGIN_FEATURE_KEYS = ['googleAuth', 'passwordLogin'] as const;
export type LoginFeatureKey = (typeof LOGIN_FEATURE_KEYS)[number];

export interface LoginFeatureMetadata {
    label: string;
    description: string;
}

export const LOGIN_FEATURE_METADATA: Record<LoginFeatureKey, LoginFeatureMetadata> = {
    googleAuth: {
        label: 'Login: Google',
        description: 'Allows users to authenticate with their Google account when globally enabled.',
    },
    guestLogin: {
        label: 'Login: Guest',
        description: 'Provides anonymous guest access when both global and assistant settings permit it.',
    },
    passwordLogin: {
        label: 'Login: Password',
        description: 'Shows the email/password form for accounts managed by the platform.',
    },
};

const FEATURE_KEY_SET = new Set<FeatureKey>(FeatureKeys);

function coerceFeatureKeys(raw: unknown): FeatureKey[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const filtered: FeatureKey[] = [];
    for (const item of raw) {
        if (typeof item === 'string' && FEATURE_KEY_SET.has(item as FeatureKey)) {
            filtered.push(item as FeatureKey);
        }
    }
    return filtered;
}

/**
 * Normalizes the supportedFeatures list for assistants so the login feature keys are present when
 * expected and ordered consistently with the canonical FeatureKeys array.
 */
export function normalizeSupportedFeatures(
    _assistant: AssistantAccessFeatures,
    rawFeatures: unknown,
): FeatureKey[] {
    const initial = coerceFeatureKeys(rawFeatures);
    const hasInitialSelection = initial.length > 0;

    // Start from either the explicit selection or the canonical defaults when nothing is configured.
    const workingSet = new Set<FeatureKey>(hasInitialSelection ? initial : FeatureKeys);

    const hasRequiredLoginFeature = REQUIRED_LOGIN_FEATURE_KEYS.some(key => workingSet.has(key));

    // When no required login feature has ever been selected, ensure sensible defaults are present.
    if (!hasRequiredLoginFeature && !hasInitialSelection) {
        for (const key of REQUIRED_LOGIN_FEATURE_KEYS) {
            workingSet.add(key);
        }
    }

    // Return in canonical order so checkbox rendering is stable.
    return FeatureKeys.filter(key => workingSet.has(key));
}
