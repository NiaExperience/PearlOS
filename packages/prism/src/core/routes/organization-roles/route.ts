/* eslint-disable @typescript-eslint/no-explicit-any */
import { assignUserToOrganization, updateUserOrganizationRole, deleteUserOrganizationRole, getUserOrganizationRoles, getOrganizationRoles, getUserOrganizationRoleById } from '@nia/prism/core/actions/organization-actions';
import { logAudit } from '@nia/prism/core/audit/logger';
import { requireOrgAccess, requireOrgAdminOrTenantAdmin } from '@nia/prism/core/auth/auth.middleware';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { inc } from '@nia/prism/core/metrics/organizationRoleMetrics';
import { validateOrgRoleChange, validateOrgRoleRemoval } from '@nia/prism/core/security/role-guards';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../logger';

const log = getLogger('prism:routes:organization-roles');

// GET /api/organization-roles?tenantId=...&organizationId=...&userId=optional
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const organizationId = url.searchParams.get('organizationId');
  const userId = url.searchParams.get('userId');
  if (!tenantId || !organizationId) return NextResponse.json({ error: 'tenantId and organizationId required' }, { status: 400 });
  const accessError = await requireOrgAccess(organizationId, tenantId, req, authOptions);
  if (accessError) return accessError as NextResponse;
  try {
    if (userId) {
      const roles = await getUserOrganizationRoles(userId, tenantId) || [];
      return NextResponse.json({ roles: roles.filter(r => r.organizationId === organizationId) });
    }
    // TODO(pagination): implement pagination & filtering when role counts grow.
    const roles = await getOrganizationRoles(organizationId, tenantId);
    inc('listTotal');
    return NextResponse.json({ roles });
  } catch (e) {
    log.error('ORG ROLES GET error', { error: e, tenantId, organizationId, userId });
    inc('errorsTotal');
    return NextResponse.json({ error: 'Failed to get organization roles' }, { status: 500 });
  }
}

// POST /api/organization-roles { tenantId, organizationId, userId, role }
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { tenantId, organizationId, userId, role } = body;
    if (!tenantId || !organizationId || !userId || !role) return NextResponse.json({ error: 'tenantId, organizationId, userId, role required' }, { status: 400 });
    const permError = await requireOrgAdminOrTenantAdmin(organizationId, tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const session = await getSessionSafely(req, authOptions);
    // Hierarchy guard: actor cannot assign role higher than their own; cannot modify higher-ranked target
    try {
      if (session?.user?.id) {
        const actorOrgRoles = await getUserOrganizationRoles(session.user.id, tenantId) || [];
        const targetOrgRoles = await getUserOrganizationRoles(userId, tenantId) || [];
        const rank = (r: any) => r.role === 'owner' ? 4 : r.role === 'admin' ? 3 : r.role === 'member' ? 2 : r.role === 'viewer' ? 1 : 0;
        const actorRank = Math.max(0, ...actorOrgRoles.filter(r => r.organizationId === organizationId).map(rank));
        const targetCurrentRank = Math.max(0, ...targetOrgRoles.filter(r => r.organizationId === organizationId).map(rank));
        const desiredRank = rank({ role });
        if (desiredRank > actorRank) return NextResponse.json({ error: 'Cannot assign role higher than your own.' }, { status: 403 });
        if (targetCurrentRank > actorRank) return NextResponse.json({ error: 'Cannot modify a user with higher access.' }, { status: 403 });
      }
    } catch (e) { log.warn('Org role hierarchy guard (POST) failed', { error: e, tenantId, organizationId, userId }); }
    const record = await assignUserToOrganization(userId, organizationId, tenantId, role as OrganizationRole);
    inc('assignTotal');
    logAudit({
      ts: new Date().toISOString(),
      actorId: session!.user.id,
      action: 'org.role.assign',
      tenantId,
      organizationId,
      targetUserId: userId,
      userOrganizationRoleId: record._id,
      newRole: record.role,
      status: 'success'
    });
    return NextResponse.json({ role: record }, { status: 201 });
  } catch (e: any) {
    log.error('ORG ROLES POST error', { error: e });
    inc('errorsTotal');
    try {
      const session = await getSessionSafely(req, authOptions);
      logAudit({
        ts: new Date().toISOString(),
        actorId: session?.user?.id || 'unknown',
        action: 'org.role.assign',
        status: 'error',
        message: e?.message
      });
    } catch { /* ignore */ }
    return NextResponse.json({ error: 'Failed to assign organization role' }, { status: 400 });
  }
}

