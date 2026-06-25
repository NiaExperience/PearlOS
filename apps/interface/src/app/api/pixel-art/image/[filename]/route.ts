import { promises as fs } from 'fs';

import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { resolveSafePixelArtPath } from '@interface/lib/pixel-art-storage';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> | { filename: string } },
) {
  const params = await context.params;
  const session = await getSessionSafely(request, interfaceAuthOptions);
  const userId = session?.user?.id || 'anonymous';
  const resolved = resolveSafePixelArtPath(params.filename, userId);

  if (!resolved) {
    return NextResponse.json({ error: 'invalid filename' }, { status: 400 });
  }

  try {
    const data = await fs.readFile(resolved);
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
}
