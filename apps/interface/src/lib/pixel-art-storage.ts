import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { photoMagicUserId } from './photo-magic-storage';

export const PIXEL_ART_OUTPUT_DIR =
  process.env.PIXEL_ART_OUTPUT_DIR || '/srv/pearl-user-workspaces/pixel-art';

export interface PixelArtAssetRecord {
  id: string;
  filename: string;
  url: string;
  type: string;
  description: string;
  width: number;
  height: number;
  timestamp: number;
  size: number;
}

function userOutputDir(rawUserId?: string | null): string {
  return path.join(PIXEL_ART_OUTPUT_DIR, photoMagicUserId(rawUserId));
}

function metadataPath(rawUserId?: string | null): string {
  return path.join(userOutputDir(rawUserId), 'assets.json');
}

export function resolveSafePixelArtPath(filename: string, rawUserId?: string | null): string | null {
  const safeName = path.basename(filename);
  const userDir = userOutputDir(rawUserId);
  const resolved = path.resolve(userDir, safeName);
  const root = path.resolve(userDir);
  if (resolved !== path.join(root, safeName) || !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  return resolved;
}

async function ensureDir(rawUserId?: string | null): Promise<string> {
  const dir = userOutputDir(rawUserId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function readMetadata(rawUserId?: string | null): Promise<PixelArtAssetRecord[]> {
  try {
    const raw = await fs.readFile(metadataPath(rawUserId), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.assets) ? parsed.assets : [];
  } catch {
    return [];
  }
}

async function writeMetadata(rawUserId: string | null | undefined, assets: PixelArtAssetRecord[]) {
  await ensureDir(rawUserId);
  await fs.writeFile(metadataPath(rawUserId), JSON.stringify({ assets }, null, 2), 'utf8');
}

export async function persistPixelArtPng(
  png: Buffer,
  options: {
    userId?: string | null;
    type: string;
    description: string;
    width: number;
    height: number;
  },
): Promise<PixelArtAssetRecord> {
  const dir = await ensureDir(options.userId);
  const id = randomUUID();
  const filename = `pixel-${options.type}-${options.width}x${options.height}-${id}.png`;
  const absolutePath = path.join(dir, filename);
  await fs.writeFile(absolutePath, png);

  const record: PixelArtAssetRecord = {
    id,
    filename,
    url: `/api/pixel-art/image/${filename}`,
    type: options.type,
    description: options.description,
    width: options.width,
    height: options.height,
    timestamp: Date.now(),
    size: png.length,
  };

  const assets = await readMetadata(options.userId);
  await writeMetadata(options.userId, [record, ...assets].slice(0, 200));
  return record;
}

export async function listPixelArtAssets(rawUserId?: string | null): Promise<PixelArtAssetRecord[]> {
  const assets = await readMetadata(rawUserId);
  return assets.sort((a, b) => b.timestamp - a.timestamp);
}
