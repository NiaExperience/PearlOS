/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Removed 'use server' directive for test environment compatibility.

import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely, SUPERADMIN_USER_ID } from '@nia/prism/core/auth';
import { TenantPlanTier } from '@nia/prism/core/blocks/tenant.block';
import { NextAuthOptions } from 'next-auth';

import { Prism } from '../../prism';
import type { ITenant } from '../blocks/tenant.block';
import type { IUser } from '../blocks/user.block';
import type { IUserTenantRole } from '../blocks/userTenantRole.block';
import { TenantRole } from '../blocks/userTenantRole.block';
import { getLogger } from '../logger';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';

import { deleteOrganization } from './organization-actions';


const TenantBlockType = 'Tenant';
const UserTenantRoleBlockType = 'UserTenantRole';
const UserBlockType = 'User';
const OrganizationBlockType = 'Organization';
const log = getLogger('prism:actions:tenant');

export async function createTenant(tenantData: ITenant): Promise<ITenant> {
  if (!tenantData || !tenantData.name) {
    throw new Error('Tenant name is required');
  }
  // Guard: prevent duplicate tenants by name
  const existingByName = await getTenantByName(tenantData.name);
  if (existingByName) {
    // Standardized message so routes can translate to 409
    throw new Error('Tenant already exists');
  }
  const prism = await Prism.getInstance();
  const created = await prism.create(TenantBlockType, tenantData);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create tenant');
  }
  return created.items[0] as unknown as ITenant;
}

export async function findOrCreateTenantForAssistant(assistant: { name: string; tenantId?: string }, authOptions: NextAuthOptions): Promise<string> {
  if (!assistant.tenantId) {
      const session = await getSessionSafely(undefined, authOptions);
      if (!session || !session.user) {
        throw new Error('Unauthorized');
      }
      const user = await UserActions.getUserById(session.user.id);
      if (!user) {
        throw new Error('User not found');
      }

      // Look for an existing tenant by name
      const existingTenant = await getTenantByName(`Tenant ${assistant.name}`);
      if (existingTenant) {
        log.info('Found existing tenant for assistant', { assistantName: assistant.name, tenantId: existingTenant._id, tenantName: existingTenant.name });
        return existingTenant._id!;
      }

      // create a new tenant for this assistant
      const tenantData: ITenant = {
        name: `Tenant ${assistant.name}`,
        planTier: TenantPlanTier.PROFESSIONAL, // Default to PRO for assistants
      };
      const tenant = await createTenant(tenantData);
      assistant.tenantId = tenant._id!;
      log.info('Created new tenant for assistant', { assistantName: assistant.name, tenantId: tenant._id, tenantName: tenant.name });
      // Assign adminUser as OWNER of tenant, always
      await assignUserToTenant(SUPERADMIN_USER_ID, tenant._id!, TenantRole.OWNER);

      // Auto-assign session user as MEMBER of tenant
      await assignUserToTenant(user._id!, tenant._id!, TenantRole.MEMBER);
  }
  return assistant.tenantId;
}


export async function getTenantById(tenantId: string) {
  if (!tenantId || !isValidUUID(tenantId)) {
    return null;
  }
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: TenantBlockType,
    tenantId: 'any',
    where: { page_id: tenantId },
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  return result && result.total > 0 ? result.items[0] : null;
}

export async function getTenantByName(tenantName: string) {
  if (!tenantName) {
    return null;
  }
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: TenantBlockType,
    tenantId: 'any',
    where: { indexer: { path: "name", equals: tenantName } },
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  return result && result.total > 0 ? result.items[0] : null;
}

export async function getAllTenants() {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: TenantBlockType,
    tenantId: 'any',
    where: {},
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  return result.items;
}

export async function updateTenant(tenantId: string, updates: Partial<ITenant>): Promise<ITenant> {
  if (!tenantId) throw new Error('tenantId required');
  const existing = await getTenantById(tenantId);
  if (!existing) throw new Error('Tenant not found');
  if (!(existing as any)._id) throw new Error('Corrupt tenant record: missing _id');
  const prism = await Prism.getInstance();
  const merged = { ...existing, ...updates } as ITenant;
  const updated = await prism.update(TenantBlockType, (existing as any)._id as string, merged, tenantId);
  if (!updated || updated.total === 0 || updated.items.length === 0) throw new Error('Failed to update tenant');
  return updated.items[0] as unknown as ITenant;
}

