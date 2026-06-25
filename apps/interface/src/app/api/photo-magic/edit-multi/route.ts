/**
 * POST /api/photo-magic/edit-multi
 *
 * Multi-image composition (up to 3 images) + prompt. Accepts a multipart form
 * with `files` (repeated) and `prompt`. The first file is treated as the
 * primary source image; the rest are passed as additional `image_url` content
 * parts on the same OpenRouter call.
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

const log = getLogger('[api_photo_magic_edit_multi]');

export const runtime = 'nodejs';

const MAX_FILES = 3;

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
  const filesRaw = form.getAll('files');
  const files = filesRaw.filter((f): f is File => f instanceof Blob).slice(0, MAX_FILES);

  if (!prompt) {
    return NextResponse.json({ detail: 'Prompt is required' }, { status: 400 });
  }
  if (files.length === 0) {
    return NextResponse.json(
      { detail: 'At least one file is required' },
      { status: 400 },
    );
  }
  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    imageTask = await startImageGenerationTask(request, {
      title: 'Compose images - Photo Magic',
      task: [
        `Compose ${files.length} uploaded image(s) in Photo Magic with this prompt.`,
        '',
        prompt,
      ].join('\n'),
      note: 'Photo Magic multi-image composition started.',
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
    const encoded = await Promise.all(
      files.map(async (f) => ({
        mimeType: f.type || 'image/png',
        base64: Buffer.from(await f.arrayBuffer()).toString('base64'),
      })),
    );

    const [primary, ...rest] = encoded;
    const edited = await editImageViaOpenRouter({
      prompt,
      sourceImageBase64: primary.base64,
      sourceMimeType: primary.mimeType,
      additionalImages: rest,
    });
    const persisted = await persistPhotoMagicPng(edited.png, { prefix: 'edit-multi', userId });
    log.info('Photo Magic edit-multi complete', {
      model: edited.model,
      filename: persisted.filename,
      userId,
      sources: encoded.length,
    });
    await completeImageGenerationTask(
      imageTask,
      `Photo Magic multi-image composition completed with ${edited.model}.`,
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
    log.error('Photo Magic edit-multi failed', { message });
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
