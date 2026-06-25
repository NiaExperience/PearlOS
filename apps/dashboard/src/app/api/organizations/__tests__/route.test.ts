import { NextResponse } from 'next/server';

import { GET, POST } from '../route';

const mockAssignUserToOrganization = jest.fn();
const mockCreateOrganization = jest.fn();
const mockGetOrganizationsForTenant = jest.fn();
const mockGetSessionSafely = jest.fn();
const mockRequireAuth = jest.fn();
const mockRequireTenantAccess = jest.fn();
const mockRequireTenantAdmin = jest.fn();

jest.mock('@dashboard/lib/auth-config', () => ({
  dashboardAuthOptions: { providers: [] },
}));

jest.mock('@nia/prism/core/actions/organization-actions', () => ({
  assignUserToOrganization: (...args: unknown[]) => mockAssignUserToOrganization(...args),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  deleteOrganization: jest.fn(),
  getOrganizationsForTenant: (...args: unknown[]) => mockGetOrganizationsForTenant(...args),
  updateOrganization: jest.fn(),
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSessionSafely(...args),
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requireTenantAccess: (...args: unknown[]) => mockRequireTenantAccess(...args),
  requireTenantAdmin: (...args: unknown[]) => mockRequireTenantAdmin(...args),
}));

function req(url: string, body?: unknown) {
  return {
    url,
    json: async () => body,
  } as any;
}

describe('dashboard organizations route tenant guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockRequireTenantAccess.mockResolvedValue(null);
    mockRequireTenantAdmin.mockResolvedValue(null);
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'user-1' } });
    mockGetOrganizationsForTenant.mockResolvedValue([]);
    mockCreateOrganization.mockResolvedValue({ _id: 'org-1', tenantId: 'tenant-a' });
  });

  it('checks tenant access before listing organizations', async () => {
    const request = req('https://dashboard.example.com/api/organizations?tenantId=tenant-a');

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(mockRequireTenantAccess).toHaveBeenCalledWith('tenant-a', request, { providers: [] });
    expect(mockGetOrganizationsForTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('does not list organizations when tenant access is denied', async () => {
    mockRequireTenantAccess.mockResolvedValueOnce(
      NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    );

    const response = await GET(
      req('https://dashboard.example.com/api/organizations?tenantId=tenant-b'),
    );

    expect(response.status).toBe(403);
    expect(mockGetOrganizationsForTenant).not.toHaveBeenCalled();
  });

  it('requires tenant admin before creating an organization', async () => {
    const request = req('https://dashboard.example.com/api/organizations', {
      tenantId: 'tenant-a',
      name: 'Finance',
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith('tenant-a', request, { providers: [] });
    expect(mockCreateOrganization).toHaveBeenCalledWith({
      tenantId: 'tenant-a',
      name: 'Finance',
      description: undefined,
    });
    expect(mockAssignUserToOrganization).toHaveBeenCalled();
  });

  it('does not create an organization when tenant admin is denied', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'admin_required' }, { status: 403 }),
    );

    const response = await POST(
      req('https://dashboard.example.com/api/organizations', {
        tenantId: 'tenant-b',
        name: 'Ops',
      }),
    );

    expect(response.status).toBe(403);
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockAssignUserToOrganization).not.toHaveBeenCalled();
  });
});
