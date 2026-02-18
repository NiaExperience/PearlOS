/* eslint-disable @typescript-eslint/no-explicit-any */
import { TenantActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely, requireAuth } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

async function ensureTenantAdmin(tenantId: string, callerUserId: string) {
  const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const callerRole = roles.find(r => r.userId === callerUserId)?.role as TenantRole | undefined;
  const callerIsAdmin = callerRole === TenantRole.ADMIN || callerRole === TenantRole.OWNER;
  if (!callerIsAdmin) throw new Error('Forbidden');
}

// POST /api/tenant-roles/bulk { tenantId, updates: [ { userId, role|null } ] }
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { tenantId, updates } = body || {};
    if (!tenantId || !Array.isArray(updates)) return NextResponse.json({ error: 'tenantId, updates required' }, { status: 400 });
    await ensureTenantAdmin(tenantId, session.user.id);
    const results: any[] = [];
    // Preload roles once for performance then keep local cache updates
    let tenantRoles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
    // For owner safety checks we need initial snapshot of owners
    for (const u of updates) {
      if (!u || !u.userId) continue;
      try {
        const exists = await UserActions.getUserById(u.userId);
        if (!exists) { results.push({ userId: u.userId, status: 'error', error: 'User not found' }); continue; }
        // Last owner protection: if this update would demote/remove the final owner, block.
        const isOwnerCurrently = tenantRoles.some(r => r.userId === u.userId && r.role === TenantRole.OWNER);
        if (isOwnerCurrently) {
          const activeOwnersNow = tenantRoles.filter(r => r.role === TenantRole.OWNER);
          const demoting = u.role && u.role !== TenantRole.OWNER;
            const removing = !u.role;
          if ((demoting || removing) && activeOwnersNow.length === 1) {
            results.push({ userId: u.userId, status: 'error', error: 'Cannot remove or demote the last OWNER' });
            continue;
          }
        }
        if (!u.role) {
          try {
            const deleted = await TenantActions.deleteUserTenantRole(u.userId, tenantId);
            results.push({ userId: u.userId, status: 'ok', action: 'removed', role: deleted?.role });
            // mutate local cache
            delete tenantRoles[tenantRoles.findIndex(r => r.userId === u.userId)];
          } catch (e:any) {
            results.push({ userId: u.userId, status: 'error', error: e.message || 'Failed to remove' });
          }
          continue;
        }
        const existingActive = tenantRoles.find(r => r.userId === u.userId);
        if (!existingActive) {
          const assigned = await TenantActions.assignUserToTenant(u.userId, tenantId, u.role as TenantRole);
            results.push({ userId: u.userId, status: 'ok', action: 'assigned', role: assigned.role });
            tenantRoles.push(assigned);
        } else if (existingActive.role !== u.role) {
          const updated = await TenantActions.updateUserTenantRole(u.userId, tenantId, u.role as TenantRole);
            results.push({ userId: u.userId, status: 'ok', action: 'updated', role: updated.role });
            tenantRoles = tenantRoles.map(r => r._id === updated._id ? updated : r);
        } else {
          results.push({ userId: u.userId, status: 'ok', action: 'noop', role: existingActive.role });
        }
      } catch (e:any) {
        results.push({ userId: u.userId, status: 'error', error: e.message || 'Failed' });
      }
    }
    return NextResponse.json({ success: true, results });
  } catch (e:any) {
    if (e.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: e.message || 'Bulk tenant role update failed' }, { status: 400 });
  }
}
