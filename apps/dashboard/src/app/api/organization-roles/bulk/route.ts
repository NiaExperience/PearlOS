/* eslint-disable @typescript-eslint/no-explicit-any */
import { OrganizationActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { requireOrgAdminOrTenantAdmin } from '@nia/prism/core/auth/auth.middleware';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// POST /api/organization-roles/bulk { tenantId, organizationId, updates: [ { userId, email?, role|null } ] }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, organizationId, updates } = body || {};
    if (!tenantId || !organizationId || !Array.isArray(updates)) return NextResponse.json({ error: 'tenantId, organizationId, updates required' }, { status: 400 });
    const permError = await requireOrgAdminOrTenantAdmin(organizationId, tenantId, req, dashboardAuthOptions);
    if (permError) return permError as NextResponse;
    const results: any[] = [];
    // Preload roles cache
    let orgRoles = await OrganizationActions.getOrganizationRoles(organizationId, tenantId) as any[];
    for (const u of updates) {
      if (!u) continue;
      try {
        let userId = u.userId;
        if (!userId && u.email) {
          const user = await UserActions.getUserByEmail(u.email.toLowerCase());
          if (user) userId = user._id!;
        }
        if (!userId) { results.push({ email: u.email, status: 'error', error: 'userId or existing email required' }); continue; }
        if (!u.role) {
          // delete if not last OWNER
          const existingRoles = orgRoles.find(r => r.userId === userId);
          if (existingRoles && existingRoles.role === OrganizationRole.OWNER) {
            const activeOwners = orgRoles.filter(r => r.role === OrganizationRole.OWNER);
            if (activeOwners.length === 1) {
              results.push({ userId, status: 'error', error: 'Cannot remove or demote the last OWNER' });
              continue;
            }
          }
          if (existingRoles) {
            const deleted : string[] = [];
            for (const userOrgRole of existingRoles) {
              const deletedRole = await OrganizationActions.deleteUserOrganizationRole(userOrgRole._id, tenantId);
              deleted.push(deletedRole._id!);
              results.push({ userId, status: 'ok', action: 'removed', role: userOrgRole.role });
            }
            orgRoles = orgRoles.filter(r => r._id !== existingRoles._id);
          } else {
            results.push({ userId, status: 'ok', action: 'noop' });
          }
          continue;
        }
        const existingActive = orgRoles.find(r => r.userId === userId);
        if (!existingActive) {
          // need email to assign if user has no role yet
          let user = await UserActions.getUserById(userId);
          if (!user && u.email) {
            user = await UserActions.createUser({ name: u.email.split('@')[0], email: u.email.toLowerCase() });
            userId = user._id;
          }
          if (!user) { results.push({ userId, status: 'error', error: 'User not found' }); continue; }
          const assigned = await OrganizationActions.assignUserToOrganization(userId, organizationId, tenantId, u.role as OrganizationRole);
          results.push({ userId, status: 'ok', action: 'assigned', role: assigned.role });
          orgRoles.push(assigned);
        } else if (existingActive.role !== u.role) {
          if (existingActive.role === OrganizationRole.OWNER && u.role !== OrganizationRole.OWNER) {
            const activeOwners = orgRoles.filter(r => r.role === OrganizationRole.OWNER);
            if (activeOwners.length === 1) {
              results.push({ userId, status: 'error', error: 'Cannot remove or demote the last OWNER' });
              continue;
            }
          }
          const updated = await OrganizationActions.updateUserOrganizationRole(existingActive._id, tenantId, u.role as OrganizationRole);
          results.push({ userId, status: 'ok', action: 'updated', role: updated.role });
          orgRoles = orgRoles.map(r => r._id === updated._id ? updated : r);
        } else {
          results.push({ userId, status: 'ok', action: 'noop', role: existingActive.role });
        }
      } catch (e: any) {
        results.push({ userId: u.userId, status: 'error', error: e.message || 'Failed' });
      }
    }
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Bulk org role update failed' }, { status: 400 });
  }
}