// HARD DELETE: Irreversible removal of tenant and related role/organization blocks.
// Restricted to SUPERADMIN only (enforced at route level). Use cautiously.
export async function deleteTenant(tenantId: string): Promise<{ success: boolean }> {
  if (!tenantId) throw new Error('tenantId required');
  const existing = await getTenantById(tenantId);
  if (!existing) throw new Error('Tenant not found');
  if (!(existing as any)._id) throw new Error('Corrupt tenant record: missing _id');
  const prism = await Prism.getInstance();
  // Cascade: delete user tenant roles
  try {
    const rolesQuery: PrismContentQuery = {
      contentType: UserTenantRoleBlockType,
      tenantId: 'any',
      where: { indexer: { path: 'tenantId', equals: tenantId } },
      orderBy: { createdAt: 'asc' }
    };
    const rolesRes = await prism.query(rolesQuery);
    for (const r of rolesRes.items || []) {
      await prism.delete(UserTenantRoleBlockType, r._id, 'any');
    }
  } catch (e) {
    log.warn('Cascade delete tenant roles failed', { tenantId, error: e });
  }
  // Cascade: delete organizations (and rely on their own cascade if implemented)
  try {
    const orgQuery: PrismContentQuery = {
      contentType: OrganizationBlockType,
      tenantId: tenantId,
      where: { indexer: { path: 'tenantId', equals: tenantId } },
      orderBy: { createdAt: 'asc' }
    };
    const orgRes = await prism.query(orgQuery);
    for (const o of orgRes.items || []) {
      await prism.delete(OrganizationBlockType, o._id, tenantId);
    }
  } catch (e) {
    log.warn('Cascade delete organizations failed', { tenantId, error: e });
  }
  const deleted = await prism.delete(TenantBlockType, (existing as any)._id as string, 'any');
  if (!deleted) throw new Error('Failed to delete tenant');
  return { success: true };
}

export async function assignUserToTenant(
  userId: string,
  tenantId: string,
  role: TenantRole
): Promise<IUserTenantRole & { operation: string }> {
  if (!userId) {
    throw new Error('User ID is required');
  }
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  if (!role) {
    throw new Error('Role is required');
  }
  if (!Object.values(TenantRole).includes(role)) {
    throw new Error(`Invalid role provided`);
  }
  const prism = await Prism.getInstance();

  // Idempotent / upsert semantics:
  // 1. If an ACTIVE role already exists for (userId, tenantId):
  //    a. If same role -> return it as-is.
  //    b. If different role -> update in place and return updated record.
  // 2. If only INACTIVE records exist -> revive the most recent, set requested role, mark active.
  // 3. If no record exists -> create new active record.
  let operation: 'noop' | 'updated' | 'revived' | 'created' = 'created';
  try {
    const existingQuery: PrismContentQuery = {
      contentType: UserTenantRoleBlockType,
      tenantId: 'any',
      where: { parent_id: userId, indexer: { path: 'tenantId', equals: tenantId } },
      orderBy: { createdAt: 'desc' }
    };
    const existingRes = await prism.query(existingQuery);
    const existingRole = (existingRes.total > 0 ? existingRes.items[0] : null) as IUserTenantRole | null;
    if (existingRole) {
      if (existingRole.role === role) {
        operation = 'noop';
        return { ...(existingRole as IUserTenantRole), operation } as IUserTenantRole & { operation: string }; // Idempotent: same role
      }
      // Role change in place
      const updated = await prism.update(
        UserTenantRoleBlockType,
        existingRole._id!,
        { ...existingRole, role },
        tenantId
      );
      if (!updated || updated.total === 0 || updated.items.length === 0) {
        throw new Error('Failed to update existing user tenant role');
      }
      operation = 'updated';
      return { ...(updated.items[0] as unknown as IUserTenantRole), operation } as IUserTenantRole & { operation: string };
    }
  } catch (e) {
    log.warn('assignUserToTenant duplicate / revive logic failed, falling back to create', { userId, tenantId, role, error: e });
  }

  // Create new role record
  const userTenantRole: IUserTenantRole = {
    userId,
    tenantId,
    role,
  };
  const created = await prism.create(UserTenantRoleBlockType, userTenantRole);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to assign user to tenant');
  }
  operation = 'created';
  return { ...(created.items[0] as unknown as IUserTenantRole), operation } as IUserTenantRole & { operation: string };
}

