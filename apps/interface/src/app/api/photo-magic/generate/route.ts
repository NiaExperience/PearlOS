/**
 * POST /api/photo-magic/generate
 *
 * Text-to-image generation for Photo Magic. Replaces the old ComfyUI-backed
 * route at /bot-api/photo-magic/generate. Calls OpenRouter with the
 * PHOTO_MAGIC_MODEL_RANKING fallback chain (Nano Banana 2 -> Pro -> GPT Image 2),
 * persists the resulting PNG to the authenticated user's PhotoMagic folder,
 * and returns a same-origin URL.
 *
 * Request body: { prompt: string }
 * Response:     { imageUrl, image_url, filename, image_path, model }
 */

import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import {
  completeImageGenerationTask,
  failImageGenerationTask,
  startImageGenerationTask,
  type ImageGenerationTaskHandle,
} from '@interface/lib/image-generation-tasks';
import { getLogger } from '@interface/lib/logger';
import { generateImageViaOpenRouter } from '@interface/lib/openrouter-image';
import { persistPhotoMagicPng } from '@interface/lib/photo-magic-storage';

const log = getLogger('[api_photo_magic_generate]');

// File writes need Node, not edge.
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ detail: 'Body must be JSON' }, { status: 400 });
  }

  const prompt = typeof (body as { prompt?: unknown })?.prompt === 'string'
    ? ((body as { prompt: string }).prompt).trim()
    : '';
  if (!prompt) {
    return NextResponse.json({ detail: 'Prompt is required' }, { status: 400 });
  }

  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    imageTask = await startImageGenerationTask(request, {
      title: 'Generate image - Photo Magic',
      task: [
        'Generate a Photo Magic image from this prompt.',
        '',
        prompt,
      ].join('\n'),
      requestedTenantId: (body as { tenantId?: unknown; tenant_id?: unknown })?.tenantId
        ?? (body as { tenant_id?: unknown })?.tenant_id,
      note: 'Photo Magic text-to-image generation started.',
    });
    if (!process.env.OPENROUTER_API_KEY) {
      const err = new Error('OpenRouter image credentials are not configured');
      await failImageGenerationTask(imageTask, err);
      return NextResponse.json(
        { detail: err.message },
        { status: 500 },
      );
    }
    const session = await getSessionSafely(request, interfaceAuthOptions);
    const userId = imageTask?.actor.userId || session?.user?.id || 'anonymous';
    const generation = await generateImageViaOpenRouter({ prompt });
    const persisted = await persistPhotoMagicPng(generation.png, { prefix: 'gen', userId });
    log.info('Photo Magic generate complete', {
      model: generation.model,
      filename: persisted.filename,
      userId,
      bytes: generation.png.length,
    });
    await completeImageGenerationTask(
      imageTask,
      `Photo Magic image generated with ${generation.model}.`,
    );
    // Both imageUrl and image_url are sent so the existing client code (which
    // checks `data.imageUrl || data.image_url`) keeps working unchanged.
    return NextResponse.json({
      imageUrl: persisted.url,
      image_url: persisted.url,
      filename: persisted.filename,
      image_path: persisted.absolutePath,
      model: generation.model,
      agencyTracked: Boolean(imageTask),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await failImageGenerationTask(imageTask, err);
    log.error('Photo Magic generate failed', { message });
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
