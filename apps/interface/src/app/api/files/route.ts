import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';
import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

export interface FSEntry {
  name: string;
  kind: 'folder' | 'file';
  path: string;
  parentPath: string;
  size?: string;
  sizeBytes?: number;
  ext?: string;
  modifiedAt?: string;
}

const USER_ROOT_BASE = '/workspace/user';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getExt(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot === -1 || dot === 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

function isSafeUserId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function isSafeName(name: string): boolean {
  return Boolean(name.trim()) && !/[\\/:*?"<>|]/.test(name) && name.length <= 120;
}

function isInside(candidate: string, root: string): boolean {
  const resolved = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
}

async function tenantForSession(req: NextRequest, userId: string, sessionUser: any): Promise<string | NextResponse> {
  const requested = new URL(req.url).searchParams.get('tenantId') || new URL(req.url).searchParams.get('tenant_id');
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

async function getFilesRoot(req: NextRequest): Promise<{ userId: string; tenantId: string; filesRoot: string } | NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id ? String(session.user.id) : '';
  if (!userId || !isSafeUserId(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = await tenantForSession(req, userId, session?.user);
  if (tenantId instanceof NextResponse) return tenantId;
  const filesRoot = path.join(USER_ROOT_BASE, tenantId, userId, 'Documents');
  await fsp.mkdir(filesRoot, { recursive: true });
  return { userId, tenantId, filesRoot };
}

function resolveUserPath(filesRoot: string, requestedPath: string | null | undefined): string | null {
  const raw = String(requestedPath || '').trim();
  const normalizedInput = raw.startsWith(filesRoot)
    ? path.relative(filesRoot, raw)
    : raw.replace(/^\/+/, '');
  const resolved = path.resolve(filesRoot, normalizedInput || '.');
  return isInside(resolved, filesRoot) ? resolved : null;
}

function toRelativePath(filesRoot: string, fullPath: string): string {
  return path.relative(filesRoot, fullPath).split(path.sep).filter(Boolean).join('/');
}

function entryFromStat(filesRoot: string, fullPath: string, name: string, stat: fs.Stats): FSEntry {
  const relativePath = toRelativePath(filesRoot, fullPath);
  const parentPath = toRelativePath(filesRoot, path.dirname(fullPath));
  if (stat.isDirectory()) {
    return {
      name,
      kind: 'folder',
      path: relativePath,
      parentPath,
      modifiedAt: stat.mtime.toISOString(),
    };
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

async function writeUploadFiles(filesRoot: string, targetDir: string, form: FormData): Promise<number> {
  const files = form.getAll('files').filter((value): value is File => value instanceof File);
  if (files.length === 0) throw new Error('No files provided');
  for (const file of files) {
    if (!isSafeName(file.name)) throw new Error(`Invalid file name: ${file.name}`);
    const destination = path.resolve(targetDir, file.name);
    if (!isInside(destination, filesRoot)) throw new Error('Access denied');
    await assertScopedExistingPath(filesRoot, targetDir);
    try {
      const existing = await fsp.lstat(destination);
      if (existing.isSymbolicLink()) throw new Error('Refusing to overwrite symlink');
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const data = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(destination, data);
  }
  return files.length;
}

async function assertScopedExistingPath(filesRoot: string, requestedPath: string): Promise<void> {
  const realRoot = await fsp.realpath(filesRoot);
  const stat = await fsp.lstat(requestedPath);
  if (stat.isSymbolicLink()) throw new Error('Symlinks are not allowed in FileSpace paths');
  const realRequested = await fsp.realpath(requestedPath);
  if (!isInside(realRequested, realRoot)) throw new Error('Access denied');
}

async function assertParentScopedForCreate(filesRoot: string, requestedPath: string): Promise<void> {
  if (!isInside(requestedPath, filesRoot)) throw new Error('Access denied');
  let parent = path.resolve(requestedPath);
  while (parent !== path.dirname(parent)) {
    try {
      await fsp.lstat(parent);
      await assertScopedExistingPath(filesRoot, parent);
      return;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
  }
  throw new Error('Access denied');
}

export async function GET(req: NextRequest) {
  const root = await getFilesRoot(req);
  if (root instanceof NextResponse) return root;
  const { searchParams } = new URL(req.url);
  const resolved = resolveUserPath(root.filesRoot, searchParams.get('path'));
  if (!resolved) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  let stat: fs.Stats;
  try {
    await assertScopedExistingPath(root.filesRoot, resolved);
    stat = await fsp.stat(resolved);
  } catch {
    return NextResponse.json({ error: 'Path not found' }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'Not a directory' }, { status: 400 });
  }

  const dirents = await fsp.readdir(resolved, { withFileTypes: true });
  const entries = (
    await Promise.all(
      dirents.map(async (dirent): Promise<FSEntry | null> => {
        try {
          if (dirent.isSymbolicLink()) return null;
          const fullPath = path.join(resolved, dirent.name);
          await assertScopedExistingPath(root.filesRoot, fullPath);
          return entryFromStat(root.filesRoot, fullPath, dirent.name, await fsp.stat(fullPath));
        } catch {
          return null;
        }
      }),
    )
  ).filter((entry): entry is FSEntry => Boolean(entry));

  return NextResponse.json({
    path: toRelativePath(root.filesRoot, resolved),
    home: '',
    relativePath: toRelativePath(root.filesRoot, resolved),
    entries,
  });
}

export async function POST(req: NextRequest) {
  const root = await getFilesRoot(req);
  if (root instanceof NextResponse) return root;

  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const targetDir = resolveUserPath(root.filesRoot, String(form.get('path') || ''));
      if (!targetDir) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      await assertParentScopedForCreate(root.filesRoot, targetDir);
      await fsp.mkdir(targetDir, { recursive: true });
      const count = await writeUploadFiles(root.filesRoot, targetDir, form);
      return NextResponse.json({ ok: true, uploaded: count });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '').trim();
    const targetDir = resolveUserPath(root.filesRoot, body.path);
    if (!targetDir) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    if (action !== 'mkdir') return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    const name = String(body.name || '').trim();
    if (!isSafeName(name)) return NextResponse.json({ error: 'Invalid folder name' }, { status: 400 });
    const destination = path.resolve(targetDir, name);
    if (!isInside(destination, root.filesRoot)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    await assertParentScopedForCreate(root.filesRoot, destination);
    await assertScopedExistingPath(root.filesRoot, targetDir);
    await fsp.mkdir(destination, { recursive: false });
    return NextResponse.json({ ok: true, path: toRelativePath(root.filesRoot, destination) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message || 'File operation failed' }, { status: 500 });
  }
}
