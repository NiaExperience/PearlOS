/* eslint-disable @typescript-eslint/no-explicit-any */
import { UserActions, OrganizationActions } from '@nia/prism/core/actions';
import { AssistantActions } from '@nia/prism/core/actions';
import { logAudit } from '@nia/prism/core/audit/logger';
import { getSessionSafely } from '@nia/prism/core/auth';
import { requireOrgAdminOrTenantAdmin, requireOrgAccess } from '@nia/prism/core/auth/auth.middleware';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { issueInviteToken, sendActivationInviteEmail } from '@nia/prism/core/email';
import { inc } from '@nia/prism/core/metrics/organizationRoleMetrics';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// POST /api/organization-roles { tenantId, organizationId, email, role }
export async function POST(req: NextRequest) {
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json();
    const { tenantId, organizationId, email, role, assistantSubDomain } = body;
    if (!tenantId || !organizationId || !email || !role) {
      return NextResponse.json({ error: 'tenantId, organizationId, email, role required' }, { status: 400 });
    }
    const permError = await requireOrgAdminOrTenantAdmin(organizationId, tenantId, req, dashboardAuthOptions);
    if (permError) return permError as NextResponse;

    let user = await UserActions.getUserByEmail(email.toLowerCase());
    if (!user) {
      user = await UserActions.createUser({ name: email.split('@')[0], email: email.toLowerCase() });
    }
    const userId = (user as any).page_id || (user as any)._id;
    const assigned = await OrganizationActions.assignUserToOrganization(userId, organizationId, tenantId, role as OrganizationRole);

    // If the user is provisional (no password), issue invite and email
    let invited = false as boolean;
    let messageId: string | undefined;
    let previewUrl: string | undefined;
    try {
      if (!('password_hash' in (user as any)) || !(user as any).password_hash) {
        const token = await issueInviteToken(String(userId), String(user.email));
        let assistantName: string | undefined;
        if (assistantSubDomain) {
          try {
            const a = await AssistantActions.getAssistantBySubDomain(assistantSubDomain);
            assistantName = a?.name || undefined;
          } catch {
            // ignore
          }
        }
        const { messageId: mid, previewUrl: purl } = await sendActivationInviteEmail({
          to: String(user.email),
          token,
          reqUrl: req.url,
          assistantSubDomain,
          assistantName,
        });
        invited = true;
        messageId = mid;
        previewUrl = purl;
      }
    } catch (inviteErr) {
      console.error('[organization-roles] invite dispatch failed', inviteErr);
    }
    inc('assignTotal');
    logAudit({
      ts: new Date().toISOString(),
      actorId: session.user.id,
      action: 'org.role.assign.email',
      tenantId,
      organizationId,
      targetUserId: user._id!,
      userOrganizationRoleId: assigned._id,
      newRole: assigned.role,
      status: 'success'
    });
    return NextResponse.json({ success: true, role: assigned, invited, messageId, previewUrl });
  } catch (e: any) {
    inc('errorsTotal');
    return NextResponse.json({ error: e.message || 'Failed to assign organization role' }, { status: 400 });
  }
}

// GET /api/organization-roles?tenantId=...&organizationId=...&userId=optional
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  const organizationId = url.searchParams.get('organizationId');
  const userId = url.searchParams.get('userId');
  if (!tenantId || !organizationId) return NextResponse.json({ error: 'tenantId and organizationId required' }, { status: 400 });
  const accessError = await requireOrgAccess(organizationId, tenantId, req, dashboardAuthOptions);
  if (accessError) return accessError as NextResponse;
  try {
    if (userId) {
      const roles = await OrganizationActions.getUserOrganizationRoles(userId, tenantId) || [];
      return NextResponse.json({ roles: roles.filter(r => r.organizationId === organizationId) });
    }
    const roles = await OrganizationActions.getOrganizationRoles(organizationId, tenantId);
    inc('listTotal');
    return NextResponse.json({ roles });
  } catch (e) {
    inc('errorsTotal');
    return NextResponse.json({ error: 'Failed to get organization roles' }, { status: 500 });
  }
}

// PATCH /api/organization-roles { tenantId, userOrganizationRoleId, role }
async function assertNotLastOrgOwner(organizationId: string, tenantId: string, targetUserOrganizationRoleId: string, newRole?: OrganizationRole | null) {
  // Fetch all roles and count owners
  const roles = await OrganizationActions.getOrganizationRoles(organizationId, tenantId) as any[];
  const activeOwners = roles.filter(r => r.role === OrganizationRole.OWNER);
  const target = roles.find(r => r._id === targetUserOrganizationRoleId && r.role === OrganizationRole.OWNER);
  if (!target) return; // not currently an owner
  const demoting = newRole && newRole !== OrganizationRole.OWNER;
  const removing = !newRole; // deactivation path
  if ((demoting || removing) && activeOwners.length === 1) {
    throw new Error('Cannot remove or demote the last OWNER');
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, userOrganizationRoleId, role } = body;
    if (!tenantId || !userOrganizationRoleId || !role) return NextResponse.json({ error: 'tenantId, userOrganizationRoleId, role required' }, { status: 400 });
    const existing = await OrganizationActions.getUserOrganizationRoleById(userOrganizationRoleId);
    if (!existing) return NextResponse.json({ error: 'organization role not found' }, { status: 404 });
    const permError = await requireOrgAdminOrTenantAdmin(existing.organizationId, tenantId, req, dashboardAuthOptions);
    if (permError) return permError as NextResponse;
    const session = await getSessionSafely(req, dashboardAuthOptions);
    await assertNotLastOrgOwner(existing.organizationId, tenantId, userOrganizationRoleId, role as OrganizationRole);
    const updated = await OrganizationActions.updateUserOrganizationRole(userOrganizationRoleId, tenantId, role as OrganizationRole);
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
    inc('errorsTotal');
    return NextResponse.json({ error: e.message || 'Failed to update organization role' }, { status: 400 });
  }
}

// DELETE /api/organization-roles { tenantId, userOrganizationRoleId }
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId, userOrganizationRoleId } = body;
    if (!tenantId || !userOrganizationRoleId) return NextResponse.json({ error: 'tenantId, userOrganizationRoleId required' }, { status: 400 });
    const existing = await OrganizationActions.getUserOrganizationRoleById(userOrganizationRoleId);
    if (!existing) return NextResponse.json({ error: 'organization role not found' }, { status: 404 });
    const permError = await requireOrgAdminOrTenantAdmin(existing.organizationId, tenantId, req, dashboardAuthOptions);
    if (permError) return permError as NextResponse;
    const session = await getSessionSafely(req, dashboardAuthOptions);
    await assertNotLastOrgOwner(existing.organizationId, tenantId, userOrganizationRoleId, null);
    const deleted = await OrganizationActions.deleteUserOrganizationRole(userOrganizationRoleId, tenantId);
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
    inc('errorsTotal');
    return NextResponse.json({ error: e.message || 'Failed to delete organization role' }, { status: 400 });
  }
}
