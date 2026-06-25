/**
 * Sprite post-processing: anime-aware background removal (rembg/isnet-anime),
 * then resize-to-target, then the classic pixel-sprite cleanup (binary alpha,
 * edge erosion, 1px outline, palette quantization).
 *
 * Pipeline order matters: BG removal runs on the FULL-RES generated image so
 * isnet-anime sees clean edges, then the resize step downsamples the already
 * transparent sprite. This produces noticeably crisper edges on anime / toon
 * / pixel-art content than the older "resize first, then chroma-key #FFFFFF"
 * order, which folded white-halo artifacts into every downsampled silhouette.
 *
 * Designed to operate on in-memory PNG buffers — no ComfyUI roundtrips.
 */

import sharp from 'sharp';

import { getLogger } from './logger';

const log = getLogger('[sprite_postprocess]');

/**
 * URL of the local rembg HTTP server (PM2 process `rembg-anime`). Override
 * with REMBG_URL if it ever moves off-box. Set REMBG_URL=disabled to force
 * the legacy white-pixel chroma key.
 */
const REMBG_URL = process.env.REMBG_URL ?? 'http://127.0.0.1:7000';

/**
 * Background removal model. `isnet-anime` is purpose-built for anime /
 * illustration / pixel-art silhouettes; the default `u2net` is trained on
 * photos and mangles toon edges. Override with REMBG_MODEL if a different
 * variant is preferred (e.g. `birefnet-general`).
 */
const REMBG_MODEL = process.env.REMBG_MODEL ?? 'isnet-anime';

const REMBG_TIMEOUT_MS = Number(process.env.REMBG_TIMEOUT_MS ?? 15000);

export interface PostprocessOptions {
  /** Pixels with all RGB channels >= this become transparent. Default 240. */
  whiteThreshold?: number;
  /** Alpha cutoff for the binary threshold step. Default 128. */
  alphaThreshold?: number;
  /** Whether to add the 1px black outline. Default true. */
  addOutline?: boolean;
  /**
   * Palette quantization. `true` = 32 colors (icon default).
   * Pass a number to override the palette size (use ~64 for characters,
   * ~128+ for backgrounds, or `false` to skip quantization entirely).
   */
  quantize?: boolean | number;
  /**
   * Final downsample size. A single number means a square (e.g. 256 → 256x256).
   * An object {width, height} preserves a non-square aspect (e.g. backgrounds).
   * Default keeps the source size.
   */
  resizeTo?: number | { width: number; height: number };
  /**
   * Floor on the resized output's short side. When set, the resize step will
   * never produce a sprite with shorter dimension below this (aspect ratio
   * preserved). Used by the character and background tiers (default 128 at
   * the call sites). Icons, which are intentionally tiny, do not pass this.
   */
  minShortSide?: number;
  /**
   * Whether to remove the background. Default true. Set false for full-scene
   * backgrounds, where the full frame is the output (no transparency).
   */
  chromaKey?: boolean;
  /**
   * Force the legacy white-pixel chroma-key path even when rembg is reachable.
   * Useful only as an emergency override; left undefined in normal operation.
   */
  forceLegacyChromaKey?: boolean;
  /**
   * Whether to do the 1px alpha erosion pass that trims chroma-key halos.
   * Default true. Setting this false (with chromaKey true) is useful at
   * higher resolutions where erosion bites into legitimate sprite edges.
   */
  erodeAlpha?: boolean;
}

/**
 * Compute the actual resize dimensions, honoring an optional 128px (or other)
 * floor on the short side. Aspect ratio is preserved. Returns null when the
 * caller did not request a resize at all.
 *
 * Example: target=256x128, floor=128 → 256x128 (already at floor).
 *          target=64x36,  floor=128 → 228x128 (bumped up, same 16:9).
 *          target=512x512, floor=128 → 512x512 (well above floor).
 */
