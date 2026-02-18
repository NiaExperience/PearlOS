/* eslint-disable @typescript-eslint/no-explicit-any */
import { joinRoom } from '../lib/botClient';

// Unit tests for joinRoom (bot join proxy)

describe('joinRoom', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch as any;
    jest.resetAllMocks();
  });

  it('posts to /api/bot/join with required payload and returns parsed JSON', async () => {
    const mockResp = { ok: true, status: 200, json: async () => ({ pid: 42, room_url: 'https://room', personality: 'x' }) } as any;
    const fn = jest.fn().mockResolvedValue(mockResp);
    global.fetch = fn;

    const room_url = 'https://daily.test/room';
    const resp = await joinRoom(room_url, { personalityId: 'p1', persona: 'Pearl', tenantId: 't1', voice: 'v1', voiceProvider: 'kokoro' });

    expect(fn).toHaveBeenCalledTimes(1);
    const [url, init] = fn.mock.calls[0];
    expect(url).toBe('/api/bot/join');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.room_url).toBe(room_url);
    expect(body.personalityId).toBe('p1');
    expect(body.persona).toBe('Pearl');
    expect(body.tenantId).toBe('t1');
    expect(body.voice).toBe('v1');
    expect(body.voiceProvider).toBe('kokoro');

    expect(resp).toEqual({ pid: 42, room_url: 'https://room', personality: 'x' });
  });

  it('includes identity fields when provided (non-stealth path responsibility)', async () => {
    const mockResp = { ok: true, status: 200, json: async () => ({ pid: 7, room_url: 'u', personality: 'y' }) } as any;
    const fn = jest.fn().mockResolvedValue(mockResp);
    global.fetch = fn;

    await joinRoom('u', {
      personalityId: 'P',
      persona: 'Pearl',
      tenantId: 'T',
      voice: 'V',
      sessionUserId: 'uid-1',
      sessionUserEmail: 'e@example.com',
      sessionUserName: 'Alice',
    });

    const [_, init] = fn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.sessionUserId).toBe('uid-1');
    expect(body.sessionUserEmail).toBe('e@example.com');
    expect(body.sessionUserName).toBe('Alice');
  });

  it('propagates fetch/network errors with a helpful warning', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fn;

    await expect(
      joinRoom('https://room', { personalityId: 'p' })
    ).rejects.toThrow(/network down/);
  });

  it('throws on non-2xx responses', async () => {
    const mockResp = { ok: false, status: 500, json: async () => ({ error: 'x' }) } as any;
    const fn = jest.fn().mockResolvedValue(mockResp);
    global.fetch = fn;

    await expect(
      joinRoom('https://room', { personalityId: 'p' })
    ).rejects.toThrow(/HTTP 500/);
  });

  // Stealth mode tests
  it('omits identity fields when none provided (stealth-like scenario)', async () => {
    const mockResp = { ok: true, status: 200, json: async () => ({ pid: 99, room_url: 'stealth-room', personality: 'hidden' }) } as any;
    const fn = jest.fn().mockResolvedValue(mockResp);
    global.fetch = fn;

    await joinRoom('stealth-room', {
      personalityId: 'stealth-personality',
      persona: 'Pearl',
      tenantId: 'stealth-tenant'
      // No session identity fields provided (stealth mode)
    });

    const [, init] = fn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('sessionUserId');
    expect(body).not.toHaveProperty('sessionUserEmail');
    expect(body).not.toHaveProperty('sessionUserName');
    expect(body.personalityId).toBe('stealth-personality');
  });

  it('omits empty identity fields (stealth caller responsibility)', async () => {
    const mockResp = { ok: true, status: 200, json: async () => ({ pid: 100, room_url: 'stealth-room2', personality: 'hidden' }) } as any;
    const fn = jest.fn().mockResolvedValue(mockResp);
    global.fetch = fn;

    await joinRoom('stealth-room2', {
      personalityId: 'stealth-p2',
      persona: 'Pearl',
      tenantId: 'stealth-t2',
      sessionUserId: undefined,
      sessionUserEmail: undefined,
      sessionUserName: undefined
    });

    const [, init] = fn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('sessionUserId');
    expect(body).not.toHaveProperty('sessionUserEmail');
    expect(body).not.toHaveProperty('sessionUserName');
  });
});
