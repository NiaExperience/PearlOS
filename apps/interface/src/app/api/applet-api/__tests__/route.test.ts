import { NextResponse } from 'next/server';

import { GET, POST } from '../route';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';

const mockGetAssistantBySubDomain = jest.fn();
const mockGetTenantById = jest.fn();
const mockFindAppletStorage = jest.fn();
const mockCreateAppletStorage = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  AssistantActions: {
    getAssistantBySubDomain: (...args: unknown[]) => mockGetAssistantBySubDomain(...args),
  },
  TenantActions: {
    getTenantById: (...args: unknown[]) => mockGetTenantById(...args),
  },
}));

jest.mock('@interface/features/HtmlGeneration', () => ({
  findAppletStorage: (...args: unknown[]) => mockFindAppletStorage(...args),
  createAppletStorage: (...args: unknown[]) => mockCreateAppletStorage(...args),
  updateAppletStorage: jest.fn(),
  deleteAppletStorage: jest.fn(),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

function request(url: string, body?: unknown) {
  return {
    url,
    nextUrl: new URL(url),
    json: async () => body ?? {},
  };
}

describe('/api/applet-api tenant scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAssistantBySubDomain.mockResolvedValue(null);
    mockGetTenantById.mockResolvedValue({ _id: tenantA });
    mockFindAppletStorage.mockResolvedValue({ items: [], total: 0 });
    mockCreateAppletStorage.mockResolvedValue({ _id: 'storage-1' });
    mockResolveInterfaceActorContext.mockResolvedValue({
      ok: true,
      actor: {
        userId: 'user-1',
        userEmail: 'sam@example.com',
        userName: 'Sam',
        tenantId: tenantA,
        tenantRole: 'member',
      },
    });
  });

  it('lists applet data through the resolved actor tenant, not the caller tenant', async () => {
    const response = await GET(request(
      `https://app.example.com/api/applet-api?operation=list&tenantId=${tenantB}`,
    ) as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: tenantB });
    expect(mockGetTenantById).toHaveBeenCalledWith(tenantA);
    expect(mockFindAppletStorage).toHaveBeenCalledWith({}, tenantA);
  });

  it('does not touch tenant or storage data when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET(request(
      `https://app.example.com/api/applet-api?operation=list&tenantId=${tenantB}`,
    ) as any);

    expect(response.status).toBe(403);
    expect(mockGetTenantById).not.toHaveBeenCalled();
    expect(mockFindAppletStorage).not.toHaveBeenCalled();
  });

  it('authorizes assistant-derived tenant scope before creating applet data', async () => {
    mockGetAssistantBySubDomain.mockResolvedValueOnce({ tenantId: tenantB });

    const response = await POST(request(
      'https://app.example.com/api/applet-api?operation=create&assistantName=acme',
      { data: { score: 10 }, appletId: tenantA },
    ) as any);

    expect(response.status).toBe(200);
    expect(mockGetAssistantBySubDomain).toHaveBeenCalledWith('acme');
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: tenantB });
    expect(mockCreateAppletStorage).toHaveBeenCalledWith({ score: 10 }, 'user-1', tenantA, tenantA);
  });

  it('rejects invalid tenant identifiers before resolving actor scope', async () => {
    const response = await GET(request(
      'https://app.example.com/api/applet-api?operation=list&tenantId=not-a-tenant',
    ) as any);

    expect(response.status).toBe(400);
    expect(mockResolveInterfaceActorContext).not.toHaveBeenCalled();
    expect(mockFindAppletStorage).not.toHaveBeenCalled();
  });
});