function resolveResizeDims(
  resizeTo: PostprocessOptions['resizeTo'],
  minShortSide: number | undefined,
): { width: number; height: number } | null {
  if (resizeTo === undefined) return null;
  let width: number;
  let height: number;
  if (typeof resizeTo === 'number') {
    width = resizeTo;
    height = resizeTo;
  } else {
    width = resizeTo.width;
    height = resizeTo.height;
  }
  if (minShortSide && minShortSide > 0) {
    const shortSide = Math.min(width, height);
    if (shortSide < minShortSide) {
      const scale = minShortSide / shortSide;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
  }
  return { width, height };
}

/**
 * POST the source PNG buffer to the local rembg server with the configured
 * model. Returns the transparent-background PNG, or null if rembg is
 * unreachable / errored — callers should fall back to chroma-keying.
 */
async function removeBackgroundViaRembg(input: Buffer): Promise<Buffer | null> {
  const url = `${REMBG_URL.replace(/\/$/, '')}/api/remove?model=${encodeURIComponent(REMBG_MODEL)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMBG_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(input)], { type: 'image/png' }),
      'sprite.png',
    );
    const response = await fetch(url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn('rembg returned non-OK status', { status: response.status, model: REMBG_MODEL });
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    log.warn('rembg call failed, falling back to chroma key', {
      error: err instanceof Error ? err.message : String(err),
      url,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Background removal: pixels at or above the white threshold become alpha=0.
 * For OpenRouter-generated sprites we always prompt for #FFFFFF background, so
 * a simple threshold is reliable and avoids dragging in a network-bound rembg
 * service.
 */
function chromaKeyWhiteToAlpha(rgba: Uint8Array, threshold: number): void {
  for (let i = 0; i < rgba.length; i += 4) {
    if (
      rgba[i] >= threshold &&
      rgba[i + 1] >= threshold &&
      rgba[i + 2] >= threshold
    ) {
      rgba[i + 3] = 0;
    }
  }
}

/**
 * Remove background (anime-aware via rembg/isnet-anime) and apply the sprite
 * cleanup pipeline.
 *
 * Order:
 *   1. Background removal on the FULL-RES input (rembg isnet-anime, with a
 *      white-pixel chroma-key fallback if rembg is unreachable).
 *   2. Resize to target (with optional 128 short-side floor).
 *   3. Binary alpha threshold → optional erode → optional outline → quantize.
 *   4. Encode PNG.
 *
 * Input: any PNG buffer.  Output: clean RGBA PNG buffer.
 */
export async function cleanSpriteBackground(
  input: Buffer,
  options: PostprocessOptions = {},
): Promise<Buffer> {
  const {
    whiteThreshold = 240,
    alphaThreshold = 128,
    addOutline = true,
    quantize = true,
    resizeTo,
    minShortSide,
    chromaKey = true,
    forceLegacyChromaKey = false,
    erodeAlpha: doErode = true,
  } = options;

  const paletteSize =
    typeof quantize === 'number' ? Math.max(2, Math.floor(quantize)) : quantize ? 32 : 0;

  const t0 = Date.now();

  // 1) Background removal — runs on the FULL-RES generated buffer so the
  //    matting model sees clean edges. Skipped for backgrounds (chromaKey=false).
  let workingInput = input;
  let bgRemoval: 'rembg' | 'chroma-key' | 'none' = 'none';
  if (chromaKey) {
    if (!forceLegacyChromaKey && REMBG_URL !== 'disabled') {
      const tRembgStart = Date.now();
      const transparent = await removeBackgroundViaRembg(input);
      if (transparent) {
        workingInput = transparent;
        bgRemoval = 'rembg';
        log.info('rembg matting applied', {
          model: REMBG_MODEL,
          elapsedMs: Date.now() - tRembgStart,
        });
      }
    }
  }

  // 2) Decode and resize. Resize runs AFTER background removal so we downsample
  //    an already-clean alpha channel rather than chroma-keying a downsampled
  //    halo. The 128 short-side floor (when requested) keeps character/scene
  //    output above the threshold while preserving aspect ratio.
  const dims = resolveResizeDims(resizeTo, minShortSide);
  let pipeline = sharp(workingInput).ensureAlpha();
  if (dims) {
    const isSquareTarget = dims.width === dims.height;
    pipeline = pipeline.resize(dims.width, dims.height, {
      fit: isSquareTarget ? 'inside' : 'fill',
      kernel: 'nearest',
    });
  }
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const pixels = new Uint8Array(data);

  // 3) Reconcile alpha. If rembg already set the alpha channel, just binarize
  //    it. Otherwise (rembg failed or disabled), fall back to the legacy
  //    white-pixel chroma key. Backgrounds force opaque.
  if (chromaKey) {
    if (bgRemoval !== 'rembg') {
      chromaKeyWhiteToAlpha(pixels, whiteThreshold);
      bgRemoval = 'chroma-key';
    }
    // Binary alpha threshold (no semi-transparency)
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = pixels[i] > alphaThreshold ? 255 : 0;
    }
  } else {
    // Backgrounds: opaque everywhere, no transparency.
    for (let i = 3; i < pixels.length; i += 4) {
      pixels[i] = 255;
    }
  }

  // 3) Build the working alpha mask. Erode 1px only when chroma-keying AND
  //    the caller wants halo trimming (default for icons; off for backgrounds
  //    or for higher-resolution character sprites if requested).
  const erodedAlpha = new Uint8Array(w * h);
  if (chromaKey && doErode) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (pixels[idx * 4 + 3] === 0) {
          erodedAlpha[idx] = 0;
          continue;
        }
        let hasTransparentNeighbor = false;
        if (x > 0 && pixels[(y * w + (x - 1)) * 4 + 3] === 0) hasTransparentNeighbor = true;
        if (x < w - 1 && pixels[(y * w + (x + 1)) * 4 + 3] === 0) hasTransparentNeighbor = true;
        if (y > 0 && pixels[((y - 1) * w + x) * 4 + 3] === 0) hasTransparentNeighbor = true;
        if (y < h - 1 && pixels[((y + 1) * w + x) * 4 + 3] === 0) hasTransparentNeighbor = true;
        erodedAlpha[idx] = hasTransparentNeighbor ? 0 : 255;
      }
    }
  } else {
    // No erosion: working alpha mirrors the chroma-keyed alpha (or full-opaque
    // for backgrounds).
    for (let i = 0; i < w * h; i++) {
      erodedAlpha[i] = pixels[i * 4 + 3];
    }
  }

  // 5) Outline pass — pixels just outside the eroded mask become black border
  const outlineAlpha = new Uint8Array(w * h);
  if (addOutline) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (erodedAlpha[idx] > 0) continue;
        let nearOpaque = false;
        for (let dy = -1; dy <= 1 && !nearOpaque; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (
              nx >= 0 && nx < w && ny >= 0 && ny < h &&
              erodedAlpha[ny * w + nx] > 0
            ) {
              nearOpaque = true;
              break;
            }
          }
        }
        outlineAlpha[idx] = nearOpaque ? 255 : 0;
      }
    }
  }

  // 6) Optional palette quantization (size configurable per-kind: 32 icons,
  //    64 characters, 128+ for backgrounds, 0 = skip).
  let palette: number[][] = [];
  if (paletteSize > 0) {
    const colorCounts = new Map<number, number>();
    for (let i = 0; i < w * h; i++) {
      if (erodedAlpha[i] > 0) {
        const pi = i * 4;
        const r5 = (pixels[pi] >> 3) << 3;
        const g5 = (pixels[pi + 1] >> 3) << 3;
        const b5 = (pixels[pi + 2] >> 3) << 3;
        const key = (r5 << 16) | (g5 << 8) | b5;
        colorCounts.set(key, (colorCounts.get(key) ?? 0) + 1);
      }
    }
    palette = [...colorCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, paletteSize)
      .map(([key]) => [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff]);
  }

  const findNearest = (r: number, g: number, b: number): [number, number, number] => {
    if (!palette.length) return [r, g, b];
    let bestDist = Infinity;
    let best = palette[0];
    for (const c of palette) {
      const dr = r - c[0];
      const dg = g - c[1];
      const db = b - c[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best as [number, number, number];
  };

  // 7) Assemble final RGBA buffer
  const output = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4;
    if (addOutline && outlineAlpha[i] > 0) {
      output[pi] = 0;
      output[pi + 1] = 0;
      output[pi + 2] = 0;
      output[pi + 3] = 255;
    } else if (erodedAlpha[i] > 0) {
      const [qr, qg, qb] = findNearest(pixels[pi], pixels[pi + 1], pixels[pi + 2]);
      output[pi] = qr;
      output[pi + 1] = qg;
      output[pi + 2] = qb;
      output[pi + 3] = 255;
    } else {
      output[pi] = 0;
      output[pi + 1] = 0;
      output[pi + 2] = 0;
      output[pi + 3] = 0;
    }
  }

  const cleaned = await sharp(Buffer.from(output), {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toBuffer();

  log.info('Sprite postprocess complete', {
    width: w,
    height: h,
    paletteSize: palette.length,
    bgRemoval,
    rembgModel: bgRemoval === 'rembg' ? REMBG_MODEL : undefined,
    chromaKey,
    erode: chromaKey && doErode,
    outline: addOutline,
    minShortSide: minShortSide ?? null,
    elapsedMs: Date.now() - t0,
  });

  return cleaned;
}
