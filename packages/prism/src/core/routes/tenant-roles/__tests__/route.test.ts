import { NextResponse } from 'next/server';

import { DELETE_impl, GET_impl, PATCH_impl, POST_impl } from '../route';

const mockAssignUserToTenant = jest.fn();
const mockDeleteUserTenantRole = jest.fn();
const mockGetSessionSafely = jest.fn();
const mockGetTenantRolesForTenant = jest.fn();
const mockGetUserTenantRoles = jest.fn();
const mockRequireAuth = jest.fn();
const mockRequireTenantAccess = jest.fn();
const mockRequireTenantAdmin = jest.fn();
const mockUpdateUserTenantRole = jest.fn();

jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  assignUserToTenant: (...args: unknown[]) => mockAssignUserToTenant(...args),
  deleteUserTenantRole: (...args: unknown[]) => mockDeleteUserTenantRole(...args),
  getTenantRolesForTenant: (...args: unknown[]) => mockGetTenantRolesForTenant(...args),
  getUserTenantRoles: (...args: unknown[]) => mockGetUserTenantRoles(...args),
  updateUserTenantRole: (...args: unknown[]) => mockUpdateUserTenantRole(...args),
}));

jest.mock('@nia/prism/core/auth', () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requireTenantAccess: (...args: unknown[]) => mockRequireTenantAccess(...args),
  requireTenantAdmin: (...args: unknown[]) => mockRequireTenantAdmin(...args),
}));

jest.mock('@nia/prism/core/auth/getSessionSafely', () => ({
  getSessionSafely: (...args: unknown[]) => mockGetSessionSafely(...args),
}));

jest.mock('../../../logger', () => ({
  getLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

function req(url: string, body?: unknown) {
  return {
    url,
    json: async () => body,
  } as any;
}

describe('tenant-roles route tenant guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuth.mockResolvedValue(null);
    mockRequireTenantAccess.mockResolvedValue(null);
    mockRequireTenantAdmin.mockResolvedValue(null);
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'actor-1' } });
    mockGetTenantRolesForTenant.mockResolvedValue([]);
    mockGetUserTenantRoles.mockImplementation(async (userId: string) => (
      userId === 'actor-1'
        ? [{ tenantId: 'tenant-a', role: 'admin' }]
        : []
    ));
    mockAssignUserToTenant.mockResolvedValue({ userId: 'target-1', tenantId: 'tenant-a', role: 'member' });
    mockUpdateUserTenantRole.mockResolvedValue({ userId: 'target-1', tenantId: 'tenant-a', role: 'member' });
    mockDeleteUserTenantRole.mockResolvedValue({ userId: 'target-1', tenantId: 'tenant-a', role: 'member' });
  });

  it('requires tenant admin before listing all tenant roles', async () => {
    const request = req('https://app.example.com/api/tenant-roles?tenantId=tenant-a');

    const response = await GET_impl(request, {} as any);

    expect(response.status).toBe(200);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith('tenant-a', request, {});
    expect(mockGetTenantRolesForTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('allows a user to read their own tenant role only after tenant access', async () => {
    const request = req('https://app.example.com/api/tenant-roles?tenantId=tenant-a&userId=actor-1');

    const response = await GET_impl(request, {} as any);

    expect(response.status).toBe(200);
    expect(mockRequireTenantAccess).toHaveBeenCalledWith('tenant-a', request, {});
    expect(mockRequireTenantAdmin).not.toHaveBeenCalled();
    expect(mockGetUserTenantRoles).toHaveBeenCalledWith('actor-1');
  });

  it('requires tenant admin before reading another user role', async () => {
    const request = req('https://app.example.com/api/tenant-roles?tenantId=tenant-a&userId=target-1');

    const response = await GET_impl(request, {} as any);

    expect(response.status).toBe(200);
    expect(mockRequireTenantAdmin).toHaveBeenCalledWith('tenant-a', request, {});
    expect(mockGetUserTenantRoles).toHaveBeenCalledWith('target-1');
  });

  it('does not list roles when tenant admin is denied', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'admin_required' }, { status: 403 }),
    );

    const response = await GET_impl(
      req('https://app.example.com/api/tenant-roles?tenantId=tenant-b'),
      {} as any,
    );

    expect(response.status).toBe(403);
    expect(mockGetTenantRolesForTenant).not.toHaveBeenCalled();
  });

  it('does not assign tenant roles when tenant admin is denied', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'admin_required' }, { status: 403 }),
    );

    const response = await POST_impl(
      req('https://app.example.com/api/tenant-roles', {
        tenantId: 'tenant-b',
        userId: 'target-1',
        role: 'member',
      }),
      {} as any,
    );

    expect(response.status).toBe(403);
    expect(mockAssignUserToTenant).not.toHaveBeenCalled();
  });

  it('denies role escalation above the actor rank before assignment', async () => {
    const response = await POST_impl(
      req('https://app.example.com/api/tenant-roles', {
        tenantId: 'tenant-a',
        userId: 'target-1',
        role: 'owner',
      }),
      {} as any,
    );

    expect(response.status).toBe(403);
    expect(mockAssignUserToTenant).not.toHaveBeenCalled();
  });

  it('requires tenant admin before updating tenant roles', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'admin_required' }, { status: 403 }),
    );

    const response = await PATCH_impl(
      req('https://app.example.com/api/tenant-roles', {
        tenantId: 'tenant-b',
        userId: 'target-1',
        role: 'member',
      }),
      {} as any,
    );

    expect(response.status).toBe(403);
    expect(mockUpdateUserTenantRole).not.toHaveBeenCalled();
  });

  it('requires tenant admin before deleting tenant roles', async () => {
    mockRequireTenantAdmin.mockResolvedValueOnce(
      NextResponse.json({ error: 'admin_required' }, { status: 403 }),
    );

    const response = await DELETE_impl(
      req('https://app.example.com/api/tenant-roles', {
        tenantId: 'tenant-b',
        userId: 'target-1',
      }),
      {} as any,
    );

    expect(response.status).toBe(403);
    expect(mockDeleteUserTenantRole).not.toHaveBeenCalled();
  });
});
