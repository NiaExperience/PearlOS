import { Prism } from '@nia/prism';
import { UserActions } from '@nia/prism/core/actions';
import { TenantActions } from '@nia/prism/core/actions';
import { AssistantActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { BlockType_UserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { issueInviteToken, sendActivationInviteEmail, resolveInterfaceBaseUrl, buildInviteLink } from '@nia/prism/core/email';
import { BlockType_User } from '@nia/prism/testing';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// POST /api/tenants/:tenantId/roles  { email, role }
export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { tenantId } = await params;
  if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
  try {
    const body = await req.json();
    const { email, role, assistantSubDomain } = body;
    if (!email || !role) return NextResponse.json({ error: 'email and role required' }, { status: 400 });
    const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
    const isAdmin = roles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    let user = await UserActions.getUserByEmail(email.toLowerCase());
    if (!user) {
      // Auto-create minimal user account
      user = await UserActions.createUser({ name: email.split('@')[0], email: email.toLowerCase() });
    }
    const userId = (user as any).page_id || (user as any)._id;
    const assigned: any = await TenantActions.assignUserToTenant(userId, tenantId, role as TenantRole);
    // Backfill UserProfile.userId for this tenant/email if any UserProfile records exist
    try {
      const prism = await Prism.getInstance();
      const emailLc = String(user.email || '').toLowerCase();
      const found = await prism.query({
        contentType: BlockType_UserProfile,
        where: { type: { eq: BlockType_UserProfile }, parent_id: { eq: tenantId }, indexer: { path:'email', equals: emailLc } },
        limit: 100,
        tenantId,
      } as any);
      if (found?.total && found?.total == 1) {
        console.log(`[UserProfile backfill] updating UserProfile for ${emailLc} with userId ${userId}`);
        // Update each record with the resolved userId
        for (const item of found.items as any[]) {
          const id = item._id || item.page_id;
          if (!id) continue;
          // Use atomic merge - only update userId field
          try { await prism.update(BlockType_UserProfile, id, { userId: String(userId) }); } catch { }
        }
      } else if (found?.total && found.total > 1) {
        console.error(`[UserProfile backfill] Multiple UserProfile records (${found.total}) found for ${emailLc}, skipping userId backfill`);
      }
    } catch (e) {
      console.warn('[UserProfile backfill] skipped or failed:', (e as any)?.message || e);
    }

    // If the user doesn't have a password yet, issue an invite and send email
    let invited = false as boolean;
    let messageId: string | undefined;
    let previewUrl: string | undefined;
    try {
      // Treat missing password as provisional account needing invite
      if (!('password_hash' in (user as any)) || !(user as any).password_hash) {
        const token = await issueInviteToken(String(userId), String(user.email));
        // Try to find assistant friendly name for subject/body
        let assistantName: string | undefined;
        if (assistantSubDomain) {
          try { const a = await AssistantActions.getAssistantBySubDomain(assistantSubDomain); assistantName = a?.name || undefined; } catch { }
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
      // Don't fail the role assignment if email sending fails; surface status instead
      console.error('[tenant-roles] invite dispatch failed', inviteErr);
    }

    return NextResponse.json({ success: true, role: assigned, operation: assigned.operation, invited, messageId, previewUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to assign user' }, { status: 400 });
  }
}

// PATCH /api/tenants/:tenantId/roles  { userId, role }
export async function PATCH(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { tenantId } = params;
  try {
    const body = await req.json();
    const { userId, role } = body;
    if (!userId || !role) return NextResponse.json({ error: 'userId and role required' }, { status: 400 });
    const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
    const isAdmin = roles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const updated = await TenantActions.updateUserTenantRole(userId, tenantId, role);
    return NextResponse.json({ success: true, role: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to update role' }, { status: 400 });
  }
}

// DELETE /api/tenants/:tenantId/roles  { userId }
export async function DELETE(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { tenantId } = params;
  try {
    const body = await req.json();
    const { userId } = body;
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });
    const roles = await TenantActions.getTenantRolesForTenant(tenantId) as any[];
    const isAdmin = roles.some(r => r.userId === session.user.id && (r.role === TenantRole.ADMIN || r.role === TenantRole.OWNER));
    if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const deleted = await TenantActions.deleteUserTenantRole(userId, tenantId);
    return NextResponse.json({ success: true, role: deleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to delete role' }, { status: 400 });
  }
}
