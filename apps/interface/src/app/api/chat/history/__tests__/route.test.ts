const mockRequireAuth = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/api-auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

import { GET } from '../route';

function req(url: string) {
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(),
  } as any;
}

describe('/api/chat/history', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
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
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({ messages: [{ id: 'msg-1' }] }, { status: 200 }),
    );
  });

  it('forwards history requests with resolved tenant/user headers and sanitized query params', async () => {
    const response = await GET(req(
      'https://app.example.com/api/chat/history?tenantId=tenant-a&tenant_id=tenant-spoof&limit=25&before=cursor-1&extra=ignore',
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages).toEqual([{ id: 'msg-1' }]);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-a' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [target, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(target)).toBe('http://localhost:4444/api/chat/history?limit=25&before=cursor-1');
    expect(init.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-user-name': 'Sam',
      'x-tenant-id': 'tenant-a',
      'x-pearl-tenant-id': 'tenant-a',
    });
  });

  it('does not fetch history when tenant resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(req('https://app.example.com/api/chat/history?tenantId=tenant-b'));

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

export {};
