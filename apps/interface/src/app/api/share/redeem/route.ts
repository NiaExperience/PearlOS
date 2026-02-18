export const dynamic = "force-dynamic";

import { getAllAssistants } from '@nia/prism/core/actions/assistant-actions';
import { 
  getUserOrganizationRoles,
  createOrganization,
  assignUserToOrganization
} from '@nia/prism/core/actions/organization-actions';
import { getResourceSharingOrganization } from '@nia/prism/core/actions/organization-actions';
import { 
  validateResourceShareToken, 
  redeemResourceShareToken 
} from '@nia/prism/core/actions/resourceShareToken-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { ResourceShareRole } from '@nia/prism/core/blocks/resourceShareToken.block';
import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import { 
  OrganizationRole
} from '@nia/prism/core/blocks/userOrganizationRole.block';
import { TokenEncryption } from '@nia/prism/core/utils/encryption';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_share_redeem]');

function mapOrgRole(role: ResourceShareRole): OrganizationRole {
  switch (role) {
    case ResourceShareRole.MEMBER:
      return OrganizationRole.MEMBER;
    case ResourceShareRole.VIEWER:
    default:
      return OrganizationRole.VIEWER;
  }
}

async function findOrCreateSharingOrg(
  resourceId: string,
  resourceType: ResourceType,
  tenantId: string,
  createdBy: string,
): Promise<IOrganization> {
  let sharingOrg = await getResourceSharingOrganization(resourceId, tenantId);

  if (sharingOrg) {
    log.info('Found existing sharing organization', { orgId: sharingOrg._id, resourceId, tenantId });
    return sharingOrg;
  }

  log.info('Sharing organization not found; creating new one', { resourceId, resourceType, tenantId });
  const organizationData: IOrganization = {
    tenantId,
    name: `Share:${resourceType}:${resourceId}`,
    description: `Sharing organization for ${resourceType} (created via token redemption)`,
    settings: {
      resourceSharing: true,
      resourceOwnerUserId: createdBy,
    },
    sharedResources: {
      [resourceId]: resourceType,
    },
  };

  sharingOrg = await createOrganization(organizationData);

  // Assign creator as OWNER
  await assignUserToOrganization(createdBy, sharingOrg._id!, tenantId, OrganizationRole.OWNER);
  return sharingOrg;
}

async function ensureUserOrgMembership(
  userId: string,
  tenantId: string,
  sharingOrgId: string,
  orgRole: OrganizationRole,
): Promise<void> {
  const userRoles = await getUserOrganizationRoles(userId, tenantId);
  const existingRole = userRoles?.find(r => r.organizationId === sharingOrgId);

  if (!existingRole) {
    log.info('Assigning user to organization', { orgId: sharingOrgId, orgRole, tenantId, userId });
    await assignUserToOrganization(userId, sharingOrgId, tenantId, orgRole);
    return;
  }

  const shouldUpgrade = existingRole.role === OrganizationRole.VIEWER && orgRole === OrganizationRole.MEMBER;
  if (shouldUpgrade) {
    log.info('Upgrading user role in organization', { orgId: sharingOrgId, orgRole });
    await assignUserToOrganization(userId, sharingOrgId, tenantId, orgRole);
  } else {
    log.info('User already has role in organization; no upgrade needed', { orgId: sharingOrgId, role: existingRole.role });
  }
}

async function redeemShareToken(
  req: NextRequest,
  userId: string,
): Promise<NextResponse> {
  const body = await req.json();
  const { token } = body;

  if (!token) {
    return NextResponse.json({ error: 'Token is required' }, { status: 400 });
  }

  const decryptedToken = TokenEncryption.decryptToken(token);
  const validation = await validateResourceShareToken(decryptedToken);
  if (!validation.valid || !validation.token) {
    return NextResponse.json({ error: validation.error || 'Invalid token' }, { status: 400 });
  }

  const shareToken = validation.token;
  const { resourceId, resourceType, role, createdBy, tenantId, assistantName } = shareToken;

  if (resourceType === ResourceType.DailyCallRoom) {
    await redeemResourceShareToken(decryptedToken, userId);
    log.info('DailyCall share token redeemed', { userId, resourceId, tenantId });
    return NextResponse.json({
      success: true,
      resourceId,
      resourceType,
      assistantName,
      targetMode: shareToken.targetMode,
    });
  }

  const sharingOrg = await findOrCreateSharingOrg(resourceId, resourceType, tenantId, createdBy);
  const orgRole = mapOrgRole(role as ResourceShareRole);
  await ensureUserOrgMembership(userId, tenantId, sharingOrg._id!, orgRole);
  await redeemResourceShareToken(decryptedToken, userId);
  log.info('Token redeemed for user', { userId, resourceId, tenantId });

  return NextResponse.json({
    success: true,
    resourceId,
    resourceType,
    organizationId: sharingOrg._id,
    assistantName,
    targetMode: shareToken.targetMode,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return await redeemShareToken(req, session.user.id);

  } catch (error) {
    log.error('Error redeeming token', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to redeem token' },
      { status: 500 }
    );
  }
}
