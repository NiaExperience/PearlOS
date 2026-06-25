import { NextResponse } from 'next/server';

import { GET_impl } from '../route';

const mockGetAssistantBySubDomain = jest.fn();
const mockGetUsersForTenant = jest.fn();
const mockRequireTenantAccess = jest.fn();

jest.mock('@nia/prism/core/actions', () => ({
  AssistantActions: {
    getAssistantBySubDomain: (...args: unknown[]) => mockGetAssistantBySubDomain(...args),
  },
  TenantActions: {
    getUsersForTenant: (...args: unknown[]) => mockGetUsersForTenant(...args),
  },
  UserActions: {},
}));

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: jest.fn(),
  requireTenantAccess: (...args: unknown[]) => mockRequireTenantAccess(...args),
  requireTenantAdmin: jest.fn(),
}));

jest.mock('../../../logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

function req(url: string) {
  return {
    url,
    nextUrl: new URL(url),
  } as any;
}

describe('users route GET_impl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireTenantAccess.mockResolvedValue(null);
    mockGetUsersForTenant.mockResolvedValue([]);
  });

  it('checks tenant access before listing users for a requested tenant', async () => {
    mockGetUsersForTenant.mockResolvedValue([{ _id: 'user-1', email: 'owner@example.com' }]);

    const request = req('https://app.example.com/api/users?tenantId=tenant-a');
    const authOptions = { providers: [] } as any;
    const response = await GET_impl(request, authOptions);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([{ _id: 'user-1', email: 'owner@example.com' }]);
    expect(mockRequireTenantAccess).toHaveBeenCalledWith('tenant-a', request, authOptions);
    expect(mockGetUsersForTenant).toHaveBeenCalledWith('tenant-a');
  });

  it('does not list users when tenant access is denied', async () => {
    mockRequireTenantAccess.mockResolvedValueOnce(
      NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 }),
    );

    const response = await GET_impl(
      req('https://app.example.com/api/users?tenantId=tenant-b'),
      {} as any,
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('tenant_forbidden');
    expect(mockRequireTenantAccess).toHaveBeenCalledWith('tenant-b', expect.any(Object), {});
    expect(mockGetUsersForTenant).not.toHaveBeenCalled();
  });

  it('checks access to the tenant resolved from an assistant subdomain', async () => {
    mockGetAssistantBySubDomain.mockResolvedValueOnce({ tenantId: 'tenant-from-assistant' });
    mockGetUsersForTenant.mockResolvedValueOnce([{ _id: 'assistant-user' }]);

    const response = await GET_impl(
      req('https://app.example.com/api/users?agent=pearl'),
      {} as any,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([{ _id: 'assistant-user' }]);
    expect(mockGetAssistantBySubDomain).toHaveBeenCalledWith('pearl');
    expect(mockRequireTenantAccess).toHaveBeenCalledWith(
      'tenant-from-assistant',
      expect.any(Object),
      {},
    );
    expect(mockGetUsersForTenant).toHaveBeenCalledWith('tenant-from-assistant');
  });

  it('does not check access or list users when assistant lookup misses', async () => {
    mockGetAssistantBySubDomain.mockResolvedValueOnce(null);

    const response = await GET_impl(
      req('https://app.example.com/api/users?agent=missing'),
      {} as any,
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe('Agent missing not found');
    expect(mockRequireTenantAccess).not.toHaveBeenCalled();
    expect(mockGetUsersForTenant).not.toHaveBeenCalled();
  });
});
