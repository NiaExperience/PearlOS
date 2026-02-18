/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prism, PrismContentQuery } from '@nia/prism';
import { UserActions, TenantActions, OrganizationActions } from '@nia/prism/core/actions';
import { getUserOrganizationRoles } from '@nia/prism/core/actions/organization-actions';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { getSessionSafely, requireTenantAdmin, requireTenantAccess } from '@nia/prism/core/auth';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { BlockType_Account } from '@nia/prism/core/blocks/account.block';
import { BlockType_Assistant } from '@nia/prism/core/blocks/assistant.block';
import { BlockType_AssistantFeedback } from '@nia/prism/core/blocks/assistantFeedback.block';
import { BlockType_AssistantTheme } from '@nia/prism/core/blocks/assistantTheme.block';
import { BlockType_DynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';
import { BlockType_Organization } from '@nia/prism/core/blocks/organization.block';
import { BlockType_Tool } from '@nia/prism/core/blocks/tool.block';
import { BlockType_User } from '@nia/prism/core/blocks/user.block';
import { BlockType_UserOrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { BlockType_UserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { BlockType_UserTenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { getLogger } from '@nia/prism/core/logger';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

const log = getLogger('prism:routes:users');

const tenantRoleRank: Record<string, number> = { owner: 3, admin: 2, member: 1 };

async function getHighestTenantRole(userId: string, tenantId: string): Promise<number> {
  try {
    const roles = await TenantActions.getUserTenantRoles(userId) as any[];
    const active = roles.filter(r => r.tenantId === tenantId);
    if (!active.length) return 0;
    return Math.max(...active.map(r => tenantRoleRank[r.role] || 0));
  } catch {
    return 0;
  }
}

export async function DELETE_impl(req: NextRequest, { params }: { params: { userId: string } }, authOptions: NextAuthOptions): Promise<NextResponse> {
  const { userId } = (await params);
  const url = new URL(req.url);
  const tenantId = url.searchParams.get('tenantId');
  let purgeAll = true;
  try {
    const cloned = req.clone();
    const bodyText = await cloned.text();
    if (bodyText) {
      try { 
        const parsed = JSON.parse(bodyText); 
        if (parsed.purgeAll !== undefined) {
          purgeAll = !!parsed.purgeAll; 
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  const session = await getSessionSafely(req, authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (session.user.id === userId) {
    return NextResponse.json({ error: 'You cannot delete your own user.' }, { status: 400 });
  }

  const superAdmin = isSuperAdmin(session.user.id);
  if (!superAdmin) {
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });
    const permError = await requireTenantAdmin(tenantId, req, authOptions);
    if (permError) return permError as NextResponse;
    const actorRank = await getHighestTenantRole(session.user.id, tenantId);
    const targetRank = await getHighestTenantRole(userId, tenantId);
    if (targetRank > actorRank) {
      return NextResponse.json({ error: 'Cannot delete a user with higher access.' }, { status: 403 });
    }
  }

  // Ownership guard: prevent deleting if user is OWNER of any tenant
  try {
    const tenantRoles = await getUserTenantRoles(userId) || [];
    const ownerRoles = tenantRoles.filter(r => r.role === 'owner');
    if (ownerRoles.length > 0) {
      const blockingTenants = [];
      for (const r of ownerRoles) {
        const t = await TenantActions.getTenantById(r.tenantId);
        if (t) blockingTenants.push({ id: t._id, name: t.name });
      }
      return NextResponse.json({ 
        error: 'Cannot delete user: they are an OWNER of at least one tenant. Transfer or demote ownership first.',
        blockingTenants 
      }, { status: 409 });
    }
  } catch { /* ignore */ }
  // Organization ownership guard (skip if purgeAll + superAdmin - we'll delete owned orgs instead)
  try {
    if (tenantId) {
      const orgRoles = await getUserOrganizationRoles(userId, tenantId) || [];
      const ownerRoles = orgRoles.filter(r => r.role === 'owner');
      if (ownerRoles.length > 0) {
        if (purgeAll && superAdmin) {
          // Purge mode: delete owned organizations (cascade deletes UserOrganizationRole records)
          log.info('Purging owned organizations for user', { userId, tenantId, count: ownerRoles.length });
          for (const r of ownerRoles) {
            try {
              await OrganizationActions.deleteOrganization(r.organizationId, tenantId);
            } catch (e) {
              log.warn('Failed to delete owned organization during user purge', { userId, orgId: r.organizationId, error: e });
            }
          }
        } else {
          const blockingOrgs = [];
          for (const r of ownerRoles) {
            const o = await OrganizationActions.getOrganizationById(r.organizationId, tenantId);
            if (o) blockingOrgs.push({ id: o._id, name: o.name });
          }
          return NextResponse.json({ 
            error: 'Cannot delete user: they are an OWNER of an organization. Transfer or demote ownership first.',
            blockingOrgs 
          }, { status: 409 });
        }
      }
    } else if (superAdmin) {
      const allTenantRoles = await getUserTenantRoles(userId) || [];
      const tenantIds = Array.from(new Set(allTenantRoles.map((r:any) => r.tenantId).filter(Boolean)));
      const allOwnedOrgs: Array<{orgId: string; tId: string}> = [];
      for (const tId of tenantIds) {
        try {
          const orgRoles = await getUserOrganizationRoles(userId, tId) || [];
          const ownerRoles = orgRoles.filter(r => r.role === 'owner');
          for (const r of ownerRoles) {
            allOwnedOrgs.push({ orgId: r.organizationId, tId });
          }
        } catch { /* ignore */ }
      }
      if (allOwnedOrgs.length > 0) {
        if (purgeAll) {
          // Purge mode: delete all owned organizations across tenants
          log.info('Purging all owned organizations for user', { userId, count: allOwnedOrgs.length });
          for (const { orgId, tId } of allOwnedOrgs) {
            try {
              await OrganizationActions.deleteOrganization(orgId, tId);
            } catch (e) {
              log.warn('Failed to delete owned organization during user purge', { userId, orgId, tenantId: tId, error: e });
            }
          }
        } else {
          const allBlockingOrgs = [];
          for (const { orgId, tId } of allOwnedOrgs) {
            const o = await OrganizationActions.getOrganizationById(orgId, tId);
            if (o) allBlockingOrgs.push({ id: o._id, name: o.name });
          }
          return NextResponse.json({ 
            error: 'Cannot delete user: they are an OWNER of an organization. Transfer or demote ownership first.',
            blockingOrgs: allBlockingOrgs
          }, { status: 409 });
        }
      }
    }
  } catch { /* ignore */ }

  try {
    // Delete any active tenant/org roles first (if not owners as guarded above)
    try {
      const prism = await Prism.getInstance();

      // Fetch user email for fallback profile deletion
      let userEmail: string | undefined;
      try {
        const user = await UserActions.getUserById(userId);
        userEmail = user?.email;
      } catch { /* ignore */ }

      const deleteRoles = async (ct: string) => {
        const q: PrismContentQuery = { contentType: ct, tenantId: 'any', where: { parent_id: userId }, orderBy: { createdAt: 'asc' } };
        const res = await prism.query(q);
        for (const item of res.items || []) {
            await prism.delete(ct, item._id, 'any');
        }
      };
      await deleteRoles(BlockType_UserTenantRole);
      await deleteRoles(BlockType_UserOrganizationRole);

      // Also delete the associated UserProfile
      let profileIdToDelete: string | undefined;
      const upQuery: PrismContentQuery = { 
          contentType: BlockType_UserProfile, 
          tenantId: 'any', 
          where: { indexer: { path: 'userId', equals: userId } }, 
          limit: 1 
      };
      const upRes = await prism.query(upQuery);
      if (upRes.items && upRes.items.length > 0) {
          profileIdToDelete = upRes.items[0]._id;
      } else if (userEmail) {
          // Fallback: Try finding by email (for legacy/zombie profiles)
          const upQueryEmail: PrismContentQuery = { 
              contentType: BlockType_UserProfile, 
              tenantId: 'any', 
              where: { indexer: { path: 'email', equals: userEmail } }, 
              limit: 1 
          };
          const upResEmail = await prism.query(upQueryEmail);
          if (upResEmail.items && upResEmail.items.length > 0) {
              profileIdToDelete = upResEmail.items[0]._id;
          }
      }

      if (profileIdToDelete) {
          await prism.delete(BlockType_UserProfile, profileIdToDelete, 'any');
      }
    } catch { /* ignore role/profile cleanup */ }

    const result = await UserActions.deleteUser(userId);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Delete failed' }, { status: result.statusCode || 400 });
    }
    if (purgeAll) {
      try {
        const prism = await Prism.getInstance();
        const types = [
          BlockType_Account,
            BlockType_Tool,
            BlockType_Assistant,
            BlockType_AssistantTheme,
            BlockType_AssistantFeedback,
            BlockType_DynamicContent,
            BlockType_UserTenantRole,
            BlockType_UserOrganizationRole,
            'Notes', // User-owned notes (personal and work)
            'HtmlGeneration', // User-owned HTML applets from Studio
        ];
        for (const ct of types) {
          try {
            const q: PrismContentQuery = { contentType: ct, tenantId: 'any', where: { parent_id: userId }, orderBy: { createdAt: 'asc' } };
            const res = await prism.query(q);
            for (const item of res.items || []) {
              try { await prism.delete(ct, item._id, 'any'); } catch { /* ignore individual */ }
            }
          } catch { /* ignore ct errors */ }
        }
      } catch { /* ignore purge errors */ }
    }
    // Audit log entry (best-effort; non-blocking)
    try {
      const prism = await Prism.getInstance();
      const actorId = session.user.id;
      const actorQuery: any = { contentType: BlockType_User, tenantId: 'any', where: { page_id: actorId }, orderBy: { createdAt: 'desc' } };
      const actorRes = await prism.query(actorQuery);
      const actorItem = (actorRes.items || [])[0];
      if (actorItem) {
        const metadata = actorItem.metadata || {};
        const history = Array.isArray(metadata.eventHistory) ? metadata.eventHistory : [];
        const event = { type: 'user.delete', target: userId, purged: purgeAll, ts: new Date().toISOString() };
        const nextHistory = [...history.slice(-99), event];
        // Use atomic merge - only update metadata field
        await prism.update(BlockType_User, actorItem._id, { metadata: { ...metadata, eventHistory: nextHistory } }, 'any');
      }
    } catch { /* ignore audit errors */ }
    return NextResponse.json({ success: true, purged: purgeAll });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Delete failed' }, { status: 400 });
  }
}

/**
 * GET /api/users/[userId]?tenantId=... – returns single user (array form for backward compat)
 * Mirrors prior app-level implementation but centralized in core so app routes can be thin veneers.
 */
export async function GET_impl(req: NextRequest, { params }: { params: { userId: string } }, authOptions: NextAuthOptions): Promise<NextResponse> {
  log.info('Users/[userId] GET_impl called', { path: req.nextUrl.pathname, search: req.nextUrl.search });
  const tenantId = req.nextUrl.searchParams.get('tenantId') as string;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 });
  }
  // Access check: tenant access (read) not necessarily admin
  const accessError = await requireTenantAccess(tenantId, req, authOptions);
  if (accessError) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }
  const session = await getSessionSafely(req, authOptions);
  if (!session || !session.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = params.userId || req.nextUrl.pathname.split('/').pop();
  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }
  try {
    const foundUser = await UserActions.getUserById(userId);
    if (!foundUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const { password_hash, ...user } = foundUser as any;
    return NextResponse.json({ users: [user] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to fetch user' }, { status: 500 });
  }
}
