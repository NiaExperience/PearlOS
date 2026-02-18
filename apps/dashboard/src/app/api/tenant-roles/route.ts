/* eslint-disable @typescript-eslint/no-explicit-any */
import { TenantActions, UserActions } from '@nia/prism/core/actions';
import { getSessionSafely, requireAuth } from '@nia/prism/core/auth';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// GET /api/tenant-roles?tenantId=...&userId=optional
export async function GET(req: NextRequest) {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get('tenantId') || undefined;
  const targetUserId = searchParams.get('userId');
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    // Load all roles for tenant once
    const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
    // Determine caller's active role (if any)
    const callerRole = roles.find(r => r.userId === session.user.id)?.role as TenantRole | undefined;
    const callerIsAdmin = callerRole === TenantRole.ADMIN || callerRole === TenantRole.OWNER;
    if (!targetUserId) {
      // Listing all roles: must be admin/owner
      if (!callerIsAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      return NextResponse.json({ roles });
    }
    // Single user path: if requesting another user ensure admin
    if (targetUserId !== session.user.id && !callerIsAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetRoles = roles.filter(r => r.userId === targetUserId);
    return NextResponse.json({ roles: targetRoles });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch roles' }, { status: 400 });
  }
}

// Helper to assert caller is admin/owner in tenant
async function ensureTenantAdmin(tenantId: string, callerUserId: string) {
  const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const callerRole = roles.find(r => r.userId === callerUserId)?.role as TenantRole | undefined;
  const callerIsAdmin = callerRole === TenantRole.ADMIN || callerRole === TenantRole.OWNER;
  if (!callerIsAdmin) throw new Error('Forbidden');
}

// POST /api/tenant-roles { tenantId, userId, role }
export async function POST(req: NextRequest) {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { tenantId, userId, role } = body || {};
    if (!tenantId || !userId || !role) return NextResponse.json({ error: 'tenantId, userId, role required' }, { status: 400 });
    await ensureTenantAdmin(tenantId, session.user.id);
    // Validate user exists
    const user = await UserActions.getUserById(userId);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const assigned = await TenantActions.assignUserToTenant(userId, tenantId, role as TenantRole);
    return NextResponse.json({ role: assigned }, { status: 201 });
  } catch (e: any) {
    if (e.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: e.message || 'Failed to assign tenant role' }, { status: 400 });
  }
}

// PATCH /api/tenant-roles { tenantId, userId, role }
export async function PATCH(req: NextRequest) {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
    const { tenantId, userId, role } = body || {};
    if (!tenantId || !userId || !role) return NextResponse.json({ error: 'tenantId, userId, role required' }, { status: 400 });
    await ensureTenantAdmin(tenantId, session.user.id);
    const updated = await TenantActions.updateUserTenantRole(userId, tenantId, role as TenantRole);
    return NextResponse.json({ role: updated });
  } catch (e: any) {
    if (e.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: e.message || 'Failed to update tenant role' }, { status: 400 });
  }
}

// Helper: prevent removing or demoting the last OWNER
async function assertNotLastTenantOwner(tenantId: string, targetUserId: string, newRole?: TenantRole | null) {
  const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
  const activeOwners = roles.filter(r => r.role === TenantRole.OWNER);
  const targetIsOwner = roles.find(r => r.userId === targetUserId && r.role === TenantRole.OWNER);
  if (!targetIsOwner) return; // target not an owner currently
  const demoting = newRole && newRole !== TenantRole.OWNER;
  const removing = !newRole; // delete pathway
  if ((demoting || removing) && activeOwners.length === 1) {
    throw new Error('Cannot remove or demote the last OWNER');
  }
}

// DELETE /api/tenant-roles { tenantId, userId }
export async function DELETE(req: NextRequest) {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return NextResponse.json({ error: 'Access Denied' }, { status: 403 });
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json();
  const { tenantId, userId } = body || {};
    if (!tenantId || !userId) return NextResponse.json({ error: 'tenantId, userId required' }, { status: 400 });
    await ensureTenantAdmin(tenantId, session.user.id);
  await assertNotLastTenantOwner(tenantId, userId, null);
    const deleted = await TenantActions.deleteUserTenantRole(userId, tenantId);
    return NextResponse.json({ role: deleted });
  } catch (e: any) {
    if (e.message === 'Forbidden') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ error: e.message || 'Failed to delete tenant role' }, { status: 400 });
  }
}
