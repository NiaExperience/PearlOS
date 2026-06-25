import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import { DELETE, GET, PATCH, POST } from '../route';

const mockCreateWebhookSubscription = jest.fn();
const mockDeleteWebhookSubscription = jest.fn();
const mockListWebhookDeliveries = jest.fn();
const mockListWebhookSubscriptions = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockUpdateWebhookSubscription = jest.fn();
const mockValidateWebhookTargetUrl = jest.fn();

jest.mock('@nia/prism/core/actions/webhook-actions', () => ({
  createWebhookSubscription: (...args: unknown[]) => mockCreateWebhookSubscription(...args),
  deleteWebhookSubscription: (...args: unknown[]) => mockDeleteWebhookSubscription(...args),
  listWebhookDeliveries: (...args: unknown[]) => mockListWebhookDeliveries(...args),
  listWebhookSubscriptions: (...args: unknown[]) => mockListWebhookSubscriptions(...args),
  updateWebhookSubscription: (...args: unknown[]) => mockUpdateWebhookSubscription(...args),
  validateWebhookTargetUrl: (...args: unknown[]) => mockValidateWebhookTargetUrl(...args),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/webhooks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateWebhookTargetUrl.mockImplementation(async (url: string) => url);
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: 'tenant-a',
        tenantRole: TenantRole.ADMIN,
        authSource: 'next-auth-session',
        actorType: 'user',
      },
    });
    mockDeleteWebhookSubscription.mockResolvedValue(true);
  });

  it('lists webhooks only through an admin-scoped tenant and redacts secrets', async () => {
    mockListWebhookSubscriptions.mockResolvedValue([
      { _id: 'sub-1', tenantId: 'tenant-a', secret: 'secret-value', url: 'https://example.com/hook' },
    ]);
    mockListWebhookDeliveries.mockResolvedValue([{ _id: 'delivery-1', tenantId: 'tenant-a' }]);

    const response = await GET({
      url: 'https://app.example.com/api/webhooks?tenantId=tenant-spoof&includeDeliveries=true',
    } as any);
    const body = await response.json();

    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-spoof',
      minimumRole: TenantRole.ADMIN,
    });
    expect(mockListWebhookSubscriptions).toHaveBeenCalledWith('tenant-a');
    expect(mockListWebhookDeliveries).toHaveBeenCalledWith({ tenantId: 'tenant-a', limit: 50 });
    expect(body.subscriptions[0]).toMatchObject({
      _id: 'sub-1',
      tenantId: 'tenant-a',
      hasSecret: true,
    });
    expect(body.subscriptions[0].secret).toBeUndefined();
  });

  it('creates webhooks with the resolved tenant and creator, not body claims', async () => {
    mockCreateWebhookSubscription.mockResolvedValue({
      _id: 'sub-1',
      tenantId: 'tenant-a',
      createdBy: 'user-1',
      secret: 'secret-value',
      url: 'https://example.com/hook',
    });

    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-spoof',
        url: 'https://example.com/hook',
        secret: 'secret-value',
        events: ['share.created'],
        resourceTypes: ['Notes'],
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockCreateWebhookSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      createdBy: 'user-1',
      url: 'https://example.com/hook',
      secret: 'secret-value',
    }));
    expect(body.subscription.secret).toBeUndefined();
    expect(body.subscription.hasSecret).toBe(true);
  });

  it('patches webhooks with the resolved tenant and redacts returned secrets', async () => {
    mockUpdateWebhookSubscription.mockResolvedValue({
      _id: 'sub-1',
      tenantId: 'tenant-a',
      secret: 'rotated-secret',
      isActive: false,
    });

    const response = await PATCH({
      json: async () => ({
        tenantId: 'tenant-spoof',
        subscriptionId: 'sub-1',
        secret: 'rotated-secret',
        isActive: false,
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-spoof',
      minimumRole: TenantRole.ADMIN,
    });
    expect(mockUpdateWebhookSubscription).toHaveBeenCalledWith(
      'sub-1',
      'tenant-a',
      expect.objectContaining({ secret: 'rotated-secret', isActive: false }),
    );
    expect(body.subscription.secret).toBeUndefined();
    expect(body.subscription.hasSecret).toBe(true);
  });

  it('deletes webhooks only through an admin-scoped resolved tenant', async () => {
    const response = await DELETE({
      json: async () => ({
        tenantId: 'tenant-spoof',
        subscriptionId: 'sub-1',
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({
      requestedTenantId: 'tenant-spoof',
      minimumRole: TenantRole.ADMIN,
    });
    expect(mockDeleteWebhookSubscription).toHaveBeenCalledWith('sub-1', 'tenant-a');
  });

  it('does not delete webhooks when requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await DELETE({
      json: async () => ({
        tenantId: 'tenant-b',
        subscriptionId: 'sub-1',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockDeleteWebhookSubscription).not.toHaveBeenCalled();
  });

  it('returns not found when a resolved-tenant webhook delete misses', async () => {
    mockDeleteWebhookSubscription.mockResolvedValueOnce(false);

    const response = await DELETE({
      json: async () => ({
        tenantId: 'tenant-spoof',
        subscriptionId: 'missing-sub',
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('webhook_not_found');
    expect(mockDeleteWebhookSubscription).toHaveBeenCalledWith('missing-sub', 'tenant-a');
  });
});
