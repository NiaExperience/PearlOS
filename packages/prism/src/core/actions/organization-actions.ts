/* eslint-disable @typescript-eslint/no-explicit-any */
// Note: Removed 'use server' directive for test environment compatibility.

import { Prism } from '../../prism';
import { IOrganization, BlockType_Organization } from '../blocks/organization.block';
import { IUserOrganizationRole, OrganizationRole, BlockType_UserOrganizationRole } from '../blocks/userOrganizationRole.block';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';

import { getUserById } from './user-actions';

export async function getUserOrganizationRoles(userId: string, tenantId: string): Promise<IUserOrganizationRole[] | null> {
  const prism = await Prism.getInstance();
  if (!userId) {
    throw new Error('User ID is required');
  }
  const query = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'asc' as const },
  };
  const result = await prism.query(query);
  return result.items as IUserOrganizationRole[];
}

export async function getOrganizationRoles(organizationId: string, tenantId: string): Promise<IUserOrganizationRole[]> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { indexer: { path: 'organizationId', equals: organizationId } },
    orderBy: { createdAt: 'asc' as const }
  };
  // TODO(pagination): Add cursor/limit when re-query workflow is available
  const result = await prism.query(query);
  return result.items as IUserOrganizationRole[];
}

export async function getOrganizationsForTenant(tenantId: string): Promise<IOrganization[]> {
  const prism = await Prism.getInstance();
  if (!tenantId) {
    throw new Error('Tenant ID is required');
  }
  const query: PrismContentQuery = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: { parent_id: tenantId },
    orderBy: { createdAt: 'asc' as const },
  };
  const result = await prism.query(query);
  return result.items as IOrganization[];
}

export async function createOrganization(organizationData: IOrganization): Promise<IOrganization> {
  const prism = await Prism.getInstance();
  const payload: IOrganization = {
    ...organizationData,
  };
  const created = await prism.create(BlockType_Organization, payload, organizationData.tenantId);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create organization');
  }
  return created.items[0] as unknown as IOrganization;
}

export async function assignUserToOrganization(userId: string, organizationId: string, tenantId: string, role: OrganizationRole): Promise<IUserOrganizationRole> {
  const prism = await Prism.getInstance();
  if (!userId || !organizationId || !role) {
    throw new Error('userId, organizationId, and role are required');
  }
  if (!isValidUUID(userId)) throw new Error('Invalid userId format');
  if (!isValidUUID(organizationId)) throw new Error('Invalid organizationId format');
  if (!isValidUUID(tenantId)) throw new Error('Invalid tenantId format');

  // Validate organization exists
  const orgQuery = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: { page_id: organizationId, parent_id: tenantId },
    orderBy: { createdAt: 'asc' as const },
  };
  const orgResult = await prism.query(orgQuery);
  if (!orgResult.items || orgResult.items.length === 0) {
    throw new Error(`Organization with ID ${organizationId}, parent ${tenantId} does not exist`);
  }

  // Uniqueness guard: if active role already exists, just return it
  const existingQuery: PrismContentQuery = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { parent_id: userId, indexer: { path: 'organizationId', equals: organizationId } },
    orderBy: { createdAt: 'asc' as const }
  };
  const existing = await prism.query(existingQuery);
  if (existing.items && existing.items.length > 0) {
    const found = existing.items[0] as IUserOrganizationRole;
    if (found.role === role) return found; // idempotent
    // Update only the role field - use atomic merge
    if (!found._id) throw new Error('Corrupt organization role record: missing _id');
    const updated = await prism.update(BlockType_UserOrganizationRole, found._id as string, { role }, tenantId);
    if (!updated || updated.total === 0) throw new Error('Failed to update existing organization role');
    return updated.items[0] as IUserOrganizationRole;
  }

  const userOrganizationRole: IUserOrganizationRole = { userId, organizationId, role };
  const created = await prism.create(BlockType_UserOrganizationRole, userOrganizationRole, tenantId);
  if (!created || created.total === 0 || created.items.length === 0) throw new Error('Failed to assign user to organization');
  return created.items[0] as unknown as IUserOrganizationRole;
}

