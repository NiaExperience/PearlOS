import { NextRequest, NextResponse } from 'next/server';
import { promises as fsp } from 'fs';
import path from 'path';
import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

const USER_ROOT_BASE = '/workspace/user';

const CONTENT_TYPES: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  css: 'text/css; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  gif: 'image/gif',
  html: 'text/plain; charset=utf-8',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain; charset=utf-8',
  webm: 'video/webm',
  webp: 'image/webp',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
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

async function getFilesRoot(req: NextRequest): Promise<string | NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id ? String(session.user.id) : '';
  if (!userId || !isSafeUserId(userId)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = await tenantForSession(req, userId, session?.user);
  if (tenantId instanceof NextResponse) return tenantId;
  const filesRoot = path.join(USER_ROOT_BASE, tenantId, userId, 'Documents');
  await fsp.mkdir(filesRoot, { recursive: true });
  return filesRoot;
}

function resolveUserPath(filesRoot: string, requestedPath: string | null): string | null {
  const raw = String(requestedPath || '').trim();
  const normalizedInput = raw.startsWith(filesRoot)
    ? path.relative(filesRoot, raw)
    : raw.replace(/^\/+/, '');
  const resolved = path.resolve(filesRoot, normalizedInput || '.');
  return isInside(resolved, filesRoot) ? resolved : null;
}

async function assertScopedFile(filesRoot: string, requestedPath: string): Promise<void> {
  const realRoot = await fsp.realpath(filesRoot);
  const stat = await fsp.lstat(requestedPath);
  if (stat.isSymbolicLink()) throw new Error('symlink_forbidden');
  const realRequested = await fsp.realpath(requestedPath);
  if (!isInside(realRequested, realRoot)) throw new Error('access_denied');
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).replace('.', '').toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function downloadName(filePath: string): string {
  return path.basename(filePath).replace(/["\r\n]/g, '');
}

export async function GET(req: NextRequest) {
  const filesRoot = await getFilesRoot(req);
  if (filesRoot instanceof NextResponse) return filesRoot;

  const { searchParams } = new URL(req.url);
  const resolved = resolveUserPath(filesRoot, searchParams.get('path'));
  if (!resolved) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  try {
    await assertScopedFile(filesRoot, resolved);
    const stat = await fsp.stat(resolved);
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 400 });
    }
    const data = await fsp.readFile(resolved);
    return new NextResponse(data, {
      headers: {
        'Cache-Control': 'private, max-age=60',
        'Content-Disposition': `inline; filename="${downloadName(resolved)}"`,
        'Content-Length': String(stat.size),
        'Content-Type': contentTypeFor(resolved),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }
}
