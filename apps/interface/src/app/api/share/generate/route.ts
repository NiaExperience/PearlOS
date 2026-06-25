export const dynamic = "force-dynamic";

import { createResourceShareToken } from '@nia/prism/core/actions/resourceShareToken-actions';
import { createAppNotification } from '@nia/prism/core/actions/appNotification-actions';
import { dispatchWebhookEvent } from '@nia/prism/core/actions/webhook-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { ResourceType, ResourceShareRole } from '@nia/prism/core/blocks/resourceShareToken.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { TokenEncryption } from '@nia/prism/core/utils/encryption';
import { NextRequest, NextResponse } from 'next/server';

import { findHtmlContentById } from '@interface/features/HtmlGeneration/actions/html-generation-actions';
import { findNoteById } from '@interface/features/Notes';
import { createLinkMap } from '@interface/features/ResourceSharing/actions/linkmap-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';
import { type InterfaceActorContext, resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const log = getLogger('[api_share_generate]');
const DEFAULT_TTL_SECONDS = 86400; // 24h

async function emitCreatedEvent(params: {
  tenantId: string;
  ownerUserId: string;
  resourceId: string;
  resourceType: ResourceType;
  role?: ResourceShareRole;
  link?: string;
  expiresAt?: Date | string;
}) {
  const expiresAt =
    params.expiresAt instanceof Date ? params.expiresAt.toISOString() : params.expiresAt;

  try {
    await createAppNotification({
      tenantId: params.tenantId,
      recipientUserId: params.ownerUserId,
      actorUserId: params.ownerUserId,
      event: 'share.created',
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      title: 'Share link created',
      body: 'A PearlOS share link is ready to use.',
      metadata: {
        role: params.role,
        link: params.link,
        expiresAt,
      },
    });
  } catch (error) {
    log.error('Failed to create share created notification', { error, resourceId: params.resourceId });
  }

  try {
    await dispatchWebhookEvent({
      event: 'share.created',
      tenantId: params.tenantId,
      resourceId: params.resourceId,
      resourceType: params.resourceType,
      actorUserId: params.ownerUserId,
      recipientUserId: params.ownerUserId,
      role: params.role,
      metadata: {
        link: params.link,
        expiresAt,
      },
    });
  } catch (error) {
    log.error('Failed to dispatch share created webhook', { error, resourceId: params.resourceId });
  }
}

function resolveShareBaseUrl(req: NextRequest): string {
  const configured =
    process.env.NEXT_PUBLIC_INTERFACE_URL ||
    process.env.NEXTAUTH_INTERFACE_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');

  const reqOrigin = req.nextUrl?.origin || '';
  if (reqOrigin) return reqOrigin.replace(/\/$/, '');

  if (process.env.NODE_ENV !== 'production') return 'http://localhost:3000';
  throw new Error('Missing interface base URL for share link generation');
}

function buildLinkMapPayload(
  encryptedToken: string,
  contentType: ResourceType,
  assistantName?: string,
  mode?: string,
  resourceId?: string,
) {
  const payload: Record<string, unknown> = {
    token: encryptedToken,
    contentType,
    assistantName,
    mode,
  };

  if (contentType !== ResourceType.DailyCallRoom && resourceId) {
    payload.resourceId = resourceId;
  }

  return payload;
}

function isTenantAdmin(actor: InterfaceActorContext): boolean {
  return actor.tenantRole === TenantRole.ADMIN || actor.tenantRole === TenantRole.OWNER;
}

function ownsResource(actor: InterfaceActorContext, ownerId?: unknown): boolean {
  return typeof ownerId === 'string' && ownerId.trim() === actor.userId;
}

async function canShareResource(
  actor: InterfaceActorContext,
  resourceId: string,
  contentType: ResourceType,
): Promise<boolean> {
  if (contentType === ResourceType.Notes) {
    const note = await findNoteById(resourceId, actor.tenantId).catch(() => null);
    if (!note || (note.tenantId && note.tenantId !== actor.tenantId)) return false;
    return ownsResource(actor, note.userId) || isTenantAdmin(actor);
  }

  if (contentType === ResourceType.HtmlGeneration || contentType === ResourceType.Apps) {
    const content = await findHtmlContentById(resourceId, actor.tenantId).catch(() => null);
    if (!content || (content.tenantId && content.tenantId !== actor.tenantId)) return false;
    return ownsResource(actor, content.createdBy) || isTenantAdmin(actor);
  }

  // DailyCallRoom and Sprite ownership live outside these Prism records.
  // Fail closed until their ownership checks are implemented.
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  try {
    const body = await req.json();
    const { resourceId, contentType, role, ttl, mode, tenantId: requestedTenantId, assistantName } = body;
    const resolvedTtl = ttl || DEFAULT_TTL_SECONDS;

    if (!resourceId || !contentType || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;
    const actor = actorResult.actor;
    const { tenantId, userId } = actor;

    const normalizedContentType = contentType as ResourceType;
    if (!Object.values(ResourceType).includes(normalizedContentType)) {
      return NextResponse.json({ error: 'Invalid contentType' }, { status: 400 });
    }
    const normalizedRole = role as ResourceShareRole;
    if (!Object.values(ResourceShareRole).includes(normalizedRole)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    const shareAllowed = await canShareResource(actor, resourceId, normalizedContentType);
    if (!shareAllowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const token = await createResourceShareToken(
      assistantName,
      resourceId,
      normalizedContentType,
      normalizedRole,
      userId,
      tenantId,
      resolvedTtl,
      undefined, // maxRedemptions
      mode // targetMode
    );

    const encryptedToken = TokenEncryption.encryptToken(token.token);
    const baseUrl = resolveShareBaseUrl(req);

    // Create a short link using LinkMap. For DailyCallRoom we omit the raw roomUrl
    // from the stored payload to avoid exposing it in the share payload; the
    // roomUrl remains inside the server-side token and is returned on redeem.
    const linkMap = await createLinkMap({
      json: buildLinkMapPayload(encryptedToken, contentType as ResourceType, assistantName, mode, resourceId),
      ttl: resolvedTtl,
    });

    const shareLink = `${baseUrl}/share/${linkMap.key}`;

    await emitCreatedEvent({
      tenantId: token.tenantId,
      ownerUserId: userId,
      resourceId,
      resourceType: normalizedContentType,
      role: normalizedRole,
      link: shareLink,
      expiresAt: token.expiresAt,
    });

    return NextResponse.json({ success: true, token: token.token, link: shareLink, expiresAt: token.expiresAt });

  } catch (error) {
    log.error('Error generating share token', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate token' },
      { status: 500 }
    );
  }
}
