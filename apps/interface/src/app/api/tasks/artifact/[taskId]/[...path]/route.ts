import fs from 'fs/promises';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

import {
  resolveInterfaceActorContext,
  type InterfaceActorContext,
} from '@interface/lib/tenant-actor';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';

function publicTaskRoot(): string {
  return process.env.PEARL_PUBLIC_TASK_ROOT || '/srv/pearl-user-workspaces';
}

function authHeaders(actor?: InterfaceActorContext): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SHARED_SECRET) {
    h['X-Bot-Secret'] = SHARED_SECRET;
    h.Authorization = `Bearer ${SHARED_SECRET}`;
  }
  if (actor) {
    h['X-User-Id'] = actor.userId;
    h['X-User-Email'] = actor.userEmail;
    h['X-Pearl-Tenant-Id'] = actor.tenantId;
  }
  return h;
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function taskTenantId(task: Record<string, unknown>): string {
  return cleanString(task.requester_tenant_id || task.requesterTenantId);
}

function taskBelongsToActor(task: Record<string, unknown>, actor: InterfaceActorContext): boolean {
  const requesterUserId = String(task.requester_user_id || task.requesterUserId || '');
  const requesterEmail = String(task.requester_email || task.requesterEmail || '').toLowerCase();
  const requesterTenantId = taskTenantId(task);
  const userMatches = requesterUserId === actor.userId || requesterEmail === actor.userEmail;
  return requesterTenantId === actor.tenantId && userMatches;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.wasm') return 'application/wasm';
  return 'application/octet-stream';
}

function sandboxHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy': [
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
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
  };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ taskId: string; path?: string[] }> },
) {
  const params = await ctx.params;
  const taskId = params.taskId;
  const relParts = params.path || ['index.html'];
  if (!taskId || relParts.some((part) => part === '..' || part.includes('/') || part.includes('\\'))) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  const actorResult = await resolveInterfaceActorContext({ request: req });
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;

  const upstream = await fetch(`${BOT_GATEWAY}/api/tasks/${encodeURIComponent(taskId)}`, {
    headers: authHeaders(actor),
    cache: 'no-store',
  });
  if (upstream.status === 404) return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  if (!upstream.ok) return NextResponse.json({ error: 'upstream_error' }, { status: upstream.status });

  const data = await upstream.json();
  const task = data?.task as Record<string, unknown> | undefined;
  if (!task) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!taskBelongsToActor(task, actor)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const workspace = typeof task.workspace_path === 'string' ? task.workspace_path : '';
  const root = path.resolve(publicTaskRoot());
  const workspacePath = path.resolve(workspace);
  if (!workspacePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'invalid_workspace' }, { status: 403 });
  }
  const realRoot = await fs.realpath(root).catch(() => root);
  const realWorkspace = await fs.realpath(workspacePath).catch(() => '');
  if (!realWorkspace || !realWorkspace.startsWith(realRoot + path.sep)) {
    return NextResponse.json({ error: 'invalid_workspace' }, { status: 403 });
  }

  const filePath = path.resolve(workspacePath, ...relParts);
  if (!filePath.startsWith(workspacePath + path.sep) && filePath !== workspacePath) {
    return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
  }

  try {
    const fileStat = await fs.lstat(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
    }
    const realFile = await fs.realpath(filePath);
    if (!realFile.startsWith(realWorkspace + path.sep) && realFile !== realWorkspace) {
      return NextResponse.json({ error: 'invalid_path' }, { status: 400 });
    }
    const body = await fs.readFile(realFile);
    return new NextResponse(body, {
      headers: {
        ...sandboxHeaders(),
        'Content-Type': contentTypeFor(realFile),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
  }
}
