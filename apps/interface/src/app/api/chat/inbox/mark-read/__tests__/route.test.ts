const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

import { POST } from '../route';

function req(url: string, body: unknown = {}) {
  return {
    url,
    nextUrl: new URL(url),
    headers: new Headers(),
    json: jest.fn().mockResolvedValue(body),
  } as any;
}

describe('/api/chat/inbox/mark-read', () => {
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
    global.fetch = jest.fn().mockResolvedValue(Response.json({ ok: true, marked: 2 }, { status: 200 }));
  });

  it('marks inbox messages read with resolved identity and a scoped body', async () => {
    const response = await POST(req('https://app.example.com/api/chat/inbox/mark-read', {
      ids: ['inbox-1', 'inbox-2'],
      tenantId: 'tenant-a',
      requester_email: 'spoof@example.com',
      user_id: 'user-spoof',
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, marked: 2 });
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-a' });
    const [target, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(target)).toBe('http://localhost:4444/api/chat/inbox/mark-read');
    expect(init.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-tenant-id': 'tenant-a',
      'x-pearl-tenant-id': 'tenant-a',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      ids: ['inbox-1', 'inbox-2'],
      tenantId: 'tenant-a',
      tenant_id: 'tenant-a',
      requester_email: 'sam@example.com',
      user_id: 'user-1',
      user_email: 'sam@example.com',
    });
  });

  it('does not mark messages read when actor resolution fails', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST(req('https://app.example.com/api/chat/inbox/mark-read?tenantId=tenant-b'));

    expect(response.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

export {};
