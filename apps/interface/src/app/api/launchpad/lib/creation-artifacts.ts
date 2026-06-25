import fs from 'fs/promises';
import path from 'path';

function publicTaskRoot(): string {
  return process.env.PEARL_PUBLIC_TASK_ROOT || '/srv/pearl-user-workspaces';
}

export const LEGACY_CREATION_ROOTS = [
  '/opt/pearlos/creations',
  '/home/deploy/pearlos/creations',
  '/workspace/nia-universal/creations',
];

export const CREATION_ROOTS = LEGACY_CREATION_ROOTS;

export interface CreationArtifact {
  id: string;
  indexPath: string;
  outputPath: string;
  playUrl: string;
}

export interface CreationOwner {
  tenantId?: string | null;
  userId?: string | null;
  email?: string | null;
}

export function isSafeCreationId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id);
}

export function safePathComponent(value: string | null | undefined, fallback = 'unknown'): string {
  const raw = String(value || '').trim().toLowerCase();
  const safe = Array.from(raw)
    .map((ch) => (/^[a-z0-9._@+-]$/.test(ch) ? ch : '_'))
    .join('')
    .replace(/^[._-]+|[._-]+$/g, '');
  return (safe || fallback).slice(0, 160);
}

export function scopedCreationRoot(owner: CreationOwner): string {
  const tenant = safePathComponent(owner.tenantId, 'public');
  const user = safePathComponent(owner.userId || owner.email, 'anonymous');
  return path.join(publicTaskRoot(), tenant, user, 'creations');
}

export function creationRootsForOwner(owner?: CreationOwner): string[] {
  return owner ? [scopedCreationRoot(owner)] : LEGACY_CREATION_ROOTS;
}

export function creationOutputPath(id: string, owner: CreationOwner): string {
  if (!isSafeCreationId(id)) {
    throw new Error('Invalid creation id');
  }
  return path.join(scopedCreationRoot(owner), id) + path.sep;
}

function legacyRootForOutputPath(id: string, outputPath?: string): string | null {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  for (const root of LEGACY_CREATION_ROOTS) {
    const expected = path.resolve(root, id);
    if (resolved === expected || resolved === expected + path.sep) {
      return root;
    }
  }
  return null;
}

export function creationRootsForLookup(id: string, outputPath?: string, owner?: CreationOwner): string[] {
  const roots = creationRootsForOwner(owner);
  const legacyRoot = legacyRootForOutputPath(id, outputPath);
  return legacyRoot && !roots.includes(legacyRoot) ? [...roots, legacyRoot] : roots;
}

function outputPathCandidate(id: string, outputPath?: string, roots?: string[]): string | null {
  if (!outputPath) return null;
  const resolved = path.resolve(outputPath);
  const allowed = (roots || LEGACY_CREATION_ROOTS).some((root) => {
    const expected = path.resolve(root, id);
    return resolved === expected || resolved === expected + path.sep;
  });
  return allowed ? path.join(resolved, 'index.html') : null;
}

export async function findCreationArtifact(
  id: string,
  outputPath?: string,
  owner?: CreationOwner,
): Promise<CreationArtifact | null> {
  if (!isSafeCreationId(id)) return null;

  const roots = creationRootsForLookup(id, outputPath, owner);
  const candidates = [
    outputPathCandidate(id, outputPath, roots),
    ...roots.map((root) => path.join(root, id, 'index.html')),
  ].filter(Boolean) as string[];

  for (const indexPath of candidates) {
    try {
      const fileStat = await fs.lstat(indexPath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) continue;
      const outputDir = path.dirname(indexPath);
      const realOutputDir = await fs.realpath(outputDir);
      const realIndex = await fs.realpath(indexPath);
      if (realIndex !== path.join(realOutputDir, 'index.html')) continue;
      const allowed = await Promise.all(
        roots.map(async (root) => {
          try {
            return await fs.realpath(root);
          } catch {
            return path.resolve(root);
          }
        }),
      );
      if (!allowed.some((root) => realOutputDir === path.join(root, id))) continue;
      return {
        id,
        indexPath: realIndex,
        outputPath: realOutputDir + path.sep,
        playUrl: `/api/creation/${encodeURIComponent(id)}/`,
      };
    } catch {
      // Try the next known creation root.
    }
  }

  return null;
}
