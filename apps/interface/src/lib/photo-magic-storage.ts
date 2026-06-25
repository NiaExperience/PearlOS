/**
 * Photo Magic on-disk storage helpers.
 *
 * Generated PNGs land in user-scoped folders under /tmp/photo-magic. The
 * browser only receives opaque filenames; read/list routes resolve those names
 * through the authenticated user's folder.
 *
 * Files are served back to the browser through
 *   GET /api/photo-magic/image/:filename
 * which is implemented as a Next.js route handler so it doesn't depend on the
 * bot_gateway being up.
 */

import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export const PHOTO_MAGIC_OUTPUT_DIR =
  process.env.PHOTO_MAGIC_OUTPUT_DIR || '/tmp/photo-magic';

const ANONYMOUS_USER_ID = 'anonymous';

export interface PhotoMagicGalleryItem {
  filename: string;
  url: string;
  created: number;
  size: number;
}

export function photoMagicUserId(rawUserId?: string | null): string {
  const value = rawUserId?.trim() || ANONYMOUS_USER_ID;
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || ANONYMOUS_USER_ID;
}

export function photoMagicUserOutputDir(rawUserId?: string | null): string {
  return path.join(PHOTO_MAGIC_OUTPUT_DIR, photoMagicUserId(rawUserId));
}

/**
 * Resolve a filename inside the output dir, rejecting path-traversal.
 * Returns null if the resolved path escapes the output dir.
 */
export function resolveSafeOutputPath(filename: string, rawUserId?: string | null): string | null {
  const safeName = path.basename(filename);
  const userDir = photoMagicUserOutputDir(rawUserId);
  const resolved = path.resolve(userDir, safeName);
  const root = path.resolve(userDir);
  if (resolved !== path.join(root, safeName) || !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

export async function ensureOutputDir(rawUserId?: string | null): Promise<string> {
  const userDir = photoMagicUserOutputDir(rawUserId);
  await fs.mkdir(userDir, { recursive: true });
  return userDir;
}

/**
 * Persist a PNG buffer to the user's PhotoMagic folder and return the filename + the
 * same-origin URL the browser should fetch it from.
 *
 * The filename uses a UUID so concurrent writes never collide.
 */
export async function persistPhotoMagicPng(
  png: Buffer,
  options: { prefix?: string; userId?: string | null } = {},
): Promise<{ filename: string; url: string; absolutePath: string }> {
  const outputDir = await ensureOutputDir(options.userId);
  const prefix = options.prefix ? options.prefix.replace(/[^a-z0-9_-]/gi, '') : 'photo-magic';
  const filename = `${prefix}_${randomUUID()}.png`;
  const absolutePath = path.join(outputDir, filename);
  await fs.writeFile(absolutePath, png);
  return {
    filename,
    url: `/api/photo-magic/image/${filename}`,
    absolutePath,
  };
}

export async function listPhotoMagicImages(
  rawUserId?: string | null,
): Promise<PhotoMagicGalleryItem[]> {
  const outputDir = photoMagicUserOutputDir(rawUserId);
  let entries: string[];
  try {
    entries = await fs.readdir(outputDir);
  } catch {
    return [];
  }

  const items = await Promise.all(entries
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .map(async (filename) => {
      const fullPath = path.join(outputDir, filename);
      const stat = await fs.stat(fullPath);
      return {
        filename,
        url: `/api/photo-magic/image/${filename}`,
        created: Math.floor(stat.mtimeMs / 1000),
        size: stat.size,
      };
    }));

  return items.sort((a, b) => b.created - a.created);
}
