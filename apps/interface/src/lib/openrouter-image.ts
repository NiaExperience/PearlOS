/**
 * OpenRouter image generation client.
 *
 * Replaces the ComfyUI origin workflow with OpenRouter's chat-completions
 * image modality. Returns a PNG Buffer plus the model that produced it.
 *
 * Endpoint: POST https://openrouter.ai/api/v1/chat/completions
 * Payload: { model, messages, modalities: ["image", "text"], image_config? }
 * Response images arrive as data URLs at choices[0].message.images[i].image_url.url
 */

import { getLogger } from './logger';

const log = getLogger('[openrouter_image]');

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Pixel-sprite "dream team" — ranked for 16x16–128x128 pixel art on transparent /
 * solid backgrounds.  The first key in the array that resolves is used; the rest
 * act as fallbacks if the upstream model errors out (rate limit, content, etc).
 *
 * Picked for: prompt adherence, crisp pixel structure, ability to honor
 * "solid #FFFFFF background" instructions (so chroma keying is clean).
 */
export const SPRITE_MODEL_RANKING = [
  'google/gemini-2.5-flash-image',         // Gemini default
  'google/gemini-3.1-flash-image-preview', // quality fallback
  'google/gemini-3-pro-image-preview',     // Nano Banana Pro — premium fallback
  'openai/gpt-5.4-image-2',                // GPT Image 2 — strongest text rendering
] as const;

export type SpriteModel = (typeof SPRITE_MODEL_RANKING)[number];

/**
 * Character sprite ranking (256x256 and 512x512). Gemini leads the
 * low-cost trial path; premium models remain fallbacks.
 */
export const CHARACTER_MODEL_RANKING = [
  'google/gemini-2.5-flash-image',         // Gemini default
  'google/gemini-3.1-flash-image-preview', // fast quality fallback
  'google/gemini-3-pro-image-preview',     // higher fidelity fallback
  'openai/gpt-5.4-image-2',                // solid character work, robust prompt adherence
] as const;

/**
 * Background / environment scene ranking (wide aspects like 1024x576,
 * 1920x1080, or PearlOS 512x256 pixel art). Gemini leads the default path.
 */
export const BACKGROUND_MODEL_RANKING = [
  'google/gemini-2.5-flash-image',         // Gemini default
  'google/gemini-3.1-flash-image-preview', // fast quality fallback
  'google/gemini-3-pro-image-preview',     // premium wide-aspect fallback
  'openai/gpt-5.4-image-2',                // reliable scene generator
] as const;

export type SpriteKind = 'icon' | 'character' | 'background';

/** Pick the right model fallback chain for a generation tier. */
export function getModelRankingFor(kind: SpriteKind): readonly string[] {
  switch (kind) {
    case 'character':
      return CHARACTER_MODEL_RANKING;
    case 'background':
      return BACKGROUND_MODEL_RANKING;
    case 'icon':
    default:
      return SPRITE_MODEL_RANKING;
  }
}

export interface GenerateImageOptions {
  /** Override the model preference order. */
  models?: readonly string[];
  /** Aspect ratio hint (e.g. "1:1", "9:16"). */
  aspectRatio?: string;
  /** Image size hint (e.g. "1K", "2K", "4K"). Model-dependent. */
  imageSize?: string;
  /** Per-call timeout in ms. */
  timeoutMs?: number;
}

export interface GenerateImageResult {
  /** Raw PNG bytes (decoded from the OpenRouter data URL). */
  png: Buffer;
  /** MIME type as reported by the data URL. */
  mimeType: string;
  /** The model that actually produced the image. */
  model: string;
  /** Any text the model returned alongside the image. */
  text?: string;
}

/** Wraps a user prompt in our pixel-art template and pins a clean key-out background. */
export function wrapSpritePromptForOpenRouter(userPrompt: string): string {
  return [
    'Pixel-art icon asset.',
    'Crisp pixel edges, centered composition, strong readable silhouette, no text.',
    `Subject: ${userPrompt.trim()}`,
    'Background: SOLID PURE WHITE #FFFFFF (RGB 255,255,255). Do not add scenery, gradients, shadows, or props in the background.',
    'Output: a single sprite cutout on a flat white background.',
  ].join('\n');
}

/**
 * Character sprite prompt: full-body single character at 256/512, white BG so
 * the same chroma-key cleanup pipeline can run.
 */
