/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { createTestTenant, testSessionUser, createTestOrganization } from '../../../packages/prism/src/testing';
import { TenantActions, OrganizationActions } from '@nia/prism/core/actions';
import { POST as TenantBulkPOST } from '../src/app/api/tenant-roles/bulk/route';
import { DELETE as TenantDelete } from '../src/app/api/tenant-roles/route';
import { POST as OrgBulkPOST } from '../src/app/api/organization-roles/bulk/route';
import { PATCH as OrgPatch, POST as OrgSingleAssign, DELETE as OrgDelete } from '../src/app/api/organization-roles/route';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';

describe('Last OWNER safeguard', () => {
  it('prevents removing the last tenant OWNER via DELETE and bulk', async () => {
    const tenant = await createTestTenant();
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.OWNER);
    const reqDel = new NextRequest(new Request('http://localhost:3000/api/tenant-roles', { method: 'DELETE', body: JSON.stringify({ tenantId: tenant._id, userId: testSessionUser!._id }) }));
    const resDel = await TenantDelete(reqDel);
    expect(resDel.status).toBe(400);
    const dataDel = await resDel.json();
    expect(dataDel.error).toMatch(/last OWNER/i);
    const reqBulk = new NextRequest(new Request('http://localhost:3000/api/tenant-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, updates: [ { userId: testSessionUser!._id, role: 'admin' } ] }) }));
    const resBulk = await TenantBulkPOST(reqBulk);
    const dataBulk = await resBulk.json();
    const blocked = dataBulk.results.find((r:any) => r.userId === testSessionUser!._id);
    expect(blocked.error).toMatch(/last OWNER/i);
  });

  it('prevents removing last organization OWNER via PATCH and bulk', async () => {
    const tenant = await createTestTenant();
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);
    const org = await OrganizationActions.createOrganization({ name: 'Safeguard', tenantId: tenant._id! } as any);
    // Assign owner role to testSessionUser via single assign route using its email
    const assignReq = new NextRequest(new Request('http://localhost:3000/api/organization-roles', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, organizationId: org._id, email: 'owner@example.com', role: 'owner' }) }));
    const assignRes = await OrgSingleAssign(assignReq);
    expect(assignRes.status).toBe(200);
    const roles = await OrganizationActions.getOrganizationRoles(org._id!, tenant._id!);
    const ownerRole = roles.find((r:any) => r.role === 'owner');
    expect(ownerRole).toBeTruthy();
  if (!ownerRole) throw new Error('ownerRole missing');
  const patchReq = new NextRequest(new Request('http://localhost:3000/api/organization-roles', { method: 'PATCH', body: JSON.stringify({ tenantId: tenant._id, userOrganizationRoleId: ownerRole._id, role: 'admin' }) }));
    const patchRes = await OrgPatch(patchReq);
    const patchData = await patchRes.json();
    expect(patchRes.status).toBe(400);
    expect(patchData.error).toMatch(/last OWNER/i);
  const bulkReq = new NextRequest(new Request('http://localhost:3000/api/organization-roles/bulk', { method: 'POST', body: JSON.stringify({ tenantId: tenant._id, organizationId: org._id, updates: [ { userId: ownerRole.userId, role: null } ] }) }));
    const bulkRes = await OrgBulkPOST(bulkReq);
    const bulkData = await bulkRes.json();
    expect(bulkData.results[0].error).toMatch(/last OWNER/i);
  });
});
