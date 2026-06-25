import { getDiscordDmLinkedAccountScope } from '@nia/prism/core/actions/discord-dm-link-actions';

jest.mock('@nia/prism/core/actions/discord-dm-link-actions', () => ({
  getDiscordDmLinkedAccountScope: jest.fn(),
}));

const mockGetScope = getDiscordDmLinkedAccountScope as jest.MockedFunction<typeof getDiscordDmLinkedAccountScope>;

function request(discordUserId: string, secret = 'test-secret') {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'x-internal-secret' ? secret : null),
    },
    nextUrl: new URL(`http://localhost/api/discord/dm-link/check?discordUserId=${discordUserId}`),
  } as any;
}

describe('/api/discord/dm-link/check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DISCORD_DM_LINK_SECRET = 'test-secret';
  });

  it('returns the linked PearlOS requester scope for an exact Discord user', async () => {
    mockGetScope.mockResolvedValue({
      discordUserId: '111111111111111111',
      userId: 'alice-id',
      email: 'alice@example.com',
      tenantId: 'tenant-a',
    });
    const { GET } = require('../route');

    const res = await GET(request('111111111111111111'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(mockGetScope).toHaveBeenCalledWith('111111111111111111');
    expect(json).toEqual({
      allowed: true,
      discordUserId: '111111111111111111',
      userId: 'alice-id',
      email: 'alice@example.com',
      tenantId: 'tenant-a',
    });
  });

  it('does not allow unlinked Discord users', async () => {
    mockGetScope.mockResolvedValue(null);
    const { GET } = require('../route');

    const res = await GET(request('333333333333333333'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ allowed: false });
  });
});