export function wrapCharacterPromptForOpenRouter(userPrompt: string): string {
  return [
    'Pixel art character sprite in a classic 16-bit / SNES JRPG style.',
    'Single character, full body, centered, facing forward, clean silhouette.',
    'Crisp pixel edges, anti-aliasing OK at small scale, vibrant retro palette, expressive features, no text, no watermark.',
    `Subject: ${userPrompt.trim()}`,
    'Background: SOLID PURE WHITE #FFFFFF (RGB 255,255,255). No scenery, gradients, shadows, props, or floor — just the character on a flat white field.',
    'Output: one detailed character cutout on a flat white background.',
  ].join('\n');
}

/**
 * Background / scene prompt: full environment art at the requested aspect.
 * NO white-background instruction — we want the full scene from edge to edge,
 * and the postprocess pipeline skips chroma keying for this kind.
 */
export function wrapBackgroundPromptForOpenRouter(userPrompt: string): string {
  return [
    'Pixel-art background scene.',
    'Clear detail across the whole frame: foreground, midground, background. Sky, ground, and props all rendered as pixel art.',
    'Crisp pixel edges, cohesive palette, atmospheric lighting, painterly composition, no text or UI, no characters unless requested.',
    `Scene: ${userPrompt.trim()}`,
    'Fill the entire frame edge-to-edge — do NOT leave any white margins or borders. The image must be a fully painted environment.',
  ].join('\n');
}

export function wrapPromptForKind(kind: SpriteKind, userPrompt: string): string {
  switch (kind) {
    case 'character':
      return wrapCharacterPromptForOpenRouter(userPrompt);
    case 'background':
      return wrapBackgroundPromptForOpenRouter(userPrompt);
    case 'icon':
    default:
      return wrapSpritePromptForOpenRouter(userPrompt);
  }
}

interface OpenRouterChatImage {
  type?: string;
  image_url?: { url?: string };
}

interface OpenRouterChatChoice {
  message?: {
    role?: string;
    content?: string;
    images?: OpenRouterChatImage[];
  };
}

interface OpenRouterChatResponse {
  choices?: OpenRouterChatChoice[];
  error?: { message?: string; code?: number | string };
}

function decodeImageDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('OpenRouter returned an image_url that is not a base64 data URL');
  }
  return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') };
}

/**
 * Internal: build the OpenRouter chat-completions body for either a text-only
 * generation or a prompt + source image edit.  When `sourceImages` is provided
 * each entry is sent as an `image_url` content part alongside the text prompt.
 *
 * Exported (without a leading underscore) so unit tests can pin the request
 * shape — the caller never needs to construct these manually.
 */
export interface OpenRouterImageRequestParams {
  model: string;
  prompt: string;
  sourceImages?: ReadonlyArray<{ mimeType: string; base64: string }>;
  aspectRatio?: string;
  imageSize?: string;
}

export function buildOpenRouterImageRequestBody(
  params: OpenRouterImageRequestParams,
): Record<string, unknown> {
  const imageConfig: Record<string, unknown> = {};
  if (params.aspectRatio) imageConfig.aspect_ratio = params.aspectRatio;
  if (params.imageSize) imageConfig.image_size = params.imageSize;

  // When we have source images, we must use the structured content array form
  // (text part + image_url parts).  Without source images, OpenRouter accepts
  // either form, but the simple string content keeps the body small.
  const userContent: unknown =
    params.sourceImages && params.sourceImages.length > 0
      ? [
          { type: 'text', text: params.prompt },
          ...params.sourceImages.map((img) => ({
            type: 'image_url',
            image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
          })),
        ]
      : params.prompt;

  const body: Record<string, unknown> = {
    model: params.model,
    modalities: ['image', 'text'],
    messages: [{ role: 'user', content: userContent }],
  };
  if (Object.keys(imageConfig).length > 0) {
    body.image_config = imageConfig;
  }
  return body;
}

