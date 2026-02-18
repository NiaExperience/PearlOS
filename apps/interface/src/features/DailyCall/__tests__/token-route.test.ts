/* eslint-disable @typescript-eslint/no-explicit-any */
import { STEALTH_USER_ID } from '@nia/features';
import { getSessionSafely } from '@nia/prism/core/auth';
import type { NextRequest } from 'next/server';

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: { mock: 'auth-options' } }));

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;

const originalFetch = global.fetch;
const originalApiKey = process.env.DAILY_API_KEY;

const buildRequest = (body: any = {}): NextRequest =>
  ({
    url: 'http://localhost:3000/api/dailyCall/token',
    headers: new Headers(),
    json: async () => body,
  } as unknown as NextRequest);

const loadPostImpl = () => {
  let exports: any;
  jest.isolateModules(() => {
    exports = require('../routes/tokenImpl');
  });
  return exports.POST_impl as (request: NextRequest) => Promise<Response>;
};

describe('dailyCall token route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.DAILY_API_KEY;
    } else {
      process.env.DAILY_API_KEY = originalApiKey;
    }
  });

  it('returns 500 when DAILY_API_KEY is missing', async () => {
    delete process.env.DAILY_API_KEY;
    const POST_impl = loadPostImpl();
    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('daily_api_key_missing');
    expect(mockGetSessionSafely).not.toHaveBeenCalled();
  });

  it('returns 401 when session is missing', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue(null as any);
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room' }));
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('unauthorized');
  });

  it('returns 400 when room information is missing', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1' } } as any);
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest());
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('room_name_required');
  });

  it('returns 502 when Daily API response is missing a token', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1' } } as any);
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({}) });
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room' }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe('token_missing');
  });

  it('returns token payload when Daily API succeeds', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1', name: 'Test User', email: 'test@example.com' } } as any);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'daily-token' }),
    });
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room' }));
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.daily.co/v1/meeting-tokens',
      expect.objectContaining({ method: 'POST' })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('daily-token');
  });

  it('prefers provided displayName over session name', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1', name: 'Session Name', email: 'session@example.com' } } as any);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'daily-token' }),
    });
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room', displayName: 'Bob' }));

    const fetchArgs = (global.fetch as jest.Mock).mock.calls[0][1];
    const parsedBody = JSON.parse((fetchArgs as any).body as string);
    expect(parsedBody.properties.user_name).toBe('Bob');

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('daily-token');
  });

  it('returns token payload with stealth identity when requested', async () => {
    process.env.DAILY_API_KEY = 'test-key';
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1', name: 'Test User', email: 'test@example.com' } } as any);
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'daily-token' }),
    });
    const POST_impl = loadPostImpl();

    const res = await POST_impl(buildRequest({ roomUrl: 'https://example.daily.co/dev-room', stealth: true }));

    const fetchArgs = (global.fetch as jest.Mock).mock.calls[0][1];
    const parsedBody = JSON.parse((fetchArgs as any).body as string);
    expect(parsedBody.properties.user_id).toBe(STEALTH_USER_ID);
    expect(parsedBody.properties.user_name).toBe('Guest');

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.token).toBe('daily-token');
  });
});
