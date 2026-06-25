import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { listPixelArtAssets } from '@interface/lib/pixel-art-storage';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  const userId = session?.user?.id || 'anonymous';
  const assets = await listPixelArtAssets(userId);
  return NextResponse.json({ assets });
}
