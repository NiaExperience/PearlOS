import { NextResponse } from 'next/server';
import { requireDiscordAccount } from '../_lib/require-discord-account';

jest.mock('../_lib/require-discord-account', () => ({
  requireDiscordAccount: jest.fn(),
}));

const mockRequireDiscordAccount = requireDiscordAccount as jest.MockedFunction<typeof requireDiscordAccount>;

function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

describe('Discord bot API auth gates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    mockRequireDiscordAccount.mockResolvedValue({ ok: false, response: unauthorizedResponse() } as any);
  });

  it('blocks channel listing before Discord fetches', async () => {
    const { GET } = require('../channels/route');
    const res = await GET({ nextUrl: new URL('http://localhost/api/discord/channels') });

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks message reads before Discord fetches', async () => {
    const { GET } = require('../messages/route');
    const res = await GET({ nextUrl: new URL('http://localhost/api/discord/messages?channelId=1471441655650324533') });

    expect(res.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks channel sends before body parsing or Discord fetches', async () => {
    const { POST } = require('../send/route');
    const req = { json: jest.fn() };
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(req.json).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks direct messages before body parsing or Discord fetches', async () => {
    const { POST } = require('../dm/route');
    const req = { json: jest.fn() };
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(req.json).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
