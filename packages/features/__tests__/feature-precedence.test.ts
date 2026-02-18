
/**
 * Feature gating precedence tests for @nia/features
 *
 * Rules verified:
 * - Explicit supportedFeatures parameter takes precedence over global and env
 * - Global setAssistantSupportedFeatures is used when param is omitted
 * - Environment must still allow the feature (env false always disables)
 * - When neither explicit nor global list is provided, env determines availability
 */

/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */
const DAILY_ENV_PUBLIC = 'NEXT_PUBLIC_FEATURE_DAILYCALL';
const DAILY_ENV_SERVER = 'FEATURE_DAILYCALL';

function clearDailyEnv() {
  delete process.env[DAILY_ENV_PUBLIC];
  delete process.env[DAILY_ENV_SERVER];
}

function setDailyEnv(value: string) {
  process.env[DAILY_ENV_PUBLIC] = value;
  process.env[DAILY_ENV_SERVER] = value;
}

describe('feature gating precedence (@nia/features)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isolate modules per test so env is re-evaluated on import
    jest.resetModules();
    process.env = { ...originalEnv };
    clearDailyEnv();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('explicit supportedFeatures excludes key even if env enables it', () => {
    setDailyEnv('1'); // enabled by env
    jest.isolateModules(() => {
      const { isFeatureEnabled } = require('@nia/features');
      expect(isFeatureEnabled('dailyCall', [])).toBe(false);
    });
  });

  test('explicit supportedFeatures includes key and env enables -> true', () => {
    setDailyEnv('on');
    jest.isolateModules(() => {
      const { isFeatureEnabled } = require('@nia/features');
      expect(isFeatureEnabled('dailyCall', ['dailyCall'])).toBe(true);
    });
  });

  test('explicit supportedFeatures includes key but env disables -> false', () => {
    setDailyEnv('off'); // disabled token
    jest.isolateModules(() => {
      const { isFeatureEnabled } = require('@nia/features');
      expect(isFeatureEnabled('dailyCall', ['dailyCall'])).toBe(false);
    });
  });

  test('global supported features used when explicit param is omitted', () => {
    setDailyEnv('true');
    jest.isolateModules(() => {
      const { setAssistantSupportedFeatures, isFeatureEnabled } = require('@nia/features');
      setAssistantSupportedFeatures(['dailyCall']);
      expect(isFeatureEnabled('dailyCall')).toBe(true);
    });
  });

  test('global excludes key even if env enables', () => {
    setDailyEnv('1');
    jest.isolateModules(() => {
      const { setAssistantSupportedFeatures, isFeatureEnabled } = require('@nia/features');
      setAssistantSupportedFeatures([]);
      expect(isFeatureEnabled('dailyCall')).toBe(false);
    });
  });

  test('passing null for supportedFeatures falls back to global', () => {
    setDailyEnv('1');
    jest.isolateModules(() => {
      const { setAssistantSupportedFeatures, isFeatureEnabled } = require('@nia/features');
      setAssistantSupportedFeatures(['dailyCall']);
      expect(isFeatureEnabled('dailyCall', null)).toBe(true);
    });
  });

  test('env-only: enabled when env enables and no lists provided', () => {
    setDailyEnv('enabled');
    jest.isolateModules(() => {
      const { isFeatureEnabled } = require('@nia/features');
      expect(isFeatureEnabled('dailyCall')).toBe(true);
    });
  });

  test('env-only: disabled by default when env is absent', () => {
    // default in definitions is false
    jest.isolateModules(() => {
      const { isFeatureEnabled } = require('@nia/features');
      expect(isFeatureEnabled('dailyCall', [])).toBe(false);
    });
  });
});
