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
import {
  generateSpriteImage,
  getModelRankingFor,
  type SpriteKind,
  wrapPromptForKind,
} from '@interface/lib/openrouter-image';
import { listPixelArtAssets, persistPixelArtPng } from '@interface/lib/pixel-art-storage';
import { cleanSpriteBackground } from '@interface/lib/sprite-postprocess';

const log = getLogger('[api_pixel_art_generate]');

// Style guidance per element type. Icon-tier types share the same retro UI
// language; character/background tiers get their own templates.
const STYLE_PROMPTS: Record<string, string> = {
  icon:
    'Clean pixel-art icon. Crisp pixel edges, centered composition, one single object, strong silhouette, readable at small size. Sprite cutout on solid pure white #FFFFFF background only.',
  button:
    'Classic 90s PC adventure game pixel art style. Richly detailed UI button element with vibrant retro colors. Sprite cutout on solid pure white #FFFFFF background only. Rounded rectangle with pixel-perfect edges and depth shading. 16-bit RPG menu button.',
  badge:
    'Classic 90s PC adventure game pixel art style. Richly detailed badge collectible with vibrant retro colors. Sprite cutout on solid pure white #FFFFFF background only. Small shield or circular badge with bold details. 16-bit era achievement icon.',
  frame:
    'Classic 90s PC adventure game pixel art style. Richly detailed decorative frame border with vibrant retro colors. Sprite cutout on solid pure white #FFFFFF background only. Ornate corner and edge RPG menu frame. 16-bit fantasy UI border.',
  divider:
    'Classic 90s PC adventure game pixel art style. Richly detailed horizontal divider separator with vibrant retro colors. Sprite cutout on solid pure white #FFFFFF background only. Decorative line with pixel flourishes. 16-bit fantasy UI element.',
  character:
    'Classic 16-bit JRPG pixel art character sprite (Chrono Trigger / Final Fantasy VI era). Single character, full body, expressive features, crisp outlines, vibrant retro palette. Centered on a solid pure white #FFFFFF field — no scenery, no shadows, no floor.',
  background:
    'Full-frame pixel-art environment scene. Clear foreground, middle ground, and background. Atmospheric lighting, cohesive palette, no characters, no UI, no text. Fill the entire canvas with no white margins.',
};

const ICON_TYPES = ['icon', 'button', 'badge', 'frame', 'divider'] as const;
const CHARACTER_TYPES = ['character'] as const;
const BACKGROUND_TYPES = ['background'] as const;
const VALID_TYPES = [...ICON_TYPES, ...CHARACTER_TYPES, ...BACKGROUND_TYPES] as const;
type PixelArtType = (typeof VALID_TYPES)[number];

// Allowed square sizes by tier. Wider/taller scenes use width+height instead.
const ICON_SIZES = [16, 32, 48, 64, 128] as const;
const CHARACTER_SIZES = [256, 512] as const;

// Common preset background dimensions. The route also accepts arbitrary
// width/height pairs as long as both fall in [256, 4096].
const BACKGROUND_PRESETS: Record<string, { width: number; height: number }> = {
  '1024x576': { width: 1024, height: 576 },   // 16:9 small
  '1280x720': { width: 1280, height: 720 },   // 16:9 HD
  '1920x1080': { width: 1920, height: 1080 }, // 16:9 full HD
  '1024x1024': { width: 1024, height: 1024 }, // square scene
  '1024x768': { width: 1024, height: 768 },   // 4:3 classic
};

const MIN_BG_DIM = 256;
const MAX_BG_DIM = 4096;

function tierForType(type: PixelArtType): SpriteKind {
  if ((CHARACTER_TYPES as readonly string[]).includes(type)) return 'character';
  if ((BACKGROUND_TYPES as readonly string[]).includes(type)) return 'background';
  return 'icon';
}

function aspectRatioStringFor(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(width, height);
  return `${width / g}:${height / g}`;
}

