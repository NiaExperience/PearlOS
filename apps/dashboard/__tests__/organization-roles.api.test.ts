/**
 * @jest-environment node
 */
import { TenantActions, OrganizationActions, UserActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { createTestTenant, createTestUser } from '@nia/prism/testing';
import { testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';

// Import after potential mocks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST, GET, PATCH, DELETE } = require('../src/app/api/organization-roles/route');

describe('Dashboard Organization Roles API', () => {
  it('assigns a user to organization by email (POST)', async () => {
    const tenant = await createTestTenant();
    const orgResult = await OrganizationActions.createOrganization({ name: 'Org A', tenantId: tenant._id!, description: 'd' });
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const url = 'http://localhost:3000/api/organization-roles';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = new NextRequest(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user-id': testSessionUser!._id! }, body: JSON.stringify({ tenantId: tenant._id, organizationId: (orgResult as any)._id, email: 'invitee@example.com', role: OrganizationRole.MEMBER }) }));
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.role).toBeTruthy();
    expect(data.role.role).toBe(OrganizationRole.MEMBER);
  });

  it('lists organization roles (GET)', async () => {
    const tenant = await createTestTenant();
    const org = await OrganizationActions.createOrganization({ name: 'Org B', tenantId: tenant._id!, description: 'd' });
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const user = await createTestUser({ name: 'User One', email: 'user1@example.com' }, 'p');
    await UserActions.createUser({ name: 'Temp', email: 'temp@example.com', password: 'pw' });
    await OrganizationActions.assignUserToOrganization(user._id!, org._id!, tenant._id!, OrganizationRole.ADMIN);
    const params = new URLSearchParams({ tenantId: tenant._id!, organizationId: org._id! });
    const url = `http://localhost:3000/api/organization-roles?${params.toString()}`;
    const req = new NextRequest(new Request(url, { headers: { 'x-test-user-id': testSessionUser!._id! } }));
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.roles)).toBe(true);
    expect(data.roles.length).toBeGreaterThanOrEqual(1);
  });

  it('updates organization role (PATCH)', async () => {
    const tenant = await createTestTenant();
    const org = await OrganizationActions.createOrganization({ name: 'Org C', tenantId: tenant._id!, description: 'd' });
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const user = await createTestUser({ name: 'User Two', email: 'user2@example.com' }, 'p');
    const role = await OrganizationActions.assignUserToOrganization(user._id!, org._id!, tenant._id!, OrganizationRole.MEMBER);
    console.log('[TEST DEBUG] Created role:', JSON.stringify(role, null, 2));
    const url = 'http://localhost:3000/api/organization-roles';
    const req = new NextRequest(new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-user-id': testSessionUser!._id! }, body: JSON.stringify({ tenantId: tenant._id, userOrganizationRoleId: role._id, role: OrganizationRole.ADMIN }) }));
    const res = await PATCH(req);
    const data = await res.json();
    if (res.status !== 200) {
      console.error('[TEST ERROR] PATCH failed:', res.status, data);
    }
    expect(res.status).toBe(200);
    expect(data.role.role).toBe(OrganizationRole.ADMIN);
  });

  it('delete organization role (DELETE)', async () => {
    const tenant = await createTestTenant();
    const org = await OrganizationActions.createOrganization({ name: 'Org D', tenantId: tenant._id!, description: 'd' });
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const user = await createTestUser({ name: 'User Three', email: 'user3@example.com' }, 'p');
    const role = await OrganizationActions.assignUserToOrganization(user._id!, org._id!, tenant._id!, OrganizationRole.MEMBER);
    const url = 'http://localhost:3000/api/organization-roles';
    const req = new NextRequest(new Request(url, { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-test-user-id': testSessionUser!._id! }, body: JSON.stringify({ tenantId: tenant._id, userOrganizationRoleId: role._id }) }));
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  it('prevents demoting last OWNER', async () => {
    const tenant = await createTestTenant();
    const org = await OrganizationActions.createOrganization({ name: 'Org E', tenantId: tenant._id!, description: 'd' });
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    // Make testSessionUser OWNER
    const ownerRole = await OrganizationActions.assignUserToOrganization(testSessionUser!._id!, org._id!, tenant._id!, OrganizationRole.OWNER);
    const url = 'http://localhost:3000/api/organization-roles';
    const req = new NextRequest(new Request(url, { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-test-user-id': testSessionUser!._id! }, body: JSON.stringify({ tenantId: tenant._id, userOrganizationRoleId: ownerRole._id, role: OrganizationRole.MEMBER }) }));
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Cannot remove or demote the last OWNER/i);
  });
});
