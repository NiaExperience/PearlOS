import { FeatureKeys } from '@nia/features';
import type { AssistantAccessFeatures } from '@nia/prism/core/utils/assistant-login';

import {
  LOGIN_FEATURE_KEYS,
  LOGIN_FEATURE_METADATA,
  normalizeSupportedFeatures,
} from '../src/lib/feature-normalization';

const baseAssistant = (overrides: Partial<AssistantAccessFeatures> = {}): AssistantAccessFeatures => ({
  allowAnonymousLogin: true,
  supportedFeatures: [],
  ...overrides,
});

describe('normalizeSupportedFeatures', () => {
  it('falls back to canonical features when none are provided', () => {
    const normalized = normalizeSupportedFeatures(baseAssistant(), undefined);
    expect(normalized).toEqual(FeatureKeys);
  });

  it('preserves explicit login feature selections', () => {
    const features = ['googleAuth', 'notes'] as const;
    const normalized = normalizeSupportedFeatures(baseAssistant({ supportedFeatures: features }), features);
    expect(normalized).toEqual(expect.arrayContaining(features));
    expect(normalized).not.toEqual(expect.arrayContaining(['guestLogin']));
  });

  it('does not force login features when the assistant explicitly omits them', () => {
    const normalized = normalizeSupportedFeatures(baseAssistant(), ['notes']);
    expect(normalized).toEqual(expect.arrayContaining(['notes']));
    expect(normalized).not.toContain('googleAuth');
    expect(normalized).not.toContain('passwordLogin');
    expect(normalized).not.toContain('guestLogin');
  });

  it('leaves guestLogin disabled when anonymous access was previously disallowed', () => {
    const assistant = baseAssistant({ allowAnonymousLogin: false });
    const normalized = normalizeSupportedFeatures(assistant, ['notes']);
    expect(normalized).not.toContain('guestLogin');
  });
});

describe('LOGIN_FEATURE_METADATA', () => {
  it('defines metadata for each login feature key with canonical labels', () => {
    for (const key of LOGIN_FEATURE_KEYS) {
      expect(LOGIN_FEATURE_METADATA).toHaveProperty(key);
      expect(LOGIN_FEATURE_METADATA[key].label).toMatch(/^Login: /u);
      expect(typeof LOGIN_FEATURE_METADATA[key].description).toBe('string');
      expect(LOGIN_FEATURE_METADATA[key].description.length).toBeGreaterThan(0);
    }
  });
});
