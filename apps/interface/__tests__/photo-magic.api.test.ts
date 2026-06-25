/**
 * PhotoMagic OpenRouter rewrite — request shape + route handler smoke tests.
 *
 * These tests pin the OpenRouter request body produced by the new code paths
 * (text-to-image generate + prompt+image edit) and run the new Next.js route
 * handlers end-to-end against a mocked global fetch. We do NOT fire any real
 * OpenRouter API calls.
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const TEST_OUTPUT_DIR = path.join(os.tmpdir(), `photo-magic-test-${process.pid}`);

// Pin output dir + API key BEFORE the lib loads.
process.env.PHOTO_MAGIC_OUTPUT_DIR = TEST_OUTPUT_DIR;
process.env.OPENROUTER_API_KEY = 'test-key-photo-magic';

// 1x1 PNG (transparent) — minimal valid PNG bytes.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// Helper to mock global fetch for a single OpenRouter response.
function mockOpenRouterFetch(returnPngBase64 = TINY_PNG_BASE64): {
  capturedRequests: Array<{ url: string; init: RequestInit }>;
  restore: () => void;
} {
  const captured: Array<{ url: string; init: RequestInit }> = [];
  const original = global.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).fetch = jest.fn(async (url: string, init: RequestInit) => {
    captured.push({ url, init });
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'ok',
              images: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${returnPngBase64}` } },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  return {
    capturedRequests: captured,
    restore: () => {
      global.fetch = original;
    },
  };
}

afterEach(async () => {
  jest.restoreAllMocks();
  // Clean output dir between tests so we don't leak files.
  try {
    const entries = await fs.readdir(TEST_OUTPUT_DIR);
    await Promise.all(
      entries.map((e) => fs.unlink(path.join(TEST_OUTPUT_DIR, e)).catch(() => undefined)),
    );
  } catch {
    /* dir doesn't exist yet — fine */
  }
});

describe('buildOpenRouterImageRequestBody', () => {
  // Loaded inside it() to keep cross-test isolation tight.
  it('produces a plain string content body for text-to-image (no source images)', () => {
    const { buildOpenRouterImageRequestBody } = require('@interface/lib/openrouter-image');
    const body = buildOpenRouterImageRequestBody({
      model: 'google/gemini-3.1-flash-image-preview',
      prompt: 'a serene mountain at sunset',
    });
    expect(body).toEqual({
      model: 'google/gemini-3.1-flash-image-preview',
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: 'a serene mountain at sunset' }],
    });
  });

  it('produces structured content (text part + image_url parts) for image edit', () => {
    const { buildOpenRouterImageRequestBody } = require('@interface/lib/openrouter-image');
    const body = buildOpenRouterImageRequestBody({
      model: 'google/gemini-3.1-flash-image-preview',
      prompt: 'add a hat',
      sourceImages: [{ mimeType: 'image/png', base64: 'ZmFrZQ==' }],
    });
    // Must match the exact shape OpenRouter expects.
    expect(body.model).toBe('google/gemini-3.1-flash-image-preview');
    expect(body.modalities).toEqual(['image', 'text']);
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0].role).toBe('user');
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: 'add a hat' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,ZmFrZQ==' },
    });
  });

  it('appends image_config when aspectRatio / imageSize are supplied', () => {
    const { buildOpenRouterImageRequestBody } = require('@interface/lib/openrouter-image');
    const body = buildOpenRouterImageRequestBody({
      model: 'openai/gpt-5.4-image-2',
      prompt: 'wide shot',
      aspectRatio: '16:9',
      imageSize: '2K',
    });
    expect(body.image_config).toEqual({ aspect_ratio: '16:9', image_size: '2K' });
  });

  it('accepts multiple source images for multi-image composition', () => {
    const { buildOpenRouterImageRequestBody } = require('@interface/lib/openrouter-image');
    const body = buildOpenRouterImageRequestBody({
      model: 'google/gemini-3.1-flash-image-preview',
      prompt: 'merge these two scenes',
      sourceImages: [
        { mimeType: 'image/png', base64: 'YQ==' },
        { mimeType: 'image/jpeg', base64: 'Yg==' },
      ],
    });
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    expect(content).toHaveLength(3); // text + 2 images
    expect((content[1] as { image_url: { url: string } }).image_url.url).toBe(
      'data:image/png;base64,YQ==',
    );
    expect((content[2] as { image_url: { url: string } }).image_url.url).toBe(
      'data:image/jpeg;base64,Yg==',
    );
  });
});

describe('PHOTO_MAGIC_MODEL_RANKING', () => {
  it('starts with Nano Banana 2 Flash and falls back through Pro then GPT Image 2', () => {
    const { PHOTO_MAGIC_MODEL_RANKING } = require('@interface/lib/openrouter-image');
    expect(PHOTO_MAGIC_MODEL_RANKING).toEqual([
      'google/gemini-3.1-flash-image-preview',
      'google/gemini-3-pro-image-preview',
      'openai/gpt-5.4-image-2',
    ]);
  });
});

