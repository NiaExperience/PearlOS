const mockCreateBotClaimHeaders = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/bot-auth-claims', () => ({
  createBotClaimHeaders: (...args: unknown[]) => mockCreateBotClaimHeaders(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

import * as route from '../route';

function req(url: string, headers: Record<string, string> = {}) {
  return {
    method: 'GET',
    url,
    headers: new Headers(headers),
  } as any;
}

describe('/api/openclaw/[...path]', () => {
  const originalOpenClawKey = process.env.OPENCLAW_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OPENCLAW_API_KEY = 'server-openclaw-key';
    mockCreateBotClaimHeaders.mockReturnValue({ 'x-bot-claims': 'signed-claims' });
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  afterAll(() => {
    process.env.OPENCLAW_API_KEY = originalOpenClawKey;
  });

  it('proxies read requests with resolved actor claims and strips caller tenant/auth claims', async () => {
    const response = await route.GET(req(
      'https://app.example.com/api/openclaw/api/sessions?tenantId=tenant-spoof&sessionId=room-a&include=jobs',
      {
        Authorization: 'Bearer caller-token',
        'x-session-id': 'header-session',
      },
    ), {
      params: Promise.resolve({ path: ['api', 'sessions'] }),
    });

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockCreateBotClaimHeaders).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
      sessionId: 'user-1',
    }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [target, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(target)).toBe('http://localhost:18789/api/sessions?include=jobs');
    expect(init.headers).toEqual(expect.objectContaining({
      Authorization: 'Bearer server-openclaw-key',
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-user-name': 'Sam',
      'x-tenant-id': 'tenant-a',
      'x-session-id': 'user-1',
      'x-bot-claims': 'signed-claims',
    }));
  });

  it('does not proxy when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await route.GET(req('https://app.example.com/api/openclaw/api/sessions?tenantId=tenant-b'), {
      params: Promise.resolve({ path: ['api', 'sessions'] }),
    });

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does not expose mutating proxy handlers', () => {
    expect((route as any).POST).toBeUndefined();
    expect((route as any).PUT).toBeUndefined();
    expect((route as any).PATCH).toBeUndefined();
    expect((route as any).DELETE).toBeUndefined();
  });
});
