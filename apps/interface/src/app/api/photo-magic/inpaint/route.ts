/**
 * POST /api/photo-magic/inpaint
 *
 * "Inpaint" pass over an OpenRouter image-edit. The Gemini / GPT image-edit
 * pipeline doesn't take a binary mask the way ComfyUI's inpaint workflow did,
 * so we degrade gracefully: we send the source image + the mask as a second
 * image and tell the model "edit only the masked region".
 *
 * Accepts multipart/form-data with `file` (source), `mask` (binary mask PNG),
 * and `prompt`.
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

const log = getLogger('[api_photo_magic_inpaint]');

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

  const userPrompt = (form.get('prompt') as string | null)?.trim() || '';
  const file = form.get('file');
  const mask = form.get('mask');

  if (!userPrompt) {
    return NextResponse.json({ detail: 'Prompt is required' }, { status: 400 });
  }
  if (!(file instanceof Blob)) {
    return NextResponse.json({ detail: 'file is required' }, { status: 400 });
  }
  if (!(mask instanceof Blob)) {
    return NextResponse.json({ detail: 'mask is required' }, { status: 400 });
  }
  // Augment the user prompt with explicit guidance so the chat-completions
  // image models treat the second image as a region mask. Gemini and GPT-image
  // both honor this kind of phrasing in practice; we don't have a true
  // binary-mask channel here.
  const inpaintPrompt = [
    'INPAINT TASK:',
    `Apply this edit ONLY to the white pixels of the provided mask: ${userPrompt}`,
    'The first image is the original. The second image is a binary mask — white = region to edit, black = preserve unchanged.',
    'Do not modify anything outside the white masked region. Match lighting, color balance, and texture of the surrounding pixels.',
  ].join('\n');

  const sourceBuffer = Buffer.from(await file.arrayBuffer());
  const maskBuffer = Buffer.from(await mask.arrayBuffer());

  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    imageTask = await startImageGenerationTask(request, {
      title: 'Inpaint image - Photo Magic',
      task: [
        'Inpaint one uploaded image in Photo Magic with this prompt.',
        '',
        userPrompt,
      ].join('\n'),
      note: 'Photo Magic inpaint generation started.',
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
      prompt: inpaintPrompt,
      sourceImageBase64: sourceBuffer.toString('base64'),
      sourceMimeType: file.type || 'image/png',
      additionalImages: [
        { mimeType: mask.type || 'image/png', base64: maskBuffer.toString('base64') },
      ],
    });
    const persisted = await persistPhotoMagicPng(edited.png, { prefix: 'inpaint', userId });
    log.info('Photo Magic inpaint complete', {
      model: edited.model,
      filename: persisted.filename,
      userId,
    });
    await completeImageGenerationTask(
      imageTask,
      `Photo Magic inpaint completed with ${edited.model}.`,
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
    log.error('Photo Magic inpaint failed', { message });
    return NextResponse.json({ detail: message }, { status: 500 });
  }
}