export async function getUserTenantRoles(userId: string): Promise<IUserTenantRole[]> {
  if (!userId) {
    throw new Error('User ID is required');
  }
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: UserTenantRoleBlockType,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  return result.items;
}

export async function getTenantRolesForTenant(tenantId: string): Promise<IUserTenantRole[]> {
  if (!tenantId) throw new Error('Tenant ID is required');
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: UserTenantRoleBlockType,
    tenantId: 'any',
    where: { indexer: { path: 'tenantId', equals: tenantId } },
    orderBy: { createdAt: 'desc' }
  };
  // TODO(pagination): Add cursor/limit once prism/mesh supports re-query workflow
  const result = await prism.query(query);
  return result.items as IUserTenantRole[];
}

export async function getTenantsForUser(userId: string) : Promise<ITenant[]> {
  try {
    const roles = await getUserTenantRoles(userId);
    // Only consider active roles
    if (roles.length === 0) return [];

    // A user can (incorrectly or historically) have multiple active roles pointing to the same tenant
    // (e.g. both OWNER and ADMIN). We should only return each tenant once in the list UI.
    const uniqueTenantIds = Array.from(new Set(roles.map((r: any) => r.tenantId).filter(Boolean)));
    if (uniqueTenantIds.length === 0) return [];

    const prism = await Prism.getInstance();
    // Batch query all tenants instead of N round‑trips. The prism query API supports an 'in' operator (see getUsersForTenant).
    const batchQuery: PrismContentQuery = {
      contentType: TenantBlockType,
      tenantId: 'any',
      where: { page_id: { in: uniqueTenantIds } },
      orderBy: { createdAt: 'desc' }
    };
    const result = await prism.query(batchQuery);
    const tenants = (result.items || []) as ITenant[];

    // Ensure stable ordering: sort by createdAt desc if present, else name.
    tenants.sort((a: any, b: any) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aTime !== bTime) return bTime - aTime;
      return (a.name || '').localeCompare(b.name || '');
    });
    return tenants;
  } catch (error) {
    log.error('Error fetching tenants for user', { userId, error });
    return [];
  }
}

const roleIsAtLeast = (targetRole: TenantRole, requiredMinimum: TenantRole) => {
  switch (targetRole) {
    case TenantRole.OWNER:
      return true;
    case TenantRole.ADMIN:
      return requiredMinimum !== TenantRole.OWNER;
    default:
      return requiredMinimum === TenantRole.MEMBER;
  }
};

export async function userHasAccess(userId: string, tenantId: string, minimumRole: TenantRole = TenantRole.MEMBER): Promise<boolean> {
  if (!userId) {
    log.warn('User ID is required for tenant access check', { tenantId, minimumRole });
    return false;
  }
  if (!isValidUUID(userId)) {
    log.warn('Invalid User ID format', { userId });
    return false;
  }
  if (!tenantId) {
    log.warn('Tenant ID is required for tenant access check', { userId, minimumRole });
    return false;
  }
  if (!isValidUUID(tenantId)) {
    log.warn('Invalid Tenant ID format', { tenantId });
    return false;
  }
  const prism = await Prism.getInstance();
  // validate user exists:
  const userQuery: PrismContentQuery = {
    contentType: UserBlockType,
    tenantId: 'any',
    where: { page_id: userId },
    orderBy: { createdAt: 'desc' }
  };
  const userResult = await prism.query(userQuery);
  if (!userResult.items.length) {
    throw new Error('User not found');
  }
  // validate tenant exists:
  const tenantQuery: PrismContentQuery = {
    contentType: TenantBlockType,
    tenantId: tenantId,
    where: { page_id: tenantId },
    orderBy: { createdAt: 'desc' }
  };
  const tenantResult = await prism.query(tenantQuery);
  if (!tenantResult.items.length) {
    throw new Error('Tenant not found');
  }
  const tenantRoles = await getUserTenantRoles(userId);
  const hasTenantAccess = tenantRoles ? tenantRoles.some(
    (role: any) => role.tenantId === tenantId && roleIsAtLeast(role.role, minimumRole)
  ) : false;
  return hasTenantAccess;
}

