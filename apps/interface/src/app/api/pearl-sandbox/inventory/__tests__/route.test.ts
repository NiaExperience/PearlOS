const mockFindByUser = jest.fn();
const mockGetSession = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  UserProfileActions: {
    findByUser: (...args: unknown[]) => mockFindByUser(...args),
  },
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSession(...args),
}));

jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: {} }));

import { GET, POST } from '../route';

const BOT_HEADER_VALUE = ['bot', 'secret'].join('-');

function req(body: unknown = {}, headers: Record<string, string> = {}, query = '') {
  const headerMap = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (k: string) => headerMap.get(k.toLowerCase()) ?? null },
    json: async () => body,
    nextUrl: { searchParams: new URLSearchParams(query) },
  } as any;
}

function profileWithThemes() {
  return {
    userProfile: {
      _id: 'profile-1',
      userId: 'blair-id',
      email: 'blair@niaxp.com',
      privateMemory: {
        preferences: {
          pearlOSSettings: {
            interfaceCustomization: {
              theme: 'custom-jurassic-park-m2x',
              customThemes: [
                {
                  id: 'custom-jurassic-park-m2x',
                  label: 'Jurassic Park',
                  prompt: 'Jurassic Park theme with dark jungle greens and amber warning lights',
                  backgrounds: { home: '/api/pixel-art/image/home.png', desktop: '/api/pixel-art/image/desk.png' },
                },
                {
                  id: 'custom-ocean-m1x',
                  label: 'Ocean',
                  prompt: 'calm ocean theme',
                  backgrounds: { home: '/api/pixel-art/image/ocean-home.png', desktop: '/api/pixel-art/image/ocean-desk.png' },
                },
              ],
            },
          },
        },
      },
    },
  };
}

describe('/api/pearl-sandbox/inventory', () => {
  const originalSecret = process.env.BOT_CONTROL_SHARED_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOT_CONTROL_SHARED_SECRET = BOT_HEADER_VALUE;
    mockFindByUser.mockResolvedValue(profileWithThemes());
  });

  afterAll(() => {
    process.env.BOT_CONTROL_SHARED_SECRET = originalSecret;
  });

  it('returns ranked custom theme matches for bot inventory queries', async () => {
    const res = await POST(
      req(
        { requester_email: 'blair@niaxp.com', query: 'Jurassic Park theme' },
        { 'x-bot-secret': BOT_HEADER_VALUE },
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.matches.customThemes[0]).toMatchObject({
      id: 'custom-jurassic-park-m2x',
      label: 'Jurassic Park',
    });
    expect(json.summary.customThemeCount).toBe(2);
  });

  it('supports signed-in GET inventory search', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'blair-id', email: 'blair@niaxp.com' } });

    const res = await GET(req({}, {}, 'query=jurassic'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.matches.customThemes).toHaveLength(1);
    expect(json.matches.customThemes[0].id).toBe('custom-jurassic-park-m2x');
  });
});
