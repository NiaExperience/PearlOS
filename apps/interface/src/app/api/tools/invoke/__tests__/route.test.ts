import { POST } from '../route';

jest.mock('@interface/lib/api-auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: jest.fn().mockResolvedValue({
    ok: true,
    actor: {
      userId: 'user-1',
      userEmail: 'sam@example.com',
      userName: 'Sam',
      tenantId: 'tenant-a',
      tenantRole: 'member',
    },
  }),
}));

describe('/api/tools/invoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('overwrites caller-supplied tenant and requester fields before forwarding', async () => {
    const response = await POST({
      json: async () => ({
        tenant_id: 'tenant-spoof',
        tenantId: 'tenant-spoof',
        user_id: 'user-spoof',
        userId: 'user-spoof',
        user_email: 'spoof@example.com',
        userEmail: 'spoof@example.com',
        requester_tenant_id: 'tenant-spoof',
        requester_user_id: 'user-spoof',
        requester_email: 'spoof@example.com',
        params: {
          tenant_id: 'tenant-spoof',
          tenantId: 'tenant-spoof',
          user_id: 'user-spoof',
          userId: 'user-spoof',
          user_email: 'spoof@example.com',
          userEmail: 'spoof@example.com',
          requester_tenant_id: 'tenant-spoof',
          requester_user_id: 'user-spoof',
          requester_email: 'spoof@example.com',
          query: 'profile',
        },
      }),
    } as any);

    expect(response.status).toBe(200);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers).toMatchObject({
      'x-user-id': 'user-1',
      'x-user-email': 'sam@example.com',
      'x-tenant-id': 'tenant-a',
      'x-pearl-tenant-id': 'tenant-a',
    });
    expect(JSON.parse(init.body)).toMatchObject({
      tenant_id: 'tenant-a',
      user_id: 'user-1',
      user_email: 'sam@example.com',
      requester_tenant_id: 'tenant-a',
      requester_user_id: 'user-1',
      requester_email: 'sam@example.com',
      params: {
        requester_tenant_id: 'tenant-a',
        requester_user_id: 'user-1',
        requester_email: 'sam@example.com',
        query: 'profile',
      },
    });
    const forwardedBody = JSON.parse(init.body);
    expect(forwardedBody).not.toHaveProperty('tenantId');
    expect(forwardedBody).not.toHaveProperty('userId');
    expect(forwardedBody).not.toHaveProperty('userEmail');
    expect(forwardedBody.params).not.toHaveProperty('tenant_id');
    expect(forwardedBody.params).not.toHaveProperty('tenantId');
    expect(forwardedBody.params).not.toHaveProperty('user_id');
    expect(forwardedBody.params).not.toHaveProperty('userId');
    expect(forwardedBody.params).not.toHaveProperty('user_email');
    expect(forwardedBody.params).not.toHaveProperty('userEmail');
  });

  it('rejects non-object JSON bodies', async () => {
    const response = await POST({
      json: async () => ['not', 'an', 'object'],
    } as any);

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
