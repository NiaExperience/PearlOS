/* eslint-disable @typescript-eslint/no-explicit-any */
import { assignUserToTenant, updateUserTenantRole, deleteUserTenantRole, getUserTenantRoles, getTenantRolesForTenant } from '@nia/prism/core/actions/tenant-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { validateTenantRoleChange, validateTenantRoleRemoval } from '@nia/prism/core/security/role-guards';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../logger';

const log = getLogger('prism:routes:tenant-roles');

// GET /api/tenant-roles?userId=... (optional) & tenantId=...
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const userId = url.searchParams.get('userId');
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  try {
    if (userId) {
      const roles = (await getUserTenantRoles(userId)) || [];
      return NextResponse.json({ roles: roles.filter(r => r.tenantId === tenantId) });
    }
  const roles = await getTenantRolesForTenant(tenantId) || [];
  return NextResponse.json({ roles });
  } catch (e) {
    log.error('TENANT ROLES GET error', { error: e, tenantId, userId });
    return NextResponse.json({ error: 'Failed to get tenant roles' }, { status: 500 });
  }
}

// POST /api/tenant-roles { tenantId, userId, role }
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  try {
    const body = await req.json();
    const { tenantId, userId, role } = body;
    if (!tenantId || !userId || !role) return NextResponse.json({ error: 'tenantId, userId, role required' }, { status: 400 });
    const roleEnum = role as TenantRole;
    const record = await assignUserToTenant(userId, tenantId, roleEnum);
    return NextResponse.json({ role: record }, { status: 201 });
  } catch (e) {
    log.error('TENANT ROLES POST error', { error: e });
    return NextResponse.json({ error: 'Failed to assign tenant role' }, { status: 400 });
  }
}

// PATCH /api/tenant-roles { tenantId, userId, role }
export async function PATCH_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  try {
    const body = await req.json();
    const { tenantId, userId, role } = body;
    if (!tenantId || !userId || !role) return NextResponse.json({ error: 'tenantId, userId, role required' }, { status: 400 });
    const session = await getSessionSafely(req, authOptions);
    try {
      if (session?.user?.id) {
        const actorRoles = (await getUserTenantRoles(session.user.id)) || [];
        const targetRoles = (await getUserTenantRoles(userId)) || [];
        const guard = validateTenantRoleChange({
          actorId: session.user.id,
          targetId: userId,
            tenantId,
          actorRoles: actorRoles as any,
          targetRoles: targetRoles as any,
          desiredRole: role,
        });
        if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      }
    } catch (e) { log.warn('Role guard evaluation failed', { error: e, tenantId, actorId: session?.user?.id, targetUserId: userId, role }); }
    const updated = await updateUserTenantRole(userId, tenantId, role as TenantRole);
    return NextResponse.json({ role: updated });
  } catch (e) {
    log.error('TENANT ROLES PATCH error', { error: e });
    return NextResponse.json({ error: 'Failed to update tenant role' }, { status: 400 });
  }
}

// DELETE /api/tenant-roles { tenantId, userId }
export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  try {
    const body = await req.json();
    const { tenantId, userId } = body;
    if (!tenantId || !userId) return NextResponse.json({ error: 'tenantId, userId required' }, { status: 400 });
    const session = await getSessionSafely(req, authOptions);
    if (session?.user?.id) {
      try {
        const actorRoles = (await getUserTenantRoles(session.user.id)) || [];
        const targetRoles = (await getUserTenantRoles(userId)) || [];
        const guard = validateTenantRoleRemoval({
          actorId: session.user.id,
          targetId: userId,
          tenantId,
          actorRoles: actorRoles as any,
          targetRoles: targetRoles as any,
        });
        if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      } catch (e) { log.warn('Tenant role removal guard failed', { error: e, tenantId, actorId: session?.user?.id, targetUserId: userId }); }
    }
    const deleted = await deleteUserTenantRole(userId, tenantId);
    return NextResponse.json({ role: deleted });
  } catch (e) {
    log.error('TENANT ROLES DELETE error', { error: e });
    return NextResponse.json({ error: 'Failed to delete tenant role' }, { status: 400 });
  }
}