export async function POST(request: NextRequest) {
  let imageTask: ImageGenerationTaskHandle | null = null;
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const {
      type = 'icon',
      description,
      size = 32,
      palette,
      width: rawWidth,
      height: rawHeight,
      preset,
    } = body as {
      type?: string;
      description?: string;
      size?: number;
      palette?: string;
      width?: number;
      height?: number;
      preset?: string;
    };

    if (!description || typeof description !== 'string') {
      return NextResponse.json({ error: 'description is required' }, { status: 400 });
    }
    if (!(VALID_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    const tier = tierForType(type as PixelArtType);

    // Resolve target dimensions per tier.
    let targetWidth: number;
    let targetHeight: number;
    if (tier === 'icon') {
      if (!(ICON_SIZES as readonly number[]).includes(size)) {
        return NextResponse.json(
          { error: `For type=${type}, size must be one of: ${ICON_SIZES.join(', ')}` },
          { status: 400 },
        );
      }
      targetWidth = size;
      targetHeight = size;
    } else if (tier === 'character') {
      if (!(CHARACTER_SIZES as readonly number[]).includes(size)) {
        return NextResponse.json(
          { error: `For type=character, size must be one of: ${CHARACTER_SIZES.join(', ')}` },
          { status: 400 },
        );
      }
      targetWidth = size;
      targetHeight = size;
    } else {
      // background — accept either a named preset or explicit width+height
      if (preset && BACKGROUND_PRESETS[preset]) {
        ({ width: targetWidth, height: targetHeight } = BACKGROUND_PRESETS[preset]);
      } else if (
        typeof rawWidth === 'number' &&
        typeof rawHeight === 'number' &&
        rawWidth >= MIN_BG_DIM && rawWidth <= MAX_BG_DIM &&
        rawHeight >= MIN_BG_DIM && rawHeight <= MAX_BG_DIM
      ) {
        targetWidth = Math.round(rawWidth);
        targetHeight = Math.round(rawHeight);
      } else {
        return NextResponse.json(
          {
            error: `For type=background, supply preset (one of: ${Object.keys(BACKGROUND_PRESETS).join(', ')}) or width+height in [${MIN_BG_DIM}, ${MAX_BG_DIM}]`,
          },
          { status: 400 },
        );
      }
    }

    const stylePreamble = STYLE_PROMPTS[type] || STYLE_PROMPTS.icon;
    const paletteSuffix = palette ? `\nColor palette: ${palette}` : '';
    let fullPrompt: string;
    if (tier === 'background') {
      fullPrompt = `${stylePreamble}\n\nScene: ${description}${paletteSuffix}\n\nFill the full ${targetWidth}x${targetHeight} canvas — pixel art landscape, no white margins, no text, no UI overlay.`;
    } else if (tier === 'character') {
      fullPrompt = `${stylePreamble}\n\nCharacter: ${description}${paletteSuffix}\n\nBackground: SOLID PURE WHITE #FFFFFF only. No scenery.`;
    } else {
      fullPrompt = `${stylePreamble}\n\nSubject: ${description}${paletteSuffix}\n\nBackground: SOLID PURE WHITE #FFFFFF only. No scenery.`;
    }

    // Wrap with the per-kind master template too so the model sees both the
    // style hint and our standard pixel-art harness.
    const wrapped = wrapPromptForKind(tier, fullPrompt);
    imageTask = await startImageGenerationTask(request, {
      title: `Generate pixel art - ${type} ${targetWidth}x${targetHeight}`,
      task: [
        `Generate a ${targetWidth}x${targetHeight} pixel-art ${type}.`,
        `Tier: ${tier}`,
        palette ? `Palette: ${palette}` : '',
        '',
        description,
      ].filter(Boolean).join('\n'),
      requestedTenantId: (body as { tenantId?: unknown; tenant_id?: unknown })?.tenantId
        ?? (body as { tenant_id?: unknown })?.tenant_id,
      note: `Pixel-art ${type} generation started.`,
    });

    if (!process.env.OPENROUTER_API_KEY) {
      const err = new Error('OpenRouter image credentials are not configured');
      await failImageGenerationTask(imageTask, err);
      return NextResponse.json(
        { error: err.message },
        { status: 503 },
      );
    }

    // Aspect / size hints sent to the OpenRouter image_config:
    //   icon/character → "1:1" / 1K (icons re-sample down anyway)
    //   background → ratio derived from width:height, requested size 2K so the
    //                model produces enough detail before we resize-fit.
    const aspectRatio =
      tier === 'background'
        ? aspectRatioStringFor(targetWidth, targetHeight)
        : '1:1';
    const imageSize = tier === 'background' ? '2K' : tier === 'character' && size === 512 ? '2K' : '1K';

    const tStart = Date.now();
    const generation = await generateSpriteImage(wrapped, {
      models: getModelRankingFor(tier),
      aspectRatio,
      imageSize,
    });

    // Characters benefit from a slight outline at 256/512 — it adds readability
    // when shrunk into a card. Icons keep the original "icon|badge only" rule.
    // Backgrounds skip outline entirely.
    const wantOutline =
      tier === 'character' ? true :
      tier === 'icon' ? (type === 'icon' || type === 'badge') :
      false;

    const cleaned = await cleanSpriteBackground(generation.png, {
      resizeTo:
        tier === 'background'
          ? { width: targetWidth, height: targetHeight }
          : targetWidth,
      // 128px short-side floor applies to character and background tiers.
      // Icons (16/32/48/64) are intentionally tiny UI elements — opt out.
      minShortSide: tier === 'icon' ? undefined : 128,
      addOutline: wantOutline,
      chromaKey: tier !== 'background',
      // Erosion at 256+ bites into legitimate hair/silhouette pixels — only
      // run it for the small icon tier where it was tuned.
      erodeAlpha: tier === 'icon',
      // Palette size: 32 colors for icons, 64 for characters, 128 for scenes.
      quantize: tier === 'icon' ? 32 : tier === 'character' ? 64 : 128,
    });

    const session = await getSessionSafely(request, interfaceAuthOptions);
    const userId = session?.user?.id || 'anonymous';
    const persisted = await persistPixelArtPng(cleaned, {
      userId,
      type,
      description,
      width: targetWidth,
      height: targetHeight,
    });

    log.info('Pixel art generated', {
      type,
      tier,
      width: targetWidth,
      height: targetHeight,
      model: generation.model,
      filename: persisted.filename,
      userId,
      elapsedMs: Date.now() - tStart,
    });
    await completeImageGenerationTask(
      imageTask,
      `Pixel-art ${type} generated at ${targetWidth}x${targetHeight} with ${generation.model}.`,
    );

    return new NextResponse(new Uint8Array(cleaned), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Disposition': `inline; filename="pixel-${type}-${targetWidth}x${targetHeight}.png"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Pixel-Art-Type': type,
        'X-Pixel-Art-Tier': tier,
        'X-Pixel-Art-Width': String(targetWidth),
        'X-Pixel-Art-Height': String(targetHeight),
        'X-Pixel-Art-Id': persisted.id,
        'X-Pixel-Art-Url': persisted.url,
        'X-Pixel-Art-Filename': persisted.filename,
        'X-Image-Model': generation.model,
        'X-Agency-Tracked': imageTask ? '1' : '0',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await failImageGenerationTask(imageTask, err);
    log.error('pixel-art generate failed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * GET listing kept for compatibility with older callers.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionSafely(request, interfaceAuthOptions);
  const userId = session?.user?.id || 'anonymous';
  const assets = await listPixelArtAssets(userId);
  return NextResponse.json({ assets });
}
