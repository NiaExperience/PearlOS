export const dynamic = "force-dynamic";

import {
  createAppNotification,
} from '@nia/prism/core/actions/appNotification-actions';
import {
  assignUserToOrganization,
  createOrganization,
  deleteUserOrganizationRole,
  getOrganizationById,
  getOrganizationRoles,
  getUserOrganizationRoles,
  updateUserOrganizationRole,
  updateOrganization,
} from '@nia/prism/core/actions/organization-actions';
import { assignUserToTenant, getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { createUser, getUserByEmail, getUserById } from '@nia/prism/core/actions/user-actions';
import { dispatchWebhookEvent } from '@nia/prism/core/actions/webhook-actions';
import { requireAuth } from '@nia/prism/core/auth';
import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_sharing]');
const VALID_RESOURCE_TYPES = new Set<string>(Object.values(ResourceType));

function normalizeResourceType(value: string | null): ResourceType | null {
  if (!value) return null;
  return VALID_RESOURCE_TYPES.has(value) ? (value as ResourceType) : null;
}

function resourceLabel(resourceType: ResourceType): string {
  if (resourceType === ResourceType.Apps || resourceType === ResourceType.HtmlGeneration) return 'app';
  if (resourceType === ResourceType.Notes) return 'note';
  if (resourceType === ResourceType.Sprite) return 'sprite';
  return 'resource';
}

async function emitShareEvent(params: {
  event: 'share.created' | 'share.revoked' | 'share.role_updated';
  tenantId: string;
  actorUserId: string;
  recipientUserId?: string;
  resourceId: string;
  resourceType: ResourceType;
  resourceTitle: string;
  organizationId?: string;
  role?: string;
}) {
  const label = resourceLabel(params.resourceType);
  const titleByEvent = {
    'share.created': `Shared ${label}: ${params.resourceTitle}`,
    'share.revoked': `Access removed: ${params.resourceTitle}`,
    'share.role_updated': `Access updated: ${params.resourceTitle}`,
  };

  if (params.recipientUserId) {
    try {
      await createAppNotification({
        tenantId: params.tenantId,
        recipientUserId: params.recipientUserId,
        actorUserId: params.actorUserId,
        event: params.event,
        resourceId: params.resourceId,
        resourceType: params.resourceType,
        title: titleByEvent[params.event],
        body: `A ${label} sharing change is ready in Shared With Me.`,
        metadata: {
          organizationId: params.organizationId,
          role: params.role,
          resourceTitle: params.resourceTitle,
        },
      });
    } catch (error) {
      log.error('Failed to create share notification', { error, event: params.event, resourceId: params.resourceId });
    }
  }

  try {
    await dispatchWebhookEvent({
      event: params.event,
      tenantId: params.tenantId,
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      actorUserId: params.actorUserId,
      recipientUserId: params.recipientUserId,
      organizationId: params.organizationId,
      role: params.role,
      metadata: {
        resourceTitle: params.resourceTitle,
      },
    });
  } catch (error) {
    log.error('Failed to dispatch share webhook event', { error, event: params.event, resourceId: params.resourceId });
  }
}

