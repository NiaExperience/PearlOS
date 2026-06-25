import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';

import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

interface SearchEntry {
  name: string;
  kind: 'folder' | 'file';
  path: string;
  parentPath: string;
  size?: string;
  sizeBytes?: number;
  ext?: string;
  modifiedAt?: string;
}

interface SearchCandidate extends SearchEntry {
  score: number;
  matchReason: string;
  previewChildren?: SearchEntry[];
}

const USER_ROOT_BASE = '/workspace/user';
const MAX_SCAN_ENTRIES = 3000;
const MAX_SCAN_DEPTH = 8;
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'did', 'do', 'for', 'from', 'i', 'in', 'it', 'me',
  'my', 'need', 'of', 'on', 'that', 'the', 'those', 'to', 'with',
]);
const EXT_ALIASES: Record<string, string[]> = {
  png: ['png'],
  pngs: ['png'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'],
  photo: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  photos: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  picture: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  pictures: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
  screenshot: ['png', 'jpg', 'jpeg'],
  screenshots: ['png', 'jpg', 'jpeg'],
  video: ['mp4', 'mov', 'webm'],
  videos: ['mp4', 'mov', 'webm'],
  doc: ['md', 'txt', 'docx', 'pdf'],
  docs: ['md', 'txt', 'docx', 'pdf'],
};

function isSafeUserId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function isInside(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

async function tenantForSession(req: NextRequest, userId: string, sessionUser: any): Promise<string | NextResponse> {
  const requested = req.nextUrl.searchParams.get('tenantId') || req.nextUrl.searchParams.get('tenant_id');
  const sessionTenant = typeof sessionUser?.tenantId === 'string'
    ? sessionUser.tenantId
    : typeof sessionUser?.tenant_id === 'string'
      ? sessionUser.tenant_id
      : '';
  const wanted = (requested || sessionTenant || '').trim();
  const roles = await getUserTenantRoles(userId).catch(() => []);
  const selected = wanted
    ? roles.find((role: any) => role?.tenantId === wanted)?.tenantId
    : roles.find((role: any) => role?.tenantId)?.tenantId;
  if (!selected) return NextResponse.json({ error: 'tenant_forbidden' }, { status: 403 });
  return selected;
}

function getExt(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryParts(query: string): { tokens: string[]; extensions: Set<string>; wantsAssets: boolean } {
  const extensions = new Set<string>();
  const normalized = normalizeText(query);
  const tokens: string[] = [];
  for (const rawToken of normalized.split(/\s+/)) {
    const token = rawToken.replace(/^\.+|\.+$/g, '');
    if (!token || STOP_WORDS.has(token)) continue;
    const aliases = EXT_ALIASES[token] || EXT_ALIASES[token.replace(/s$/, '')];
    if (aliases) aliases.forEach((ext) => extensions.add(ext));
    if (!aliases) tokens.push(token.replace(/s$/, ''));
  }
  return {
    tokens: Array.from(new Set(tokens)),
    extensions,
    wantsAssets: /\b(asset|assets|sprite|sprites|art|artwork)\b/.test(normalized),
  };
}

function toRelativePath(root: string, fullPath: string): string {
  return path.relative(root, fullPath).split(path.sep).filter(Boolean).join('/');
}

function entryFromStat(root: string, fullPath: string, name: string, stat: fs.Stats): SearchEntry {
  const relativePath = toRelativePath(root, fullPath);
  const parentPath = toRelativePath(root, path.dirname(fullPath));
  if (stat.isDirectory()) {
    return { name, kind: 'folder', path: relativePath, parentPath, modifiedAt: stat.mtime.toISOString() };
  }
  return {
    name,
    kind: 'file',
    path: relativePath,
    parentPath,
    size: formatSize(stat.size),
    sizeBytes: stat.size,
    ext: getExt(name),
    modifiedAt: stat.mtime.toISOString(),
  };
}

async function scanFiles(root: string, dir = root, depth = 0, entries: SearchEntry[] = []): Promise<SearchEntry[]> {
  if (depth > MAX_SCAN_DEPTH || entries.length >= MAX_SCAN_ENTRIES) return entries;
  const realRoot = await fsp.realpath(root).catch(() => root);
  const dirents = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (entries.length >= MAX_SCAN_ENTRIES) break;
    if (dirent.isSymbolicLink()) continue;
    const fullPath = path.join(dir, dirent.name);
    const lstat = await fsp.lstat(fullPath).catch(() => null);
    if (!lstat || lstat.isSymbolicLink()) continue;
    const realPath = await fsp.realpath(fullPath).catch(() => '');
    if (!realPath || !isInside(realPath, realRoot)) continue;
    const stat = await fsp.stat(fullPath).catch(() => null);
    if (!stat) continue;
    const entry = entryFromStat(root, fullPath, dirent.name, stat);
    entries.push(entry);
    if (entry.kind === 'folder') {
      await scanFiles(root, fullPath, depth + 1, entries);
    }
  }
  return entries;
}

function scoreEntry(entry: SearchEntry, allEntries: SearchEntry[], query: string): SearchCandidate | null {
  const { tokens, extensions, wantsAssets } = queryParts(query);
  const haystack = normalizeText(`${entry.name} ${entry.path}`);
  const reasons = new Set<string>();
  let score = 0;

  for (const token of tokens) {
    if (normalizeText(entry.name).split(/\s+/).includes(token)) {
      score += 12;
      reasons.add(`name matches "${token}"`);
    } else if (haystack.includes(token)) {
      score += 5;
      reasons.add(`path mentions "${token}"`);
    }
  }

  if (entry.kind === 'file' && entry.ext && extensions.has(entry.ext)) {
    score += 18;
    reasons.add(`${entry.ext.toUpperCase()} file`);
  }

  if (entry.kind === 'folder') {
    const descendants = allEntries.filter((candidate) => candidate.path.startsWith(`${entry.path}/`));
    const matchingFiles = descendants.filter(
      (candidate) => candidate.kind === 'file' && candidate.ext && extensions.has(candidate.ext),
    );
    if (matchingFiles.length > 0) {
      score += Math.min(38, 10 + matchingFiles.length * 4);
      reasons.add(`${matchingFiles.length} matching file${matchingFiles.length === 1 ? '' : 's'} inside`);
    }
    if (extensions.size > 0 && /\b(asset|assets)\b/.test(haystack)) {
      score += 18;
      reasons.add('asset folder');
    }
    if (wantsAssets && /\b(asset|assets|sprite|sprites|art)\b/.test(haystack)) {
      score += 14;
      reasons.add('asset folder');
    }
  }

  if (tokens.length === 0 && extensions.size === 0 && haystack.includes(normalizeText(query))) {
    score += 4;
    reasons.add('text match');
  }

  if (score <= 0) return null;
  return {
    ...entry,
    score,
    matchReason: Array.from(reasons).slice(0, 2).join(', ') || 'related match',
  };
}

function withPreview(candidate: SearchCandidate, allEntries: SearchEntry[]): SearchCandidate {
  if (candidate.kind !== 'folder') return candidate;
  return {
    ...candidate,
    previewChildren: allEntries
      .filter((entry) => entry.parentPath === candidate.path)
      .slice(0, 4),
  };
}

export async function GET(req: NextRequest) {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id ? String(session.user.id) : '';
  if (!userId || !isSafeUserId(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = (new URL(req.url).searchParams.get('q') || '').trim();
  if (!query) return NextResponse.json({ error: 'Missing search query' }, { status: 400 });

  const tenantId = await tenantForSession(req, userId, session?.user);
  if (tenantId instanceof NextResponse) return tenantId;
  const filesRoot = path.join(USER_ROOT_BASE, tenantId, userId, 'Documents');
  await fsp.mkdir(filesRoot, { recursive: true });
  const entries = await scanFiles(filesRoot);
  const results = entries
    .map((entry) => scoreEntry(entry, entries, query))
    .filter((entry): entry is SearchCandidate => Boolean(entry))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 12)
    .map((entry) => withPreview(entry, entries));

  const best = results[0];
  const openedPath = best ? (best.kind === 'folder' ? best.path : best.parentPath) : '';
  const message = best
    ? `I found ${best.kind === 'folder' ? best.name : best.parentPath || best.name} for "${query}" and opened the closest folder.`
    : `I could not find a close file match for "${query}".`;

  return NextResponse.json({
    query,
    openedPath,
    message,
    best,
    results,
  });
}
