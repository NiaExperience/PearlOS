// Moved from src/core/routes/users/[userId]/route.test.ts
// Purpose: tests DELETE /api/users/[userId] including self-delete, ownership, rank, and purgeAll
import { NextResponse } from 'next/server';

import { DELETE_impl } from '../src/core/routes/users/[userId]/route';

// Mocks
const mockGetSessionSafely = jest.fn();
const mockRequireTenantAdmin = jest.fn();
const mockIsSuperAdmin = jest.fn();
const mockDeleteUser = jest.fn();
const mockGetUserTenantRoles = jest.fn(); // from tenant-actions (direct)
const mockTenantActionsGetUserTenantRoles = jest.fn(); // from aggregated actions
const mockGetUserOrganizationRoles = jest.fn();

const mockQuery = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();

jest.mock('@nia/prism/core/auth', () => ({
  getSessionSafely: (...args: any[]) => mockGetSessionSafely(...args),
  requireTenantAdmin: (...args: any[]) => mockRequireTenantAdmin(...args),
}));
jest.mock('@nia/prism/core/auth/auth.middleware', () => ({
  isSuperAdmin: (...args: any[]) => mockIsSuperAdmin(...args),
}));
jest.mock('@nia/prism/core/actions', () => ({
  UserActions: { deleteUser: (...args: any[]) => mockDeleteUser(...args) },
  TenantActions: { 
    getUserTenantRoles: (...args: any[]) => mockTenantActionsGetUserTenantRoles(...args),
    getTenantById: jest.fn().mockResolvedValue({ _id: 'T1', name: 'Tenant 1' })
  },
}));
jest.mock('@nia/prism/core/actions/tenant-actions', () => ({
  getUserTenantRoles: (...args: any[]) => mockGetUserTenantRoles(...args),
}));
jest.mock('@nia/prism/core/actions/organization-actions', () => ({
  getUserOrganizationRoles: (...args: any[]) => mockGetUserOrganizationRoles(...args),
}));
// Prism main entry is at ../src/prism
jest.mock('../src/prism', () => ({
  Prism: {
    getInstance: async () => ({
      query: (...args: any[]) => mockQuery(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
      create: jest.fn(),
    }),
  },
}));

// Helpers
const makeReq = (targetId: string, opts: { tenantId?: string; body?: any } = {}) => {
  const { tenantId, body } = opts;
  const query = tenantId ? `?tenantId=${tenantId}` : '';
  const bodyText = body ? JSON.stringify(body) : '';
  const url = `http://localhost/api/users/${targetId}${query}`;
  return {
    url,
    clone: () => ({ text: async () => bodyText }),
  } as any; // cast to NextRequest-lite
};

const authOptions: any = {};

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ items: [], total: 0 });
  mockUpdate.mockResolvedValue({});
  mockDelete.mockResolvedValue({});
  mockGetSessionSafely.mockResolvedValue({ user: { id: 'ACTOR' } });
  mockRequireTenantAdmin.mockResolvedValue(undefined);
  mockIsSuperAdmin.mockReturnValue(true);
  mockDeleteUser.mockResolvedValue({ success: true });
  mockGetUserTenantRoles.mockResolvedValue([]);
  mockTenantActionsGetUserTenantRoles.mockResolvedValue([]);
  mockGetUserOrganizationRoles.mockResolvedValue([]);
});

describe('DELETE_impl user deletion route', () => {
  test('success (superadmin, no purge)', async () => {
    const res = await DELETE_impl(makeReq('TARGET', {body: { purgeAll: false }}), { params: { userId: 'TARGET' } }, authOptions);
    const json = await (res as NextResponse).json();
    expect(json.success).toBe(true);
    expect(json.purged).toBe(false);
    expect(mockDeleteUser).toHaveBeenCalledWith('TARGET');
  });

  test('success with purgeAll flag', async () => {
    const res = await DELETE_impl(
      makeReq('TARGET', { body: { purgeAll: true } }),
      { params: { userId: 'TARGET' } },
      authOptions
    );
    const json = await (res as NextResponse).json();
    expect(json.success).toBe(true);
    expect(json.purged).toBe(true);
  });

  test('self deletion blocked', async () => {
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'ME' } });
    const res = await DELETE_impl(makeReq('ME'), { params: { userId: 'ME' } }, authOptions);
    expect(res.status).toBe(400);
    const json = await (res as NextResponse).json();
    expect(json.error).toMatch(/cannot delete your own/i);
  });

  test('ownership guard (tenant owner) 409', async () => {
    mockGetUserTenantRoles.mockResolvedValue([{ role: 'owner' }]);
    const res = await DELETE_impl(makeReq('TARGET'), { params: { userId: 'TARGET' } }, authOptions);
    expect(res.status).toBe(409);
    const json = await (res as NextResponse).json();
    expect(json.error).toMatch(/owner/i);
  });

  test('rank guard 403 (target higher)', async () => {
    mockIsSuperAdmin.mockReturnValue(false);
    mockGetSessionSafely.mockResolvedValue({ user: { id: 'ACTOR' } });
    // Actor roles (member), target roles (admin) via TenantActions.getUserTenantRoles used inside getHighestTenantRole
    mockTenantActionsGetUserTenantRoles.mockImplementation((uid: string) => {
      if (uid === 'ACTOR') return Promise.resolve([{ tenantId: 'T1', role: 'member' }]);
      return Promise.resolve([{ tenantId: 'T1', role: 'admin' }]);
    });
    const res = await DELETE_impl(
      makeReq('TARGET', { tenantId: 'T1' }),
      { params: { userId: 'TARGET' } },
      authOptions
    );
    expect(res.status).toBe(403);
    const json = await (res as NextResponse).json();
    expect(json.error).toMatch(/higher access/i);
  });
});