async function callOpenRouterOnce(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  signal: AbortSignal;
  sourceImages?: ReadonlyArray<{ mimeType: string; base64: string }>;
}): Promise<GenerateImageResult> {
  const { apiKey, baseUrl, model, prompt, aspectRatio, imageSize, signal, sourceImages } = params;

  const body = buildOpenRouterImageRequestBody({
    model,
    prompt,
    aspectRatio,
    imageSize,
    sourceImages,
  });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://pearlos.ai',
      'X-Title': 'PearlOS Sprite Summoner',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${model} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as OpenRouterChatResponse;
  if (data.error) {
    throw new Error(`OpenRouter ${model} error: ${data.error.message ?? 'unknown'}`);
  }

  const message = data.choices?.[0]?.message;
  const imageUrl = message?.images?.[0]?.image_url?.url;
  if (!imageUrl) {
    throw new Error(`OpenRouter ${model} returned no image in response`);
  }

  const { mimeType, bytes } = decodeImageDataUrl(imageUrl);
  return { png: bytes, mimeType, model, text: message?.content };
}

/**
 * Generate an image via OpenRouter, walking the model preference list on
 * failure.  Throws if every candidate fails.
 */
export async function generateSpriteImage(
  prompt: string,
  options: GenerateImageOptions = {},
): Promise<GenerateImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter image credentials are not configured');
  }
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  const models = options.models?.length ? options.models : SPRITE_MODEL_RANKING;
  const timeoutMs = options.timeoutMs ?? 90_000;

  let lastError: unknown;
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await callOpenRouterOnce({
        apiKey,
        baseUrl,
        model,
        prompt,
        aspectRatio: options.aspectRatio,
        imageSize: options.imageSize,
        signal: controller.signal,
      });
      log.info('OpenRouter image generated', {
        model,
        bytes: result.png.length,
        mimeType: result.mimeType,
      });
      return result;
    } catch (err) {
      lastError = err;
      log.warn('OpenRouter image attempt failed, falling back', {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `All OpenRouter image models failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Photo Magic — text-to-image and image-edit fallback chain.
 *
 * Distinct from SPRITE_MODEL_RANKING because the editor doesn't want pixel
 * art; it wants the model that ships the strongest general-purpose image
 * editing. Gemini leads the default path; premium models remain fallbacks.
 */
export const PHOTO_MAGIC_MODEL_RANKING = [
  'google/gemini-2.5-flash-image',
  'google/gemini-3.1-flash-image-preview',
  'google/gemini-3-pro-image-preview',
  'openai/gpt-5.4-image-2',
] as const;

export type PhotoMagicModel = (typeof PHOTO_MAGIC_MODEL_RANKING)[number];

export interface EditImageOptions extends GenerateImageOptions {
  /** Additional source images to compose with (multi-image edit). */
  additionalImages?: ReadonlyArray<{ mimeType: string; base64: string }>;
}

/**
 * Edit (or compose) an image via OpenRouter using the prompt + source image
 * pattern.  Walks the model preference list on failure.  Throws if every
 * candidate fails.
 */
export async function editImageViaOpenRouter(
  opts: {
    prompt: string;
    sourceImageBase64: string;
    sourceMimeType?: string;
  } & EditImageOptions,
): Promise<GenerateImageResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OpenRouter image credentials are not configured');
  }
  const baseUrl = (process.env.OPENROUTER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  const models = opts.models?.length ? opts.models : PHOTO_MAGIC_MODEL_RANKING;
  const timeoutMs = opts.timeoutMs ?? 120_000;

  const sourceImages = [
    { mimeType: opts.sourceMimeType ?? 'image/png', base64: opts.sourceImageBase64 },
    ...(opts.additionalImages ?? []),
  ];

  let lastError: unknown;
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await callOpenRouterOnce({
        apiKey,
        baseUrl,
        model,
        prompt: opts.prompt,
        aspectRatio: opts.aspectRatio,
        imageSize: opts.imageSize,
        signal: controller.signal,
        sourceImages,
      });
      log.info('OpenRouter image edited', {
        model,
        bytes: result.png.length,
        mimeType: result.mimeType,
        sourceCount: sourceImages.length,
      });
      return result;
    } catch (err) {
      lastError = err;
      log.warn('OpenRouter image-edit attempt failed, falling back', {
        model,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `All OpenRouter image-edit models failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * Generic text-to-image generator that walks the supplied (or default Photo
 * Magic) model fallback chain. Differs from `generateSpriteImage` only in its
 * default ranking — kept as a separate export so callers can stay explicit.
 */
export async function generateImageViaOpenRouter(
  opts: { prompt: string } & GenerateImageOptions,
): Promise<GenerateImageResult> {
  return generateSpriteImage(opts.prompt, {
    ...opts,
    models: opts.models?.length ? opts.models : PHOTO_MAGIC_MODEL_RANKING,
  });
}
