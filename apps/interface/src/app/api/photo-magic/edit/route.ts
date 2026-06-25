/**
 * POST /api/photo-magic/edit
 *
 * Single-image edit for Photo Magic. Accepts multipart/form-data with:
 *   - file:   the source image (PNG/JPEG)
 *   - prompt: the edit instruction
 *
 * Calls OpenRouter chat-completions with modalities: ["image", "text"] and the
 * source image embedded as a base64 data URL inside the user message content.
 * Returns a same-origin URL pointing at the persisted edited PNG.
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
import { editImageViaOpenRouter } from '@interface/lib/openrouter-image';
import { persistPhotoMagicPng } from '@interface/lib/photo-magic-storage';

const log = getLogger('[api_photo_magic_edit]');

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { detail: 'Body must be multipart/form-data' },
      { status: 400 },
    );
  }

  const prompt = (form.get('prompt') as string | null)?.trim() || '';
  const file = form.get('file');

  if (!prompt) {
    return NextResponse.json({ detail: 'Prompt is required' }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ detail: 'file is required' }, { status: 400 });
  }
  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const sourceMimeType = file.type || 'image/png';
  const sourceBase64 = sourceBuffer.toString('base64');

  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    imageTask = await startImageGenerationTask(request, {
      title: 'Edit image - Photo Magic',
      task: [
        'Edit one uploaded image in Photo Magic with this prompt.',
        '',
        prompt,
      ].join('\n'),
      note: 'Photo Magic single-image edit started.',
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
    const edited = await editImageViaOpenRouter({
      prompt,
      sourceImageBase64: sourceBase64,
      sourceMimeType,
    });
    const persisted = await persistPhotoMagicPng(edited.png, { prefix: 'edit', userId });
    log.info('Photo Magic edit complete', {
      model: edited.model,
      filename: persisted.filename,
      userId,
      bytes: edited.png.length,
      sourceBytes: sourceBuffer.length,
    });
    await completeImageGenerationTask(
      imageTask,
      `Photo Magic image edit completed with ${edited.model}.`,
    );
    return NextResponse.json({
      imageUrl: persisted.url,
      image_url: persisted.url,
      filename: persisted.filename,
      image_path: persisted.absolutePath,
      model: edited.model,
      agencyTracked: Boolean(imageTask),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await failImageGenerationTask(imageTask, err);
    log.error('Photo Magic edit failed', { message });
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
