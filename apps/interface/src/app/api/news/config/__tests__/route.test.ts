const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/news/config', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('requires tenant admin scope before mutating feed config', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const route = await import('../route');
    const request = {
      headers: new Headers(),
      json: jest.fn(async () => ({ action: 'reset' })),
    };

    const response = await route.POST(request as any);

    expect(response.status).toBe(401);
    expect(request.json).not.toHaveBeenCalled();
  });
});
