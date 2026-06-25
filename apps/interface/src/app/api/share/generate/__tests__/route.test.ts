import { ResourceShareRole, ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';

import { POST } from '../route';

const mockCreateResourceShareToken = jest.fn();
const mockCreateLinkMap = jest.fn();
const mockFindHtmlContentById = jest.fn();
const mockFindNoteById = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/resourceShareToken-actions', () => ({
  createResourceShareToken: (...args: unknown[]) => mockCreateResourceShareToken(...args),
}));

jest.mock('@nia/prism/core/actions/appNotification-actions', () => ({
  createAppNotification: jest.fn().mockResolvedValue({}),
}));

jest.mock('@nia/prism/core/actions/webhook-actions', () => ({
  dispatchWebhookEvent: jest.fn().mockResolvedValue({}),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@nia/prism/core/utils/encryption', () => ({
  TokenEncryption: {
    encryptToken: jest.fn().mockReturnValue('encrypted-token'),
  },
}));

jest.mock('@interface/features/HtmlGeneration/actions/html-generation-actions', () => ({
  findHtmlContentById: (...args: unknown[]) => mockFindHtmlContentById(...args),
}));

jest.mock('@interface/features/Notes', () => ({
  findNoteById: (...args: unknown[]) => mockFindNoteById(...args),
}));

jest.mock('@interface/features/ResourceSharing/actions/linkmap-actions', () => ({
  createLinkMap: (...args: unknown[]) => mockCreateLinkMap(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/share/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_INTERFACE_URL = 'https://app.example.com';
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
    mockCreateResourceShareToken.mockResolvedValue({
      token: 'raw-token',
      tenantId: 'tenant-a',
      expiresAt: '2026-06-05T00:00:00.000Z',
    });
    mockCreateLinkMap.mockResolvedValue({ key: 'share-key' });
    mockFindNoteById.mockResolvedValue({
      _id: 'note-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      title: 'Owned note',
    });
    mockFindHtmlContentById.mockResolvedValue(null);
  });

  it('creates share tokens with the resolved tenant and owner, not body tenant claims', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-spoof',
        resourceId: 'note-1',
        contentType: ResourceType.Notes,
        role: ResourceShareRole.VIEWER,
        ttl: 3600,
      }),
    } as any);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockCreateResourceShareToken).toHaveBeenCalledWith(
      undefined,
      'note-1',
      ResourceType.Notes,
      ResourceShareRole.VIEWER,
      'user-1',
      'tenant-a',
      3600,
      undefined,
      undefined,
    );
    expect(body).toMatchObject({
      success: true,
      token: 'raw-token',
      link: 'https://app.example.com/share/share-key',
    });
  });

  it('rejects share token creation when the actor does not own the resource', async () => {
    mockFindNoteById.mockResolvedValue({
      _id: 'note-1',
      tenantId: 'tenant-a',
      userId: 'user-2',
      title: 'Someone else note',
    });

    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'note-1',
        contentType: ResourceType.Notes,
        role: ResourceShareRole.VIEWER,
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockCreateResourceShareToken).not.toHaveBeenCalled();
  });

  it('rejects invalid share roles before token creation', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'note-1',
        contentType: ResourceType.Notes,
        role: 'owner',
      }),
    } as any);

    expect(response.status).toBe(400);
    expect(mockCreateResourceShareToken).not.toHaveBeenCalled();
  });

  it('fails closed for DailyCallRoom shares until ownership checks exist', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'https://daily.example/room',
        contentType: ResourceType.DailyCallRoom,
        role: ResourceShareRole.VIEWER,
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockCreateResourceShareToken).not.toHaveBeenCalled();
  });

  it('fails closed for Sprite shares until ownership checks exist', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'sprite-1',
        contentType: ResourceType.Sprite,
        role: ResourceShareRole.VIEWER,
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockCreateResourceShareToken).not.toHaveBeenCalled();
  });

  it('allows tenant admins to share tenant resources they do not own', async () => {
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'admin-1',
        userEmail: 'admin@example.com',
        userName: 'Admin',
        tenantId: 'tenant-a',
        tenantRole: 'admin',
      },
    });
    mockFindNoteById.mockResolvedValue({
      _id: 'note-1',
      tenantId: 'tenant-a',
      userId: 'user-2',
      title: 'Tenant note',
    });

    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'note-1',
        contentType: ResourceType.Notes,
        role: ResourceShareRole.VIEWER,
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockCreateResourceShareToken).toHaveBeenCalledWith(
      undefined,
      'note-1',
      ResourceType.Notes,
      ResourceShareRole.VIEWER,
      'admin-1',
      'tenant-a',
      86400,
      undefined,
      undefined,
    );
  });

  it('requires ownership for HtmlGeneration app shares', async () => {
    mockFindNoteById.mockResolvedValue(null);
    mockFindHtmlContentById.mockResolvedValue({
      _id: 'app-1',
      tenantId: 'tenant-a',
      createdBy: 'user-1',
      title: 'Owned app',
    });

    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-a',
        resourceId: 'app-1',
        contentType: ResourceType.HtmlGeneration,
        role: ResourceShareRole.VIEWER,
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockFindHtmlContentById).toHaveBeenCalledWith('app-1', 'tenant-a');
    expect(mockCreateResourceShareToken).toHaveBeenCalledWith(
      undefined,
      'app-1',
      ResourceType.HtmlGeneration,
      ResourceShareRole.VIEWER,
      'user-1',
      'tenant-a',
      86400,
      undefined,
      undefined,
    );
  });
});
