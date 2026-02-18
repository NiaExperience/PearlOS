export const dynamic = "force-dynamic";

import { Prism } from '@nia/prism';
import { requireAuth } from '@nia/prism/core/auth';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { BlockType_ResourceShareToken, IResourceShareToken } from '@nia/prism/core/blocks/resourceShareToken.block';
import { TokenEncryption } from '@nia/prism/core/utils/encryption';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authError = await requireAuth(req, dashboardAuthOptions);
  if (authError) return authError as NextResponse;

  const session = await getSessionSafely(req, dashboardAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { tokenId } = body;

    if (!tokenId) {
      return NextResponse.json({ error: 'Token ID required' }, { status: 400 });
    }

    const prism = await Prism.getInstance();
    const result = await prism.query({
      contentType: BlockType_ResourceShareToken,
      tenantId: 'any',
      where: { page_id: { eq: tokenId } },
      limit: 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const token = result.items[0] as IResourceShareToken;

    if (!token) {
      return NextResponse.json({ error: 'Token not found' }, { status: 404 });
    }

    // Replicate the link generation logic from apps/interface/src/app/api/share/generate/route.ts
    const encryptedToken = TokenEncryption.encryptToken(token.token);
    const baseUrl = process.env.NEXT_PUBLIC_INTERFACE_BASE_URL || 'http://localhost:3000';
    
    const payload = {
      token: encryptedToken,
      resourceId: token.resourceId,
      contentType: token.resourceType,
      mode: token.targetMode,
      // assistantName is not stored on the token, but it's optional in the payload.
      // If we needed it, we'd have to look up the assistant context or store it on the token.
      // For now, we omit it as it's likely for branding/redirection which might be fine to default.
    };

    const payloadString = JSON.stringify(payload);
    const base64Payload = Buffer.from(payloadString).toString('base64url');
    const shareLink = `${baseUrl}/share/${base64Payload}`;

    return NextResponse.json({ success: true, link: shareLink });

  } catch (error) {
    console.error('Error generating link:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
