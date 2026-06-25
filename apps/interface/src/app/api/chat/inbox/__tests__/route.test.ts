const mockResolveInterfaceActorContext = jest.fn();

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

describe('/api/chat/inbox', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      Response.json({ unread_count: 1, messages: [{ id: 'inbox-1' }] }, { status: 200 }),
    );
  });

  it('lists the resolved actor inbox with canonical tenant/user headers', async () => {
    const response = await GET(req('https://app.example.com/api/chat/inbox?tenantId=tenant-a'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ unread_count: 1, messages: [{ id: 'inbox-1' }] });
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-a' });
    const [target, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(target)).toBe('http://localhost:4444/api/chat/inbox');
    expect(init.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-user-name': 'Sam',
      'x-tenant-id': 'tenant-a',
      'x-pearl-tenant-id': 'tenant-a',
    });
  });

  it('does not return a silent empty inbox when actor resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(req('https://app.example.com/api/chat/inbox'));

    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

export {};
