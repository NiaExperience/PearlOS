const mockCreateGatewayWsToken = jest.fn();
const mockResolveWsTokenActorContext = jest.fn();

jest.mock('@interface/lib/bot-auth-claims', () => ({
  createGatewayWsToken: (...args: unknown[]) => mockCreateGatewayWsToken(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveWsTokenActorContext(...args),
}));

describe('/api/bot/ws-token', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockCreateGatewayWsToken.mockReturnValue({
      token: 'signed-token',
      expiresAt: 123456,
    });
    mockResolveWsTokenActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: 'member',
      },
    });
  });

  it('mints a gateway websocket token from resolved actor identity', async () => {
    const { GET } = require('../route');

    const response = await GET({
      url: 'https://app.example.com/api/bot/ws-token?tenantId=tenant-spoof&sessionId=room-a',
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveWsTokenActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockCreateGatewayWsToken).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      sessionUserId: 'user-1',
      sessionUserEmail: 'sam@example.com',
      sessionUserName: 'Sam',
      sessionId: 'room-a',
      allowedScopes: ['room-a', 'user-1'],
    });
    expect(body).toMatchObject({
      token: 'signed-token',
      expiresAt: 123456,
      sessionId: 'room-a',
      userId: 'user-1',
      tenantId: 'tenant-a',
    });
  });

  it('falls back to the actor user id when no session id is supplied', async () => {
    const { GET } = require('../route');

    const response = await GET({
      url: 'https://app.example.com/api/bot/ws-token',
    } as any);

    expect(response.status).toBe(200);
    expect(mockCreateGatewayWsToken).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'user-1',
      allowedScopes: ['user-1', 'user-1'],
    }));
  });

  it('does not mint a token when tenant resolution fails', async () => {
    mockResolveWsTokenActorContext.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'tenant_forbidden' }), { status: 403 }),
    });
    const { GET } = require('../route');

    const response = await GET({
      url: 'https://app.example.com/api/bot/ws-token?tenantId=tenant-b&sessionId=room-a',
    } as any);

    expect(response.status).toBe(403);
    expect(mockCreateGatewayWsToken).not.toHaveBeenCalled();
  });
});

export {};
