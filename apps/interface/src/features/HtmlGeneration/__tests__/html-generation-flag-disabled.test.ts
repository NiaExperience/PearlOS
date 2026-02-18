/**
 * @jest-environment node
 */

// Tests that individual feature flags correctly disable when env vars are set to false/0

describe('feature flags disabled states', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  function expectDisabled(key: string, envVar: string) {
    // Arrange
    process.env = { ...originalEnv, [envVar]: 'false' } as NodeJS.ProcessEnv;
    jest.resetModules();
  const { isFeatureEnabled, featureFlags } = require('@nia/features');

    // Assert function result & cached map
    expect(isFeatureEnabled(key)).toBe(false);
    expect(featureFlags[key]).toBe(false);
  }

  it('disables htmlContent when NEXT_PUBLIC_FEATURE_HTMLCONTENT=false', () => {
    expectDisabled('htmlContent', 'NEXT_PUBLIC_FEATURE_HTMLCONTENT');
  });
});
