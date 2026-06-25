/**
 * GET /api/photo-magic/gallery
 *
 * Lists PhotoMagic images for the authenticated user only.
 */

import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { listPhotoMagicImages } from '@interface/lib/photo-magic-storage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  const userId = session?.user?.id || 'anonymous';
  const items = await listPhotoMagicImages(userId);

  return NextResponse.json({
    items,
    total: items.length,
  });
}