export async function getOrganizationById(organizationId: string, tenantId?: string): Promise<IOrganization | null> {
  if (!organizationId || !isValidUUID(organizationId)) {
    return null;
  }
  const prism = await Prism.getInstance();
  const query = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: { page_id: organizationId },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IOrganization;
}

export async function getOrganizationsForUser(userId: string, tenantId: string): Promise<IOrganization[]> {
  const roles = await getUserOrganizationRoles(userId, tenantId);
  const organizations: IOrganization[] = [];
  const orgIds = new Set<string>();

  // 1. Add organizations where user has a role
  if (roles && roles.length > 0) {
    for (const role of roles) {
      const org = await getOrganizationById(role.organizationId, tenantId);
      if (org && org._id) {
        organizations.push(org);
        orgIds.add(org._id);
      }
    }
  }

  // 2. Add shared-to-all organizations
  const prism = await Prism.getInstance();
  const globalQuery: PrismContentQuery = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: {
      parent_id: tenantId,
      indexer: { path: 'sharedToAllReadOnly', equals: true },
    },
    orderBy: { createdAt: 'asc' as const },
  };
  
  const globalOrgsResult = await prism.query(globalQuery);
  const globalOrgs = (globalOrgsResult.items || []) as IOrganization[];

  for (const org of globalOrgs) {
    if (org._id && !orgIds.has(org._id)) {
      organizations.push(org);
      orgIds.add(org._id);
    }
  }

  return organizations;
}

export async function updateUserOrganizationRole(userOrganizationRoleId: string, tenantId: string, newRole: OrganizationRole): Promise<IUserOrganizationRole> {
  const prism = await Prism.getInstance();
  if (!userOrganizationRoleId || !newRole) {
    throw new Error('userOrganizationRoleId and newRole are required');
  }
  const query: any = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { page_id: userOrganizationRoleId },
    orderBy: { createdAt: 'asc' as const },
  };
  const result = await prism.query(query);
  if (!result || result.total === 0) {
    throw new Error(`User organization role with ID ${userOrganizationRoleId} does not exist`);
  }
  const existing = result.items[0] as IUserOrganizationRole & { organizationId: string };
  // Protection: cannot demote last OWNER
  if (existing.role === OrganizationRole.OWNER && newRole !== OrganizationRole.OWNER) {
    const all = await getOrganizationRoles(existing.organizationId, tenantId);
    const activeOwners = all.filter(r => r.role === OrganizationRole.OWNER);
    if (activeOwners.length === 1) throw new Error('Cannot demote last organization OWNER');
  }
  // Protection: prevent removing last ADMIN when no owners
  if ((existing.role === OrganizationRole.ADMIN || existing.role === OrganizationRole.OWNER) && ![OrganizationRole.ADMIN, OrganizationRole.OWNER].includes(newRole)) {
    const all = await getOrganizationRoles(existing.organizationId, tenantId);
    const activeOwners = all.filter(r => r.role === OrganizationRole.OWNER);
    const activeAdmins = all.filter(r => r.role === OrganizationRole.ADMIN);
    if (activeOwners.length === 0 && activeAdmins.length === 1 && existing.role === OrganizationRole.ADMIN) {
      throw new Error('Cannot remove last organization ADMIN when no OWNER exists');
    }
  }
  // Update only the role field - use atomic merge
  const updated = await prism.update(BlockType_UserOrganizationRole, userOrganizationRoleId, { role: newRole }, tenantId);
  if (!updated || updated.total === 0 || updated.items.length === 0) {
    throw new Error(`User organization role with ID ${userOrganizationRoleId} does not exist`);
  }
  return updated.items[0] as unknown as IUserOrganizationRole;
}

