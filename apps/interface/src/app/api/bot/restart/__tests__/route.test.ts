const mockResolveInterfaceActorContext = jest.fn();
const mockIsBlairActor = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('@interface/lib/workspace-entitlements', () => ({
  isBlairActor: (...args: unknown[]) => mockIsBlairActor(...args),
}));

describe('/api/bot/restart', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  it('requires an authenticated admin actor before restarting anything', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const route = await import('../route');
    const request = { headers: new Headers() };

    const response = await route.POST(request as any);

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires the platform admin allowlist before restarting anything', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: { userId: 'admin-1', userEmail: 'admin@example.com', tenantRole: 'admin' },
    });
    mockIsBlairActor.mockReturnValue(false);
    const route = await import('../route');

    const response = await route.POST({ headers: new Headers() } as any);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: 'platform_admin_required' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
