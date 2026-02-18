/**
 * Client-side actions for resource sharing
 * These functions call API routes which handle server-side Prism actions
 * 
 * ⚠️ IMPORTANT: These are CLIENT-ONLY actions that use fetch() to call HTTP endpoints.
 * Server-side code (route handlers, server actions) should import from:
 * @nia/prism/core/actions/organization-actions instead of calling these functions.
 * 
 * Architecture:
 * - Client code (React components) → this file → /api/sharing
 * - Server code (route handlers) → @nia/prism/core/actions/organization-actions → Prism data layer
 */

import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import type { IUser } from '@nia/prism/core/blocks/user.block';
import type { IUserOrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import type { IUserTenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

/**
 * Create or find existing sharing organization for a resource.
 * This will reuse an existing organization if one already exists for this resource.
 * Calls POST /api/sharing
 */
export async function createSharingOrganization(
  resourceId: string,
  contentType: 'Notes' | 'HtmlGeneration',
  resourceTitle: string,
  tenantId: string,
  _userId: string
): Promise<IOrganization> {
  const response = await fetch('/api/sharing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resourceId,
      contentType,
      resourceTitle,
      tenantId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create sharing organization');
  }

  const data = await response.json();
  return data.organization;
}

/**
 * Check if a resource already has a sharing organization.
 * Useful for pre-populating the sharing modal.
 * Calls GET /api/sharing?userId=...&tenantId=...&resourceId=...
 */
export async function getResourceSharingOrganization(
  resourceId: string,
  userId: string,
  tenantId: string
): Promise<IOrganization | null> {
  const params = new URLSearchParams({ userId, tenantId, resourceId });
  const response = await fetch(`/api/sharing?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to check sharing status');
  }

  const data = await response.json();
  return data.organization || null;
}

/**
 * Get all shared resources accessible to a user.
 * Calls GET /api/sharing?userId=...&tenantId=...&contentType=...
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
  memberCount: number;
}>> {
  const params = new URLSearchParams({ userId, tenantId });
  if (contentType) {
    params.set('contentType', contentType);
  }

  const response = await fetch(`/api/sharing?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch shared resources');
  }

  const data = await response.json();
  return data.data || [];
}

/**
 * Get members of a sharing organization with user details.
 * Calls GET /api/sharing?userId=...&tenantId=...&organizationId=...
 */
export async function getOrganizationMembers(
  organizationId: string,
  userId: string,
  tenantId: string
): Promise<Array<{
  userId: string;
  email: string;
  name: string;
  role: OrganizationRole;
  displayRole: string;
}>> {
  const params = new URLSearchParams({ 
    organizationId, 
    userId, 
    tenantId 
  });

  const response = await fetch(`/api/sharing?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch organization members');
  }

  const data = await response.json();
  return data.members || [];
}

/**
 * Share a resource with a user by email.
 * Creates user if they don't exist, assigns tenant and organization roles.
 * Calls POST /api/sharing with shareWithEmail parameter
 */
export async function shareResourceWithUser(
  resourceId: string,
  contentType: 'Notes' | 'HtmlGeneration',
  email: string,
  role: 'read-only' | 'read-write',
  tenantId: string,
  _ownerId: string
): Promise<{ user: IUser; tenantRole: IUserTenantRole; orgRole: IUserOrganizationRole }> {
  const response = await fetch('/api/sharing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resourceId,
      contentType,
      resourceTitle: resourceId, // Fallback title
      tenantId,
      shareWithEmail: email,
      accessLevel: role,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to share resource');
  }

  const data = await response.json();
  
  if (!data.sharedUser) {
    throw new Error('Failed to share with user');
  }

  return {
    user: data.sharedUser.user,
    tenantRole: data.sharedUser.tenantRole,
    orgRole: data.sharedUser.orgRole,
  };
}

/**
 * Remove a user from a sharing organization.
 * Only the resource owner can remove users.
 * Calls DELETE /api/sharing
 */
export async function removeUserFromSharing(
  organizationId: string,
  userId: string,
  tenantId: string
): Promise<void> {
  const response = await fetch('/api/sharing', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      userId,
      tenantId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to remove user');
  }
}

/**
 * Update a user's role in a sharing organization.
 * Only the resource owner can change roles.
 * Calls PATCH /api/sharing
 */
export async function updateUserRole(
  organizationId: string,
  userId: string,
  tenantId: string,
  newRole: 'read-only' | 'read-write'
): Promise<void> {
  const response = await fetch('/api/sharing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      userId,
      tenantId,
      newRole,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update user role');
  }
}

/**
 * Update sharing organization settings (e.g. sharedToAllReadOnly).
 * Only the resource owner can update settings.
 * Calls PATCH /api/sharing
 */
export async function updateSharingOrganization(
  organizationId: string,
  tenantId: string,
  updates: { sharedToAllReadOnly?: boolean }
): Promise<void> {
  const response = await fetch('/api/sharing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      organizationId,
      tenantId,
      ...updates,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update organization settings');
  }
}