export async function deleteUserOrganizationRole(userOrganizationRoleId: string, tenantId: string): Promise<IUserOrganizationRole> {
  const prism = await Prism.getInstance();
  if (!userOrganizationRoleId) {
    throw new Error('userOrganizationRoleId is required');
  }
  const query: any = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { page_id: userOrganizationRoleId },
    orderBy: { createdAt: 'asc' as const },
  };
  const result = await prism.query(query);
  if (!result || result.total === 0) {
    throw new Error(`User organization role with ID ${userOrganizationRoleId} does not exist`);
  }
  const existing = result.items[0] as IUserOrganizationRole & { organizationId: string };
  if (existing.role === OrganizationRole.OWNER) {
    const all = await getOrganizationRoles(existing.organizationId, tenantId);
    const activeOwners = all.filter(r => r.role === OrganizationRole.OWNER);
    if (activeOwners.length === 1) throw new Error('Cannot delete last organization OWNER');
  }
  const deleted = await prism.delete(BlockType_UserOrganizationRole, userOrganizationRoleId, tenantId);
  if (!deleted) {
    throw new Error(`Failed to delete organization role with ID ${userOrganizationRoleId}`);
  }
  return existing as IUserOrganizationRole;
}

// Fetch a single organization role by page_id (used for auth/audit in routes)
export async function getUserOrganizationRoleById(userOrganizationRoleId: string): Promise<(IUserOrganizationRole & { organizationId: string }) | null> {
  if (!userOrganizationRoleId) return null;
  const prism = await Prism.getInstance();
  const query: any = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { page_id: userOrganizationRoleId },
    orderBy: { createdAt: 'asc' as const },
  };
  const result = await prism.query(query);
  if (!result || result.total === 0) return null;
  return result.items[0] as (IUserOrganizationRole & { organizationId: string });
}

export async function deleteOrganization(organizationId: string, tenantId: string): Promise<IOrganization> {
  if (!organizationId) throw new Error('organizationId required');
  const prism = await Prism.getInstance();
  const org = await getOrganizationById(organizationId, tenantId);
  if (!org) throw new Error('Organization not found');

  const deleted = await prism.delete(BlockType_Organization, organizationId, tenantId);
  if (!deleted) throw new Error('Failed to delete organization');

  // Cascade: delete all related user org roles
  const rolesQuery: PrismContentQuery = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { indexer: { path: 'organizationId', equals: organizationId } },
    orderBy: { createdAt: 'asc' as const }
  };
  const rolesResult = await prism.query(rolesQuery);
  if (rolesResult.items && rolesResult.items.length) {
    for (const r of rolesResult.items) {
      // Remove tenantId to allow deleting roles across different tenants
      await prism.delete(BlockType_UserOrganizationRole, r._id);
    }
  }
  return org;
}

export async function purgeUserOrganizationRolesForTenant(userId: string, tenantId: string) {
  if (!userId) return;
  const prism = await Prism.getInstance();
  const rolesQuery: PrismContentQuery = {
    contentType: BlockType_UserOrganizationRole,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'asc' as const }
  };
  const rolesResult = await prism.query(rolesQuery);
  for (const r of rolesResult.items || []) {
    await prism.delete(BlockType_UserOrganizationRole, r._id, tenantId);
  }
}

export async function updateOrganization(organizationId: string, tenantId: string, updates: Partial<IOrganization>): Promise<IOrganization> {
  const prism = await Prism.getInstance();
  // Verify organization exists and get its _id
  const existing = await getOrganizationById(organizationId, tenantId);
  if (!existing) throw new Error('Organization not found');
  if (!(existing as any)._id) throw new Error('Corrupt organization record: missing _id');
  
  // Use atomic merge - only send the fields being updated
  const updated = await prism.update(BlockType_Organization, (existing as any)._id as string, updates, tenantId);
  if (!updated || updated.total === 0) throw new Error('Failed to update organization');
  return updated.items[0] as IOrganization;
}