// PATCH /api/organization-roles { tenantId, userOrganizationRoleId, role }
export async function PATCH_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { tenantId, userOrganizationRoleId, role } = body;
    if (!tenantId || !userOrganizationRoleId || !role) return NextResponse.json({ error: 'tenantId, userOrganizationRoleId, role required' }, { status: 400 });
    const existing = await getUserOrganizationRoleById(userOrganizationRoleId);
    if (!existing) return NextResponse.json({ error: 'organization role not found' }, { status: 404 });
    const permError = await requireOrgAdminOrTenantAdmin(existing.organizationId, tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const session = await getSessionSafely(req, authOptions);
    // Hierarchy / self guard via centralized helper
    try {
      if (session?.user?.id) {
        const actorOrgRoles = await getUserOrganizationRoles(session.user.id, tenantId) || [];
        const targetOrgRoles = await getUserOrganizationRoles(existing.userId, tenantId) || [];
        const guard = validateOrgRoleChange({
          actorId: session.user.id,
          targetId: existing.userId,
          orgId: existing.organizationId,
          tenantId,
          actorOrgRoles: actorOrgRoles as any,
          targetOrgRoles: targetOrgRoles as any,
          desiredRole: role,
        });
        if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      }
    } catch (e) { log.warn('Org role hierarchy guard (PATCH) failed', { error: e, tenantId, orgId: existing.organizationId, targetUserId: existing.userId }); }
    const updated = await updateUserOrganizationRole(userOrganizationRoleId, tenantId, role as OrganizationRole);
    inc('updateTotal');
    logAudit({
      ts: new Date().toISOString(),
      actorId: session!.user.id,
      action: 'org.role.update',
      tenantId,
      organizationId: updated.organizationId,
      targetUserId: updated.userId,
      userOrganizationRoleId: updated._id,
      prevRole: existing.role,
      newRole: updated.role,
      status: 'success'
    });
    return NextResponse.json({ role: updated });
  } catch (e: any) {
    log.error('ORG ROLES PATCH error', { error: e });
    inc('errorsTotal');
    try {
      const session = await getSessionSafely(req, authOptions);
      logAudit({
        ts: new Date().toISOString(),
        actorId: session?.user?.id || 'unknown',
        action: 'org.role.update',
        status: 'error',
        message: e?.message
      });
    } catch { /* ignore */ }
    return NextResponse.json({ error: 'Failed to update organization role' }, { status: 400 });
  }
}

// DELETE /api/organization-roles { tenantId, userOrganizationRoleId }
export async function DELETE_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { tenantId, userOrganizationRoleId } = body;
    if (!tenantId || !userOrganizationRoleId) return NextResponse.json({ error: 'tenantId, userOrganizationRoleId required' }, { status: 400 });
    const existing = await getUserOrganizationRoleById(userOrganizationRoleId);
    if (!existing) return NextResponse.json({ error: 'organization role not found' }, { status: 404 });
    const permError = await requireOrgAdminOrTenantAdmin(existing.organizationId, tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const session = await getSessionSafely(req, authOptions);
    // Hierarchy / self guard for removal
    try {
      if (session?.user?.id) {
        const actorOrgRoles = await getUserOrganizationRoles(session.user.id, tenantId) || [];
        const targetOrgRoles = await getUserOrganizationRoles(existing.userId, tenantId) || [];
        const guard = validateOrgRoleRemoval({
          actorId: session.user.id,
          targetId: existing.userId,
          orgId: existing.organizationId,
          tenantId,
          actorOrgRoles: actorOrgRoles as any,
          targetOrgRoles: targetOrgRoles as any,
        });
        if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
      }
    } catch (e) { log.warn('Org role hierarchy guard (DELETE) failed', { error: e, tenantId, orgId: existing.organizationId, targetUserId: existing.userId }); }
    const deleted = await deleteUserOrganizationRole(userOrganizationRoleId, tenantId);
    inc('deleteTotal');
    logAudit({
      ts: new Date().toISOString(),
      actorId: session!.user.id,
      action: 'org.role.delete',
      tenantId,
      organizationId: deleted.organizationId,
      targetUserId: deleted.userId,
      userOrganizationRoleId: deleted._id,
      prevRole: deleted.role,
      status: 'success'
    });
    return NextResponse.json({ role: deleted });
  } catch (e: any) {
    log.error('ORG ROLES DELETE error', { error: e });
    inc('errorsTotal');
    try {
      const session = await getSessionSafely(req, authOptions);
      logAudit({
        ts: new Date().toISOString(),
        actorId: session?.user?.id || 'unknown',
        action: 'org.role.delete',
        status: 'error',
        message: e?.message
      });
    } catch { /* ignore */ }
    return NextResponse.json({ error: 'Failed to delete organization role' }, { status: 400 });
  }
}
