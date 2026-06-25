const mockFindByUser = jest.fn();
const mockCreateOrUpdate = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  UserProfileActions: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
    createOrUpdateUserProfile: (...args: unknown[]) => mockCreateOrUpdate(...args),
  },
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: {} }));

import { POST } from '../route';
import { OUR_PEARLOS_FEATURES } from '@interface/lib/our-pearlos-catalog';

const COMMUNITY_ID = OUR_PEARLOS_FEATURES.find((f) => f.status === 'community')!.id;
const PUBLIC_ID = OUR_PEARLOS_FEATURES.find((f) => f.status === 'public')!.id;

function postReq(body: unknown) {
  return {
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

describe('/api/our-pearlos/vote', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByUser.mockResolvedValue({
      userProfile: { _id: 'p1', userId: 'alice-id', email: 'alice@example.com', privateMemory: {} },
    });
    mockCreateOrUpdate.mockResolvedValue({ _id: 'p1' });
  });

  it('rejects an unauthenticated vote', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postReq({ featureId: COMMUNITY_ID, voted: true }));
    expect(res.status).toBe(401);
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('rejects a vote for a non-votable feature', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'alice-id' } });
    const res = await POST(postReq({ featureId: PUBLIC_ID, voted: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_feature');
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  it('records a vote scoped to the requesting user only', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'alice-id', email: 'alice@example.com' } });
    const res = await POST(postReq({ featureId: COMMUNITY_ID, voted: true }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.feature.hasVoted).toBe(true);

    expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    const saved = mockCreateOrUpdate.mock.calls[0][0];
    expect(saved.userId).toBe('alice-id');
    const votes = saved.privateMemory.preferences.pearlOSSettings.featureVotes;
    expect(votes[COMMUNITY_ID]).toBe(true);
  });

  it('removes a vote when voted is false', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'alice-id' } });
    mockFindByUser.mockResolvedValue({
      userProfile: {
        _id: 'p1',
        userId: 'alice-id',
        privateMemory: {
          preferences: { pearlOSSettings: { featureVotes: { [COMMUNITY_ID]: true } } },
        },
      },
    });
    const res = await POST(postReq({ featureId: COMMUNITY_ID, voted: false }));
    expect(res.status).toBe(200);
    const saved = mockCreateOrUpdate.mock.calls[0][0];
    const votes = saved.privateMemory.preferences.pearlOSSettings.featureVotes;
    expect(votes[COMMUNITY_ID]).toBeUndefined();
  });
});
