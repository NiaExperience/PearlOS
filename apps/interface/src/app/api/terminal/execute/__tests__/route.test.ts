const mockResolveInterfaceActorContext = jest.fn();
const mockExec = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

jest.mock('child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

describe('/api/terminal/execute', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 410 for legacy command execution', async () => {
    const route = await import('../route');

    const response = await route.POST({
      json: async () => ({ command: 'echo should-not-run' }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ error: 'terminal_execute_disabled' });
  });

  it('does not parse the body, resolve an actor, or call exec', async () => {
    const route = await import('../route');
    const request = {
      json: jest.fn(async () => {
        throw new Error('body should not be parsed');
      }),
    };

    await route.POST(request as any);

    expect(request.json).not.toHaveBeenCalled();
    expect(mockResolveInterfaceActorContext).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });
});