describe('editImageViaOpenRouter (OpenRouter call shape)', () => {
  it('POSTs the structured prompt+image body to /chat/completions and decodes the response', async () => {
    const { editImageViaOpenRouter } = require('@interface/lib/openrouter-image');
    const mock = mockOpenRouterFetch();
    try {
      const result = await editImageViaOpenRouter({
        prompt: 'turn the sky purple',
        sourceImageBase64: TINY_PNG_BASE64,
        sourceMimeType: 'image/png',
      });

      expect(mock.capturedRequests).toHaveLength(1);
      const [{ url, init }] = mock.capturedRequests;
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer test-key-photo-magic',
      );

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('google/gemini-3.1-flash-image-preview');
      expect(body.modalities).toEqual(['image', 'text']);
      const userMessage = body.messages[0];
      expect(userMessage.role).toBe('user');
      expect(Array.isArray(userMessage.content)).toBe(true);
      expect(userMessage.content[0]).toEqual({
        type: 'text',
        text: 'turn the sky purple',
      });
      expect(userMessage.content[1].type).toBe('image_url');
      expect(userMessage.content[1].image_url.url).toBe(
        `data:image/png;base64,${TINY_PNG_BASE64}`,
      );

      // Decoded response.
      expect(result.model).toBe('google/gemini-3.1-flash-image-preview');
      expect(result.mimeType).toBe('image/png');
      expect(Buffer.isBuffer(result.png)).toBe(true);
    } finally {
      mock.restore();
    }
  });
});

describe('Photo Magic /api/photo-magic/generate route', () => {
  it('persists a PNG to disk and returns a same-origin URL', async () => {
    const { POST } = require('@interface/app/api/photo-magic/generate/route');
    const mock = mockOpenRouterFetch();
    try {
      const req = new Request('http://localhost/api/photo-magic/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'a chrome sphere on a beach' }),
      });
      const res = await POST(req as unknown as never);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imageUrl).toMatch(/^\/api\/photo-magic\/image\//);
      expect(json.image_url).toBe(json.imageUrl);
      expect(json.filename).toMatch(/^gen_/);
      expect(json.model).toBe('google/gemini-3.1-flash-image-preview');

      // File actually exists.
      const fileBytes = await fs.readFile(json.image_path);
      expect(fileBytes.length).toBeGreaterThan(0);

      // OpenRouter call had the simple text-only content (no image_url parts).
      const body = JSON.parse(mock.capturedRequests[0].init.body as string);
      expect(typeof body.messages[0].content).toBe('string');
      expect(body.messages[0].content).toBe('a chrome sphere on a beach');
    } finally {
      mock.restore();
    }
  });

  it('returns 400 when prompt is missing', async () => {
    const { POST } = require('@interface/app/api/photo-magic/generate/route');
    const req = new Request('http://localhost/api/photo-magic/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await POST(req as unknown as never);
    expect(res.status).toBe(400);
  });
});

describe('Photo Magic /api/photo-magic/edit route', () => {
  it('reads the uploaded file, embeds it as a data URL, and persists the edited PNG', async () => {
    const { POST } = require('@interface/app/api/photo-magic/edit/route');
    const mock = mockOpenRouterFetch();
    try {
      const sourceBytes = Buffer.from(TINY_PNG_BASE64, 'base64');
      const form = new FormData();
      form.append('prompt', 'add sunglasses');
      form.append(
        'file',
        new Blob([sourceBytes], { type: 'image/png' }),
        'source.png',
      );
      const req = new Request('http://localhost/api/photo-magic/edit', {
        method: 'POST',
        body: form,
      });
      const res = await POST(req as unknown as never);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.imageUrl).toMatch(/^\/api\/photo-magic\/image\/edit_/);

      // OpenRouter request used the structured form with the source image.
      const body = JSON.parse(mock.capturedRequests[0].init.body as string);
      expect(body.modalities).toEqual(['image', 'text']);
      const content = body.messages[0].content;
      expect(content[0]).toEqual({ type: 'text', text: 'add sunglasses' });
      expect(content[1].type).toBe('image_url');
      expect(content[1].image_url.url).toBe(
        `data:image/png;base64,${sourceBytes.toString('base64')}`,
      );
    } finally {
      mock.restore();
    }
  });

  it('returns 400 when the file part is missing', async () => {
    const { POST } = require('@interface/app/api/photo-magic/edit/route');
    const form = new FormData();
    form.append('prompt', 'no file please');
    const req = new Request('http://localhost/api/photo-magic/edit', {
      method: 'POST',
      body: form,
    });
    const res = await POST(req as unknown as never);
    expect(res.status).toBe(400);
  });
});
