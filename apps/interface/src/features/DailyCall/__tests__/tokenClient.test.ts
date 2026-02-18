/* eslint-disable @typescript-eslint/no-explicit-any */
import { clearTokenCache, requestDailyJoinToken } from '../lib/tokenClient';

describe('requestDailyJoinToken', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearTokenCache();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    clearTokenCache();
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  it('requests a token and caches subsequent calls for the same room', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'cached-token' }),
    });

    const roomUrl = 'https://example.daily.co/dev-room';
    const firstToken = await requestDailyJoinToken(roomUrl);
    const secondToken = await requestDailyJoinToken(roomUrl);

    expect(firstToken).toBe('cached-token');
    expect(secondToken).toBe('cached-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith('/api/dailyCall/token', expect.objectContaining({ method: 'POST' }));
  });

  it('sends stealth flag and keeps a separate cache entry when requested', async () => {
    const roomUrl = 'https://example.daily.co/dev-room';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'standard-token' }),
    });

    const standardToken = await requestDailyJoinToken(roomUrl, { stealth: false });
    expect(standardToken).toBe('standard-token');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'stealth-token' }),
    });

    const stealthToken = await requestDailyJoinToken(roomUrl, { stealth: true });
    expect(stealthToken).toBe('stealth-token');

    // Ensure the stealth call included the flag and did not reuse the standard cache entry
    const stealthCall = (global.fetch as jest.Mock).mock.calls[1];
    expect(stealthCall[0]).toBe('/api/dailyCall/token');
    const body = JSON.parse((stealthCall[1] as any).body as string);
    expect(body.stealth).toBe(true);

    // Subsequent stealth call should use cache (no extra fetch)
    const secondStealth = await requestDailyJoinToken(roomUrl, { stealth: true });
    expect(secondStealth).toBe('stealth-token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('sends displayName and caches tokens per display name', async () => {
    const roomUrl = 'https://example.daily.co/dev-room';

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'alice-token' }),
    });

    const aliceToken = await requestDailyJoinToken(roomUrl, { displayName: 'Alice' });
    expect(aliceToken).toBe('alice-token');

    const firstCall = (global.fetch as jest.Mock).mock.calls[0];
    const firstBody = JSON.parse((firstCall[1] as any).body as string);
    expect(firstBody.displayName).toBe('Alice');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'bob-token' }),
    });

    const bobToken = await requestDailyJoinToken(roomUrl, { displayName: 'Bob' });
    expect(bobToken).toBe('bob-token');

    // Cached Alice token should be reused without another fetch
    const cachedAlice = await requestDailyJoinToken(roomUrl, { displayName: 'Alice' });
    expect(cachedAlice).toBe('alice-token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throws when roomUrl is missing', async () => {
    await expect(requestDailyJoinToken('')).rejects.toThrow('roomUrl is required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('throws when the server responds with a non-OK status', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'error',
    });

    await expect(requestDailyJoinToken('https://example.daily.co/dev-room')).rejects.toThrow(
      'Failed to fetch Daily meeting token: 500 error'
    );
  });

  it('throws when the response payload is missing a token', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    await expect(requestDailyJoinToken('https://example.daily.co/dev-room')).rejects.toThrow(
      'Missing Daily meeting token in response'
    );
  });
});
