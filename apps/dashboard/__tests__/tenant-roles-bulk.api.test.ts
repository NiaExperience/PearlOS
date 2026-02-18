/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
import { OrganizationActions, TenantActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { NextRequest } from 'next/server';

import { createTestOrganization, createTestTenant, createTestUser, testSessionUser } from '../../../packages/prism/src/testing';
import { POST as OrgBulkPOST } from '../src/app/api/organization-roles/bulk/route';
import { POST as TenantBulkPOST } from '../src/app/api/tenant-roles/bulk/route';


describe('Bulk Role APIs', () => {
  it('assigns tenant roles in bulk then removes them', async () => {
    const tenant = await createTestTenant();
    // ensure session user is admin of tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

    const u1 = await createTestUser({ name: 'Bulk U1', email: 'bulku1@example.com' }, 'pw');
    const u2 = await createTestUser({ name: 'Bulk U2', email: 'bulku2@example.com' }, 'pw');

    const reqAssign = new NextRequest(new Request('http://localhost:3000/api/tenant-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, updates: [{ userId: u1._id, role: 'member' }, { userId: u2._id, role: 'admin' }] }) }));
    const resAssign = await TenantBulkPOST(reqAssign);
    expect(resAssign.status).toBe(200);
    const dataAssign = await resAssign.json();
    expect(dataAssign.success).toBe(true);

    // verify assignments
    const rolesAfter = await TenantActions.getTenantRolesForTenant(tenant._id!);
    const r1 = rolesAfter.find((r: any) => r.userId === u1._id);
    const r2 = rolesAfter.find((r: any) => r.userId === u2._id);
    expect(r1 && r1.role).toBe('member');
    expect(r2 && r2.role).toBe('admin');

    // remove via bulk
    const reqRemove = new NextRequest(new Request('http://localhost:3000/api/tenant-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, updates: [{ userId: u1._id, role: null }, { userId: u2._id, role: null }] }) }));
    const resRemove = await TenantBulkPOST(reqRemove);
    expect(resRemove.status).toBe(200);
    const dataRemove = await resRemove.json();
    expect(dataRemove.success).toBe(true);
  });

  it('assigns organization roles in bulk then updates one', async () => {
    const tenant = await createTestTenant();
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const org = await createTestOrganization({ name: 'BulkOrg', tenantId: tenant._id });

    const u1 = await createTestUser({ name: 'OrgBulk U1', email: 'orgbulku1@example.com' }, 'pw');
    const u2 = await createTestUser({ name: 'OrgBulk U2', email: 'orgbulku2@example.com' }, 'pw');

    const reqAssign = new NextRequest(new Request('http://localhost:3000/api/organization-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, organizationId: org._id, updates: [{ userId: u1._id, role: 'member' }, { userId: u2._id, role: 'admin' }] }) }));
    const resAssign = await OrgBulkPOST(reqAssign);
    expect(resAssign.status).toBe(200);
    const dataAssign = await resAssign.json();
    expect(dataAssign.success).toBe(true);

    // Update one role
    const reqUpdate = new NextRequest(new Request('http://localhost:3000/api/organization-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, organizationId: org._id, updates: [{ userId: u2._id, role: 'owner' }] }) }));
    const resUpdate = await OrgBulkPOST(reqUpdate);
    expect(resUpdate.status).toBe(200);
    const dataUpdate = await resUpdate.json();
    expect(dataUpdate.success).toBe(true);

    const orgRoles = await OrganizationActions.getOrganizationRoles(org._id!, tenant._id!);
    const u2Role = orgRoles.find((r: any) => r.userId === u2._id);
    expect(u2Role && u2Role.role).toBe('owner');
  });
});