export async function updateUserTenantRole(
  userId: string,
  tenantId: string,
  role: TenantRole
) {
  const prism = await Prism.getInstance();
  // Find the role entry
  const query: PrismContentQuery = {
    contentType: UserTenantRoleBlockType,
    tenantId: 'any',
    where: { parent_id: userId, indexer: { path: "tenantId", equals: tenantId } },
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  if (!result.items.length) throw new Error('User is not assigned to this tenant');
  const existingRole = result.items[0];
  // Protection: cannot demote last OWNER
  if (existingRole.role === TenantRole.OWNER && role !== TenantRole.OWNER) {
    const allRoles = await getTenantRolesForTenant(tenantId) as any[];
    const activeOwners = allRoles.filter(r => r.role === TenantRole.OWNER);
    if (activeOwners.length === 1) {
      throw new Error('Cannot demote last tenant OWNER');
    }
  }
  // Protection: cannot remove last ADMIN when there are no owners
  if ((existingRole.role === TenantRole.ADMIN || existingRole.role === TenantRole.OWNER) && ![TenantRole.ADMIN, TenantRole.OWNER].includes(role)) {
    const allRoles = await getTenantRolesForTenant(tenantId) as any[];
    const activeOwners = allRoles.filter(r => r.role === TenantRole.OWNER);
    const activeAdmins = allRoles.filter(r => r.role === TenantRole.ADMIN);
    if (activeOwners.length === 0 && activeAdmins.length === 1 && existingRole.role === TenantRole.ADMIN) {
      throw new Error('Cannot remove last tenant ADMIN when no OWNER exists');
    }
  }
  const updated = await prism.update(UserTenantRoleBlockType, existingRole._id, { ...existingRole, role }, tenantId);
  if (!updated || updated.total === 0 || updated.items.length === 0) {
    throw new Error('Failed to update user tenant role');
  }
  return updated.items[0] as unknown as IUserTenantRole;
}

export async function deleteUserTenantRole(userId: string, tenantId: string) {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: UserTenantRoleBlockType,
    tenantId: 'any',
    where: { parent_id: userId, indexer: { path: "tenantId", equals: tenantId } },
    orderBy: { createdAt: 'desc' }
  };
  
  const result = await prism.query(query);
  if (!result.items.length) throw new Error('User is not assigned to this tenant');
  const existingRole = result.items[0];
  // Protection: cannot delete last OWNER
  if (existingRole.role === TenantRole.OWNER) {
    const allRoles = await getTenantRolesForTenant(tenantId) as any[];
    const activeOwners = allRoles.filter(r => r.role === TenantRole.OWNER);
    if (activeOwners.length === 1) {
      throw new Error('Cannot delete last tenant OWNER');
    }
  }
  // Protection: cannot delete last ADMIN when no owners
  if (existingRole.role === TenantRole.ADMIN) {
    const allRoles = await getTenantRolesForTenant(tenantId) as any[];
    const activeOwners = allRoles.filter(r => r.role === TenantRole.OWNER);
    const activeAdmins = allRoles.filter(r => r.role === TenantRole.ADMIN);
    if (activeOwners.length === 0 && activeAdmins.length === 1) {
      throw new Error('Cannot delete last tenant ADMIN when no OWNER exists');
    }
  }
  const deleted = await prism.delete(UserTenantRoleBlockType, existingRole._id, tenantId);
  if (!deleted) {
    throw new Error('Failed to delete user tenant role');
  }
  return existingRole as unknown as IUserTenantRole;
}

export async function getUsersForTenant(tenantId: string) : Promise<IUser[]> {
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: UserTenantRoleBlockType,
    tenantId: 'any',
    where: { indexer: { path: "tenantId", equals: tenantId } },
    orderBy: { createdAt: 'desc' }
  };
  const result = await prism.query(query);
  if (!result.items || result.total === 0) {
    return [];
  }
  const userIds = Array.from(new Set(result.items.map((role: any) => role.userId)));

  if (userIds.length > 0) {
    const userQuery: PrismContentQuery = {
      contentType: UserBlockType,
      tenantId: 'any',
      where: { page_id: { in: userIds }},
      orderBy: { createdAt: 'desc' }
    };
    const userResult = await prism.query(userQuery);
    if (userResult.items && userResult.total > 0) {
      return userResult.items as IUser[];
    }
  }
  return [];
}
