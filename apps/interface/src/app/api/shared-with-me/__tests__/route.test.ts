import { GET } from '../route';

const mockGetUserSharedResources = jest.fn();
const mockFindHtmlContentsByIds = jest.fn();
const mockFindNoteById = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions/organization-actions', () => ({
  getUserSharedResources: (...args: unknown[]) => mockGetUserSharedResources(...args),
}));

jest.mock('@nia/prism/core/actions/user-actions', () => ({
  getUserById: jest.fn(),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: jest.fn().mockResolvedValue(null),
}));

jest.mock('@interface/features/HtmlGeneration/actions/html-generation-actions', () => ({
  findHtmlContentsByIds: (...args: unknown[]) => mockFindHtmlContentsByIds(...args),
}));

jest.mock('@interface/features/Notes', () => ({
  findNoteById: (...args: unknown[]) => mockFindNoteById(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/shared-with-me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUserSharedResources.mockResolvedValue([]);
    mockFindHtmlContentsByIds.mockResolvedValue([]);
    mockFindNoteById.mockResolvedValue(null);
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
  });

  it('loads shared resources with the resolved user and tenant', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/shared-with-me?tenantId=tenant-spoof',
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockGetUserSharedResources).toHaveBeenCalledTimes(3);
    for (const call of mockGetUserSharedResources.mock.calls) {
      expect(call[0]).toBe('user-1');
      expect(call[1]).toBe('tenant-a');
    }
  });

  it('allows FileSpace to load shared resources without passing tenantId', async () => {
    const response = await GET({
      url: 'https://app.example.com/api/shared-with-me',
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: undefined });
  });

  it('does not fetch content from resource organization tenants outside the resolved tenant', async () => {
    mockGetUserSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'note-cross-tenant',
        role: 'viewer',
        organization: { tenantId: 'tenant-b' },
      },
    ]);
    mockGetUserSharedResources.mockResolvedValueOnce([
      {
        resourceId: 'app-cross-tenant',
        role: 'viewer',
        organization: { tenantId: 'tenant-b' },
      },
    ]);
    mockGetUserSharedResources.mockResolvedValueOnce([]);

    const response = await GET({
      url: 'https://app.example.com/api/shared-with-me?tenantId=tenant-spoof',
    } as any);

    expect(response.status).toBe(200);
    expect(mockFindNoteById).not.toHaveBeenCalled();
    expect(mockFindHtmlContentsByIds).not.toHaveBeenCalled();
  });
});
