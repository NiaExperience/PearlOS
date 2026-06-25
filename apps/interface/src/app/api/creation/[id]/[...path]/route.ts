import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { findCreationArtifact, isSafeCreationId, type CreationOwner } from '../../../launchpad/lib/creation-artifacts';
import { projectBelongsToRequester, readProjects } from '../../../launchpad/lib/store';

/**
 * Static file server for generated creations.
 *
 * Serves files from the verified Studio creation output roots. The directory tree
 * is /<root>/<id>/<path> (see
 * /workspace/user/Documents/studio-godot-hosting.md). All requests require
 * an authenticated session.
 *
 * GET /api/creation/<id>/                 -> serves <id>/index.html
 * GET /api/creation/<id>/index.wasm       -> streams <id>/index.wasm
 * GET /api/creation/<id>/assets/foo.png   -> streams <id>/assets/foo.png
 *
 * Path-traversal attempts (e.g. ../) are rejected with 403.
 * Missing files return 404.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.pck': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function isHtml(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.html' || ext === '.htm';
}

function sandboxCsp(): string {
  return [
    'sandbox allow-scripts allow-forms allow-popups allow-downloads',
    "default-src 'self' data: blob: https: http:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https: http:",
    "style-src 'self' 'unsafe-inline' https: http:",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https: http:",
    "media-src 'self' data: blob: https: http:",
    'connect-src https: http: ws: wss:',
    'frame-src https: http:',
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

interface RouteParams {
  params: Promise<{ id: string; path?: string[] }>;
}

async function projectOutputPathForOwner(id: string, owner: CreationOwner): Promise<string | undefined> {
  try {
    const projects = await readProjects();
    const project = projects.find(
      (candidate) =>
        projectBelongsToRequester(candidate, {
          userId: owner.userId || '',
          email: owner.email || '',
          tenantId: owner.tenantId || '',
        }) &&
        (candidate.id === id || candidate.editingCreationId === id),
    );
    return project?.outputPath;
  } catch {
    return undefined;
  }
}

export async function GET(_request: Request, { params }: RouteParams) {
  const actorResult = await resolveInterfaceActorContext();
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;
  const owner = {
    tenantId: actor.tenantId,
    userId: actor.userId,
    email: actor.userEmail,
  };

  let id: string;
  let pathSegments: string[];
  try {
    const resolved = await params;
    id = resolved.id;
    pathSegments = Array.isArray(resolved.path) ? resolved.path : [];
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  // Validate id — no separators, no dots, no empty.
  if (!isSafeCreationId(id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Build the relative path from the [...path] catch-all. Empty / "/" -> index.html.
  const joinedRelative = pathSegments.join('/');
  const relative = !joinedRelative || joinedRelative === '/' ? 'index.html' : joinedRelative;

  let requested: string | null = null;
  let requestedRoot: string | null = null;
  let artifact = await findCreationArtifact(id, undefined, owner);
  if (!artifact) {
    const projectOutputPath = await projectOutputPathForOwner(id, owner);
    if (projectOutputPath) {
      artifact = await findCreationArtifact(id, projectOutputPath, owner);
    }
  }
  if (artifact) {
    const creationRoot = path.resolve(artifact.outputPath);
    const candidate = path.resolve(creationRoot, relative);
    const rootWithSep = creationRoot + path.sep;
    if (candidate !== creationRoot && !candidate.startsWith(rootWithSep)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      const realRoot = await fs.realpath(creationRoot);
      const fileStat = await fs.lstat(candidate);
      if (!fileStat.isSymbolicLink() && fileStat.isFile()) {
        const realFile = await fs.realpath(candidate);
        if (realFile.startsWith(realRoot + path.sep) && realFile !== realRoot) {
          requested = candidate;
          requestedRoot = realRoot;
        }
      }
    } catch {
      requested = null;
      requestedRoot = null;
    }
  }

  if (!requested) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let body: Buffer;
  let stat;
  try {
    stat = await fs.lstat(requested);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const realFile = await fs.realpath(requested);
    if (!requestedRoot || (!realFile.startsWith(requestedRoot + path.sep) && realFile !== requestedRoot)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    body = await fs.readFile(realFile);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', contentTypeFor(requested));
  headers.set('Content-Length', String(stat.size));
  headers.set('Content-Security-Policy', sandboxCsp());
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  // index.html is the only doc that should never be cached aggressively —
  // re-runs of the same creation id are expected to overwrite it. All other
  // assets (wasm/pck/js/icons) are content-addressed enough to cache.
  if (isHtml(requested)) {
    headers.set('Cache-Control', 'no-cache');
  } else {
    headers.set('Cache-Control', 'public, max-age=3600, immutable');
  }

  // Convert Node Buffer to a plain Uint8Array for the Response body to keep
  // TypeScript happy across Node/Edge BodyInit definitions.
  return new NextResponse(new Uint8Array(body), { status: 200, headers });
}
