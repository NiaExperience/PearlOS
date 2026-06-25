import { NextResponse } from 'next/server';

import { DELETE, GET, PATCH, POST } from '../route';

const mockAssignUserToOrganization = jest.fn();
const mockAssignUserToTenant = jest.fn();
const mockCreateAppNotification = jest.fn();
const mockCreateOrganization = jest.fn();
const mockCreateUser = jest.fn();
const mockDeleteUserOrganizationRole = jest.fn();
const mockDispatchWebhookEvent = jest.fn();
const mockGetOrganizationById = jest.fn();
const mockGetOrganizationRoles = jest.fn();
const mockGetUserByEmail = jest.fn();
const mockGetUserById = jest.fn();
const mockGetUserOrganizationRoles = jest.fn();
const mockGetUserTenantRoles = jest.fn();
const mockRequireAuth = jest.fn();
const mockResolveInterfaceActorContext = jest.fn();
const mockUpdateOrganization = jest.fn();
const mockUpdateUserOrganizationRole = jest.fn();

jest.mock('@nia/prism/core/actions/appNotification-actions', () => ({
  createAppNotification: (...args: unknown[]) => mockCreateAppNotification(...args),
}));

jest.mock('@nia/prism/core/actions/organization-actions', () => ({
  assignUserToOrganization: (...args: unknown[]) => mockAssignUserToOrganization(...args),
  createOrganization: (...args: unknown[]) => mockCreateOrganization(...args),
  deleteUserOrganizationRole: (...args: unknown[]) => mockDeleteUserOrganizationRole(...args),
  getOrganizationById: (...args: unknown[]) => mockGetOrganizationById(...args),
  getOrganizationRoles: (...args: unknown[]) => mockGetOrganizationRoles(...args),
  getUserOrganizationRoles: (...args: unknown[]) => mockGetUserOrganizationRoles(...args),
  updateOrganization: (...args: unknown[]) => mockUpdateOrganization(...args),
  updateUserOrganizationRole: (...args: unknown[]) => mockUpdateUserOrganizationRole(...args),
}));

jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  assignUserToTenant: (...args: unknown[]) => mockAssignUserToTenant(...args),
  getUserTenantRoles: (...args: unknown[]) => mockGetUserTenantRoles(...args),
}));

jest.mock('@nia/prism/core/actions/user-actions', () => ({
  createUser: (...args: unknown[]) => mockCreateUser(...args),
  getUserByEmail: (...args: unknown[]) => mockGetUserByEmail(...args),
  getUserById: (...args: unknown[]) => mockGetUserById(...args),
}));

jest.mock('@nia/prism/core/actions/webhook-actions', () => ({
  dispatchWebhookEvent: (...args: unknown[]) => mockDispatchWebhookEvent(...args),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
}));

jest.mock('@interface/lib/tenant-actor', () => ({
  resolveInterfaceActorContext: (...args: unknown[]) => mockResolveInterfaceActorContext(...args),
}));

describe('/api/sharing', () => {
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
    mockGetUserOrganizationRoles.mockResolvedValue([]);
    mockGetOrganizationRoles.mockResolvedValue([
      { _id: 'role-owner', userId: 'user-1', role: 'owner' },
      { _id: 'role-target', userId: 'user-2', role: 'viewer' },
    ]);
    mockGetOrganizationById.mockResolvedValue({
      _id: 'org-1',
      tenantId: 'tenant-a',
      description: 'Sharing organization',
      sharedResources: { 'res-1': 'Notes' },
    });
    mockGetUserById.mockResolvedValue({ _id: 'user-2', email: 'target@example.com', name: 'Target' });
    mockCreateOrganization.mockResolvedValue({ _id: 'org-1', tenantId: 'tenant-a' });
    mockAssignUserToOrganization.mockResolvedValue({ _id: 'org-role', role: 'owner' });
    mockGetUserByEmail.mockResolvedValue({ _id: 'user-2', email: 'target@example.com' });
    mockGetUserTenantRoles.mockResolvedValue([]);
    mockAssignUserToTenant.mockResolvedValue({ _id: 'tenant-role', role: 'member' });
    mockDeleteUserOrganizationRole.mockResolvedValue({ ok: true });
    mockUpdateOrganization.mockResolvedValue({ _id: 'org-1', tenantId: 'tenant-a' });
    mockUpdateUserOrganizationRole.mockResolvedValue({ _id: 'role-target', role: 'member' });
  });

  it('lists resources for the resolved actor, not caller-supplied userId', async () => {
    mockGetUserOrganizationRoles.mockResolvedValueOnce([
      { _id: 'role-owner', organizationId: 'org-1', userId: 'user-1', role: 'owner' },
    ]);

    const response = await GET({
      url: 'https://app.example.com/api/sharing?userId=user-spoof&tenantId=tenant-spoof&contentType=Notes',
    } as any);

    expect(response.status).toBe(200);
    expect(mockResolveInterfaceActorContext).toHaveBeenCalledWith({ requestedTenantId: 'tenant-spoof' });
    expect(mockGetUserOrganizationRoles).toHaveBeenCalledWith('user-1', 'tenant-a');
    expect(mockGetOrganizationById).toHaveBeenCalledWith('org-1', 'tenant-a');
  });

  it('does not query sharing data when requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await GET({
      url: 'https://app.example.com/api/sharing?userId=user-spoof&tenantId=tenant-b',
    } as any);

    expect(response.status).toBe(403);
    expect(mockGetUserOrganizationRoles).not.toHaveBeenCalled();
    expect(mockGetOrganizationRoles).not.toHaveBeenCalled();
  });

  it('creates sharing organizations with the resolved actor as owner', async () => {
    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-spoof',
        resourceId: 'res-1',
        resourceTitle: 'Roadmap',
        contentType: 'Notes',
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockCreateOrganization).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a',
      settings: expect.objectContaining({ resourceOwnerUserId: 'user-1' }),
    }));
    expect(mockAssignUserToOrganization).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      'tenant-a',
      'owner',
    );
  });

  it('does not create sharing when the requested tenant is forbidden', async () => {
    mockResolveInterfaceActorContext.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    });

    const response = await POST({
      json: async () => ({
        tenantId: 'tenant-b',
        resourceId: 'res-1',
        resourceTitle: 'Roadmap',
        contentType: 'Notes',
      }),
    } as any);

    expect(response.status).toBe(403);
    expect(mockCreateOrganization).not.toHaveBeenCalled();
    expect(mockAssignUserToOrganization).not.toHaveBeenCalled();
  });

  it('deletes sharing roles only with resolved tenant ownership', async () => {
    const response = await DELETE({
      json: async () => ({
        tenantId: 'tenant-spoof',
        organizationId: 'org-1',
        userId: 'user-2',
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetOrganizationRoles).toHaveBeenCalledWith('org-1', 'tenant-a');
    expect(mockDeleteUserOrganizationRole).toHaveBeenCalledWith('role-target', 'tenant-a');
  });

  it('patches sharing roles only with resolved tenant ownership', async () => {
    const response = await PATCH({
      json: async () => ({
        tenantId: 'tenant-spoof',
        organizationId: 'org-1',
        userId: 'user-2',
        newRole: 'read-write',
      }),
    } as any);

    expect(response.status).toBe(200);
    expect(mockGetOrganizationRoles).toHaveBeenCalledWith('org-1', 'tenant-a');
    expect(mockUpdateUserOrganizationRole).toHaveBeenCalledWith('role-target', 'tenant-a', 'admin');
  });
});
