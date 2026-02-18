import { isFeatureEnabled } from '@nia/features';

import { shouldGateDailyCall } from '@interface/features/DailyCall/lib/requireUserProfileGate';

jest.mock('@nia/features', () => ({
  isFeatureEnabled: jest.fn(),
}));

const mockedIsFeatureEnabled = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;

describe('shouldGateDailyCall', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false when feature flag is disabled via env fallback', async () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    const result = await shouldGateDailyCall({
      supportedFeatures: undefined,
      userId: 'user-1',
      fetchProfile: jest.fn(),
    });

    expect(result).toEqual({ shouldGate: false, reason: 'feature-disabled' });
    expect(mockedIsFeatureEnabled).toHaveBeenCalledWith('requireUserProfile');
  });

  it('returns false when no userId is provided', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: undefined,
      fetchProfile: jest.fn(),
    });

    expect(result).toEqual({ shouldGate: false, reason: 'no-session' });
  });

  it('gates when profile fetch returns null', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: 'user-1',
      fetchProfile: jest.fn().mockResolvedValue(null),
    });

    expect(result).toEqual({ shouldGate: true, reason: 'missing-profile' });
  });

  it('gates when profile is missing first_name', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: 'user-1',
      fetchProfile: jest.fn().mockResolvedValue({ first_name: '' }),
    });

    expect(result).toEqual({ shouldGate: true, reason: 'missing-first-name' });
  });

  it('returns false when profile has first_name', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: 'user-1',
      fetchProfile: jest.fn().mockResolvedValue({ first_name: 'Jane' }),
    });

    expect(result).toEqual({ shouldGate: false, reason: 'complete' });
  });

  it('gates when fetch throws', async () => {
    mockedIsFeatureEnabled.mockReturnValue(true);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: 'user-1',
      fetchProfile: jest.fn().mockRejectedValue(new Error('boom')),
    });

    expect(result).toEqual({ shouldGate: true, reason: 'fetch-error' });
  });

  it('enables gating when supported features explicitly require profile', async () => {
    mockedIsFeatureEnabled.mockReturnValue(false);
    const fetchProfile = jest.fn().mockResolvedValue(null);
    const result = await shouldGateDailyCall({
      supportedFeatures: ['dailyCall', 'requireUserProfile'],
      userId: 'user-2',
      fetchProfile,
    });

    expect(result).toEqual({ shouldGate: true, reason: 'missing-profile' });
    expect(fetchProfile).toHaveBeenCalledWith('user-2');
  });
});
