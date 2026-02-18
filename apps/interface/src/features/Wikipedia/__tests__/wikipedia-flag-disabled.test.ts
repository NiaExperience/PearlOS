/**
 * @jest-environment node
 */

describe('wikipedia feature flag disabled', () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });
  it('disables wikipedia when NEXT_PUBLIC_FEATURE_WIKIPEDIA=false', () => {
    process.env = { ...originalEnv, NEXT_PUBLIC_FEATURE_WIKIPEDIA: 'false' } as NodeJS.ProcessEnv;
    jest.resetModules();
  const { isFeatureEnabled, featureFlags } = require('@nia/features');
    expect(isFeatureEnabled('wikipedia')).toBe(false);
    expect(featureFlags['wikipedia']).toBe(false);
  });
});