/**
 * GET /api/sharing?userId=...&tenantId=...&contentType=optional&resourceId=optional&organizationId=optional
 * 
 * If organizationId is provided: Get members of that organization with user details
 * If resourceId is provided: Get the sharing organization for that specific resource (if it exists)
 * Otherwise: Get all shared resources accessible to a user
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const url = new URL(req.url);
  const requestedTenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant_id');
  const resourceId = url.searchParams.get('resourceId');
  const organizationId = url.searchParams.get('organizationId');
  const contentType = normalizeResourceType(url.searchParams.get('contentType'));

  if (!requestedTenantId) {
    return NextResponse.json(
      { error: 'tenantId query param required' },
      { status: 400 }
    );
  }
  const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
  if (!actorResult.ok) return actorResult.response;
  const { tenantId, userId } = actorResult.actor;

  try {
    // If organizationId is provided, get all members of that organization
    if (organizationId) {
      const roles = await getOrganizationRoles(organizationId, tenantId);
      const actorOrgRole = roles.find(role => role.userId === userId);
      if (!actorOrgRole) {
        return NextResponse.json({ error: 'organization_not_found' }, { status: 404 });
      }
      
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
      
      return NextResponse.json({ 
        success: true, 
        members 
      });
    }
    
    // If resourceId is provided, look for existing sharing organization for that resource
    if (resourceId) {
      const ownerRoles = await getUserOrganizationRoles(userId, tenantId);
      
      for (const ownerRole of ownerRoles || []) {
        if (ownerRole.role === OrganizationRole.OWNER) {
          const org = await getOrganizationById(ownerRole.organizationId, tenantId);
          
          // Check if this organization has the resource in sharedResources
          if (org?.sharedResources && org.sharedResources[resourceId]) {
            return NextResponse.json({ 
              success: true, 
              organization: org,
              exists: true 
            });
          }
        }
      }
      
      // No existing sharing org found for this resource
      return NextResponse.json({ 
        success: true, 
        organization: null,
        exists: false 
      });
    }

    // Otherwise, return all shared resources accessible to the user
    const userRoles = await getUserOrganizationRoles(userId, tenantId) || [];
    const sharedResources: Array<{
      resourceId: string;
      contentType: ResourceType;
      organization: IOrganization;
      role: OrganizationRole;
      memberCount: number;
    }> = [];

    for (const role of userRoles) {
      const org = await getOrganizationById(role.organizationId, tenantId);
      if (org && org.sharedResources) {
        // Get organization member count to determine if truly shared
        const orgRoles = await getOrganizationRoles(role.organizationId, tenantId);
        const memberCount = orgRoles.length;

        for (const [resourceId, resourceType] of Object.entries(org.sharedResources)) {
          // Apply content type filter if specified
          if (contentType && resourceType !== contentType) {
            continue;
          }

          sharedResources.push({
            resourceId,
            contentType: resourceType as ResourceType,
            organization: org,
            role: role.role,
            memberCount, // Include member count so client can determine if truly shared
          });
        }
      }
    }

    return NextResponse.json({ success: true, data: sharedResources });
  } catch (error) {
    log.error('Error fetching shared resources', { error, userId, tenantId, resourceId });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch shared resources' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sharing
 * Create or get sharing organization for a resource, and optionally share with a user
 * 
 * Body: {
 *   resourceId: string,
 *   contentType: 'Notes' | 'HtmlGeneration',
 *   resourceTitle: string,
 *   tenantId: string,
 *   shareWithEmail?: string,  // Optional: if provided, also share with this user
 *   accessLevel?: 'read-only' | 'read-write',  // Required if shareWithEmail provided
 *   sharedToAllReadOnly?: boolean // Optional: set global read-only access
 * }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { resourceId, resourceTitle, shareWithEmail, accessLevel, sharedToAllReadOnly } = body;
    const contentType = normalizeResourceType(body.contentType);
    const requestedTenantId = body.tenantId || body.tenant_id;

    if (!resourceId || !contentType || !resourceTitle || !requestedTenantId) {
      return NextResponse.json(
        { error: 'resourceId, contentType, resourceTitle, and tenantId required' },
        { status: 400 }
      );
    }
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userId: currentUserId } = actorResult.actor;

    if (shareWithEmail && !accessLevel) {
      return NextResponse.json(
        { error: 'accessLevel required when shareWithEmail is provided' },
        { status: 400 }
      );
    }

    // Try to find existing sharing organization by checking sharedResources
    // This prevents creating duplicate organizations for the same resource
    let sharingOrg: IOrganization | null = null;

    // Get all organizations where the current user has OWNER role
    const ownerRoles = await getUserOrganizationRoles(currentUserId, tenantId);
    
    for (const ownerRole of ownerRoles || []) {
      if (ownerRole.role === OrganizationRole.OWNER) {
        const org = await getOrganizationById(ownerRole.organizationId, tenantId);
        
        // Check if this organization already has the resource in sharedResources
        // This is the key deduplication check: same resourceId + contentType = reuse org
        if (org?.sharedResources && resourceId in org.sharedResources) {
          sharingOrg = org;
          log.info('Reusing existing sharing organization', { organizationId: org._id, resourceId });
          
          // Update sharedToAllReadOnly if provided and different
          if (typeof sharedToAllReadOnly === 'boolean' && sharingOrg.sharedToAllReadOnly !== sharedToAllReadOnly) {
             sharingOrg = await updateOrganization(sharingOrg._id!, tenantId, { sharedToAllReadOnly });
          }
          break;
        }
      }
    }

    // Create sharing organization if it doesn't exist
    if (!sharingOrg) {
      log.info('Creating new sharing organization', { resourceId, contentType });
      const organizationData: IOrganization = {
        tenantId,
        name: `Share:${contentType}:${resourceId}`,
        description: `Sharing organization for ${contentType}: ${resourceTitle}`,
        sharedToAllReadOnly: !!sharedToAllReadOnly,
        settings: {
          resourceSharing: true,
          resourceOwnerUserId: currentUserId,
        },
        sharedResources: {
          [resourceId]: contentType,
        },
      };

      sharingOrg = await createOrganization(organizationData);

      // Assign creator as OWNER
      await assignUserToOrganization(
        currentUserId,
        sharingOrg._id!,
        tenantId,
        OrganizationRole.OWNER
      );
    }

    // If shareWithEmail provided, also share with that user
    let sharedUser = null;
    if (shareWithEmail) {
      // Find or create user
      let user = await getUserByEmail(shareWithEmail);
      if (!user) {
        user = await createUser({
          email: shareWithEmail,
          name: shareWithEmail.split('@')[0],
        });
      }

      // Ensure user has tenant MEMBER role
      const tenantRoles = await getUserTenantRoles(user._id!);
      const activeTenantRole = tenantRoles.find(
        r => r.tenantId === tenantId
      );

      const tenantRole = activeTenantRole || await assignUserToTenant(user._id!, tenantId, TenantRole.MEMBER);

      // Assign user to organization with appropriate role
      // read-write / write → MEMBER (can edit the shared resource)
      // read-only / read → VIEWER (can only view the shared resource)
      const orgRole =
        (accessLevel === 'read-write' || accessLevel ==='write') ? OrganizationRole.MEMBER : OrganizationRole.VIEWER;
      const userOrgRole = await assignUserToOrganization(
        user._id!,
        sharingOrg._id!,
        tenantId,
        orgRole
      );

      sharedUser = {
        user,
        tenantRole,
        orgRole: userOrgRole,
      };

      await emitShareEvent({
        event: 'share.created',
        tenantId,
        actorUserId: currentUserId,
        recipientUserId: user._id!,
        resourceId,
        resourceType: contentType,
        resourceTitle,
        organizationId: sharingOrg._id,
        role: orgRole,
      });
    }

    return NextResponse.json({
      success: true,
      organization: sharingOrg,
      sharedUser,
    });
  } catch (error) {
    log.error('Error creating/updating sharing', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create sharing organization' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sharing
 * 
 * Remove a user from a sharing organization.
 * Required body: { organizationId, userId, tenantId }
 * 
 * Only the resource owner (organization OWNER) can remove users.
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { organizationId, userId } = body;
    const requestedTenantId = body.tenantId || body.tenant_id;

    if (!organizationId || !userId || !requestedTenantId) {
      return NextResponse.json(
        { error: 'organizationId, userId, and tenantId are required' },
        { status: 400 }
      );
    }
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userId: currentUserId } = actorResult.actor;

    // Verify current user is the organization owner
    const allRoles = await getOrganizationRoles(organizationId, tenantId);
    const currentUserRole = allRoles.find(r => r.userId === currentUserId);
    
    if (!currentUserRole || currentUserRole.role !== OrganizationRole.OWNER) {
      return NextResponse.json(
        { error: 'Only the resource owner can remove shared users' },
        { status: 403 }
      );
    }

    // Find the target user's role
    const targetUserRole = allRoles.find(r => r.userId === userId);
    
    if (!targetUserRole) {
      return NextResponse.json(
        { error: 'User not found in organization' },
        { status: 404 }
      );
    }

    // Cannot remove the owner themselves
    if (targetUserRole.role === OrganizationRole.OWNER) {
      return NextResponse.json(
        { error: 'Cannot remove the organization owner' },
        { status: 400 }
      );
    }

    // Delete the user's organization role
    await deleteUserOrganizationRole(targetUserRole._id!, tenantId);

    const organization = await getOrganizationById(organizationId, tenantId);
    const [resourceId, resourceType] = Object.entries(organization?.sharedResources || {})[0] || [];
    if (resourceId && resourceType) {
      await emitShareEvent({
        event: 'share.revoked',
        tenantId,
        actorUserId: currentUserId,
        recipientUserId: userId,
        resourceId,
        resourceType: resourceType as ResourceType,
        resourceTitle: organization?.description || resourceId,
        organizationId,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'User removed from organization',
    });
  } catch (error) {
    log.error('Error removing user from organization', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove user' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/sharing
 * 
 * Update a user's role in a sharing organization OR update organization settings.
 * 
 * Mode 1: Update User Role
 * Required body: { organizationId, userId, tenantId, newRole: 'read-only' | 'read-write' }
 * 
 * Mode 2: Update Organization Settings
 * Required body: { organizationId, tenantId, sharedToAllReadOnly: boolean }
 * 
 * Only the resource owner (organization OWNER) can perform these actions.
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { organizationId, userId, newRole, sharedToAllReadOnly } = body;
    const requestedTenantId = body.tenantId || body.tenant_id;

    if (!organizationId || !requestedTenantId) {
      return NextResponse.json(
        { error: 'organizationId and tenantId are required' },
        { status: 400 }
      );
    }
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userId: currentUserId } = actorResult.actor;

    // Verify current user is the organization owner
    const allRoles = await getOrganizationRoles(organizationId, tenantId);
    const currentUserRole = allRoles.find(r => r.userId === currentUserId);
    
    if (!currentUserRole || currentUserRole.role !== OrganizationRole.OWNER) {
      return NextResponse.json(
        { error: 'Only the resource owner can change settings' },
        { status: 403 }
      );
    }

    // Mode 2: Update Organization Settings
    if (typeof sharedToAllReadOnly === 'boolean') {
       await updateOrganization(organizationId, tenantId, { sharedToAllReadOnly });
       return NextResponse.json({ success: true, message: 'Organization settings updated' });
    }

    // Mode 1: Update User Role
    if (!userId || !newRole) {
      return NextResponse.json(
        { error: 'userId and newRole are required for role updates' },
        { status: 400 }
      );
    }

    if (!['read-only', 'read-write'].includes(newRole)) {
      return NextResponse.json(
        { error: 'newRole must be either "read-only" or "read-write"' },
        { status: 400 }
      );
    }

    // Find the target user's role
    const targetUserRole = allRoles.find(r => r.userId === userId);
    
    if (!targetUserRole) {
      return NextResponse.json(
        { error: 'User not found in organization' },
        { status: 404 }
      );
    }

    // Cannot change the owner's role
    if (targetUserRole.role === OrganizationRole.OWNER) {
      return NextResponse.json(
        { error: 'Cannot change the organization owner\'s role' },
        { status: 400 }
      );
    }

    // Map access level to organization role
    const organizationRole = newRole === 'read-write' 
      ? OrganizationRole.ADMIN 
      : OrganizationRole.VIEWER;

    // Update the user's organization role
    await updateUserOrganizationRole(targetUserRole._id!, tenantId, organizationRole);

    const organization = await getOrganizationById(organizationId, tenantId);
    const [resourceId, resourceType] = Object.entries(organization?.sharedResources || {})[0] || [];
    if (resourceId && resourceType) {
      await emitShareEvent({
        event: 'share.role_updated',
        tenantId,
        actorUserId: currentUserId,
        recipientUserId: userId,
        resourceId,
        resourceType: resourceType as ResourceType,
        resourceTitle: organization?.description || resourceId,
        organizationId,
        role: organizationRole,
      });
    }

    return NextResponse.json({
      success: true,
      message: 'User role updated successfully',
      newRole,
    });
  } catch (error) {
    log.error('Error updating sharing', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update sharing' },
      { status: 500 }
    );
  }
}
