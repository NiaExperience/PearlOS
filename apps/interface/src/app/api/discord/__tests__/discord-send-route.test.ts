import { NextResponse } from 'next/server';

jest.mock('../_lib/require-discord-account', () => ({
  getDiscordBotToken: jest.fn(() => 'bot-token'),
  requireChannelInConfiguredGuild: jest.fn(() => null),
  requireConfiguredGuild: jest.fn(() => null),
  requireDiscordAccount: jest.fn(),
  requireGuildMembership: jest.fn(() => null),
}));

const { requireDiscordAccount } = jest.requireMock('../_lib/require-discord-account') as {
  requireDiscordAccount: jest.Mock;
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(content = 'hello from the interface') {
  return {
    json: jest.fn().mockResolvedValue({
      channelId: '1471441655650324533',
      content,
    }),
  };
}

describe('/api/discord/send', () => {
  const originalGuildId = process.env.DISCORD_GUILD_ID;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DISCORD_GUILD_ID = '1471441655126167553';
    requireDiscordAccount.mockResolvedValue({
      ok: true,
      userId: 'pearlos-user',
      account: {
        userId: 'pearlos-user',
        provider: 'discord',
        providerAccountId: '111111111111111111',
        type: 'oauth',
      },
    });
  });

  afterAll(() => {
    process.env.DISCORD_GUILD_ID = originalGuildId;
  });

  it('sends interface Discord messages through a user-attributed webhook when available', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        nick: 'Blair',
        user: { username: 'blair', avatar: 'avatarhash' },
      }))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({
        id: 'webhook-id',
        token: 'webhook-token',
        name: 'PearlOS Interface',
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'discord-message' })) as jest.Mock;

    const { POST } = require('../send/route');
    const res = await POST(request());
    const body = await res.json();

    expect(body).toEqual({ success: true, messageId: 'discord-message', sentVia: 'webhook' });
    expect(global.fetch).toHaveBeenLastCalledWith(
      'https://discord.com/api/v10/webhooks/webhook-id/webhook-token',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"username":"Blair"'),
      }),
    );
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[3][1].body)).toMatchObject({
      content: 'hello from the interface',
      username: 'Blair',
      avatar_url: 'https://cdn.discordapp.com/avatars/111111111111111111/avatarhash.png?size=128',
      allowed_mentions: { parse: [] },
    });
  });

  it('does not fall back to a Pearl bot message when the user-attributed webhook is unavailable', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        nick: 'Blair',
        user: { username: 'blair', avatar: null },
      }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Missing Permissions' }, { status: 403 })) as jest.Mock;

    const { POST } = require('../send/route');
    const res = await POST(request('fallback path'));
    const body = await res.json();

    expect(res.status).toBe(424);
    expect(body).toMatchObject({
      error: 'Discord webhook unavailable',
      code: 'DISCORD_WEBHOOK_REQUIRED',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('still blocks unauthenticated sends before parsing the body', async () => {
    requireDiscordAccount.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    global.fetch = jest.fn() as jest.Mock;

    const { POST } = require('../send/route');
    const req = request();
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(req.json).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