/**
 * Get all shared resources accessible to a user across all their organization memberships.
 * Returns resource IDs, content types, organization details, and user's role.
 */
export async function getUserSharedResources(
  userId: string,
  tenantId: string,
  contentType?: 'Notes' | 'HtmlGeneration'
): Promise<Array<{
  resourceId: string;
  contentType: 'Notes' | 'HtmlGeneration';
  organization: IOrganization;
  role: OrganizationRole;
}>> {
  const prism = await Prism.getInstance();
  const sharedResourcesMap = new Map<string, {
    resourceId: string;
    contentType: 'Notes' | 'HtmlGeneration';
    organization: IOrganization;
    role: OrganizationRole;
  }>();

  // 1. Get resources shared specifically with the user (via roles)
  const userRoles = await getUserOrganizationRoles(userId, tenantId) || [];
  
  for (const role of userRoles) {
    const org = await getOrganizationById(role.organizationId, tenantId);
    if (org && org.sharedResources) {
      for (const [resourceId, resourceType] of Object.entries(org.sharedResources)) {
        // Apply content type filter if specified
        if (contentType && resourceType !== contentType) {
          continue;
        }

        sharedResourcesMap.set(resourceId, {
          resourceId,
          contentType: resourceType as 'Notes' | 'HtmlGeneration',
          organization: org,
          role: role.role,
        });
      }
    }
  }

  // 2. Get resources shared to all (read-only)
  // We need to query organizations where sharedToAllReadOnly is true
  const globalQuery: PrismContentQuery = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: { indexer: { path: 'sharedToAllReadOnly', equals: true } },
    orderBy: { createdAt: 'asc' as const }
  };
  
  const globalOrgsResult = await prism.query(globalQuery);
  const globalOrgs = (globalOrgsResult.items || []) as IOrganization[];

  for (const org of globalOrgs) {
    if (org.sharedResources) {
      for (const [resourceId, resourceType] of Object.entries(org.sharedResources)) {
        if (contentType && resourceType !== contentType) continue;

        // Conflict resolution:
        // If resource is already in map (from explicit role), keep it.
        // Explicit roles (even VIEWER) take precedence as the "primary" access method.
        // If the user has NO role, we add it as VIEWER (read-only).
        
        if (!sharedResourcesMap.has(resourceId)) {
          sharedResourcesMap.set(resourceId, {
            resourceId,
            contentType: resourceType as 'Notes' | 'HtmlGeneration',
            organization: org,
            role: OrganizationRole.VIEWER, // Global share is always read-only
          });
        }
      }
    }
  }

  return Array.from(sharedResourcesMap.values());
}

/**
 * Get members of an organization with user details.
 * Returns enriched member list with userId, email, name, and role.
 */
export async function getOrganizationMembers(
  organizationId: string,
  tenantId: string
): Promise<Array<{
  userId: string;
  email: string;
  name: string;
  role: OrganizationRole;
}>> {
  const roles = await getOrganizationRoles(organizationId, tenantId) || [];

  // Fetch user details for each role
  const members = await Promise.all(
    roles.map(async (role) => {
      const user = await getUserById(role.userId);
      return {
        userId: role.userId,
        email: user?.email || 'unknown',
        name: user?.name || 'Unknown User',
        role: role.role,
      };
    })
  );

  return members;
}

export async function getResourceSharingOrganization(
  resourceId: string,
  tenantId?: string
): Promise<IOrganization | null> {
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_Organization,
    tenantId: 'any',
    where: {
      indexer: { path: 'sharedResources', contains: resourceId },
    },
    orderBy: { createdAt: 'asc' as const }
  };

  if (tenantId) {
    if (!query.where) {
      query.where = {};
    }
    query.where.parent_id = tenantId;
  }

  const result = await prism.query(query);
  if (result.items && result.items.length > 0) {
    return result.items[0] as IOrganization;
  }
  return null;
}