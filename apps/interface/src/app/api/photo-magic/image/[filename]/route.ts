/**
 * GET /api/photo-magic/image/:filename
 *
 * Serves a PNG that was persisted to the current user's PhotoMagic folder by one of the
 * generate / edit / edit-multi / inpaint routes.  This handler avoids any
 * dependency on the bot_gateway being up (the legacy /bot-api/photo-magic/result
 * endpoint went through ComfyUI).
 */

import { promises as fs } from 'fs';
import path from 'path';

import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { resolveSafeOutputPath } from '@interface/lib/photo-magic-storage';

export const runtime = 'nodejs';

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ filename: string }> | { filename: string } },
) {
  const params = await context.params;
  const filename = params.filename;
  if (!filename) {
    return NextResponse.json({ detail: 'filename required' }, { status: 400 });
  }

  const session = await getSessionSafely(request, interfaceAuthOptions);
  const userId = session?.user?.id || 'anonymous';
  const resolved = resolveSafeOutputPath(filename, userId);
  if (!resolved) {
    return NextResponse.json({ detail: 'invalid filename' }, { status: 400 });
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch {
    return NextResponse.json({ detail: 'Image not found' }, { status: 404 });
  }
}
