export const dynamic = "force-dynamic";

import { createResourceShareToken } from '@nia/prism/core/actions/resourceShareToken-actions';
import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { ResourceType, ResourceShareRole } from '@nia/prism/core/blocks/resourceShareToken.block';
import { TokenEncryption } from '@nia/prism/core/utils/encryption';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_share_generate]');
const DEFAULT_TTL_SECONDS = 86400; // 24h

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, interfaceAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { resourceId, contentType, role, ttl, mode, tenantId, assistantName } = body;
    const resolvedTtl = ttl || DEFAULT_TTL_SECONDS;

    if (!resourceId || !contentType || !role) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const token = await createResourceShareToken(
      assistantName,
      resourceId,
      contentType as ResourceType,
      role as ResourceShareRole,
      session.user.id,
      tenantId,
      resolvedTtl,
      undefined, // maxRedemptions
      mode // targetMode
    );

    const encryptedToken = TokenEncryption.encryptToken(token.token);
    const baseUrl = process.env.NEXTAUTH_INTERFACE_URL || 'http://localhost:3000';

    // Create a short link using LinkMap. For DailyCallRoom we omit the raw roomUrl
    // from the stored payload to avoid exposing it in the share payload; the
    // roomUrl remains inside the server-side token and is returned on redeem.
    const { createLinkMap } = await import('@interface/features/ResourceSharing/actions/linkmap-actions');
    const linkMap = await createLinkMap({
      json: buildLinkMapPayload(encryptedToken, contentType as ResourceType, assistantName, mode, resourceId),
      ttl: resolvedTtl,
    });

    const shareLink = `${baseUrl}/share/${linkMap.key}`;

    return NextResponse.json({ success: true, token: token.token, link: shareLink, expiresAt: token.expiresAt });

  } catch (error) {
    log.error('Error generating share token', { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate token' },
      { status: 500 }
    );
  }
}
