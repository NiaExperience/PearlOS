import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { requireAuth } from '@interface/lib/api-auth';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

export const maxDuration = 65;

const BOT_GATEWAY_URL = process.env.BOT_GATEWAY_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';
const DEFAULT_CHAT_UPLOAD_ROOT = '/home/deploy/pearlos/user-data/chat-uploads';
const DEFAULT_USER_ROOT = '/workspace/user';
const STORED_IMAGE_MAX_BYTES = Number(process.env.CHAT_STORED_IMAGE_MAX_BYTES || 20 * 1024 * 1024);

function gatewayHeaders(
  userEmail: string,
  userId: string,
  tenantId: string,
  userName: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-email': userEmail,
    'x-user-id': userId,
    'x-tenant-id': tenantId,
    'x-pearl-tenant-id': tenantId,
  };
  if (userName) {
    headers['x-user-name'] = userName;
  }
  if (SHARED_SECRET) {
    headers['X-Bot-Secret'] = SHARED_SECRET;
    headers.Authorization = `Bearer ${SHARED_SECRET}`;
  }
  return headers;
}

function isJsonObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function chatUploadRoot(): string {
  return process.env.CHAT_UPLOAD_DIR || DEFAULT_CHAT_UPLOAD_ROOT;
}

function userRootBase(): string {
  return process.env.PEARLOS_USER_ROOT || DEFAULT_USER_ROOT;
}

function safeStorageSegment(value: string): string {
  return /^[A-Za-z0-9_-]{1,160}$/.test(value) ? value : '';
}

function messageHasImagePart(content: unknown): boolean {
  return Array.isArray(content) && content.some((part) => {
    if (!isJsonObject(part) || part.type !== 'image_url') return false;
    const imageUrl = part.image_url;
    if (typeof imageUrl === 'string') return imageUrl.length > 0;
    return isJsonObject(imageUrl) && typeof imageUrl.url === 'string' && imageUrl.url.length > 0;
  });
}

function imageMimeFromFilename(filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.bmp':
      return 'image/bmp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    default:
      return null;
  }
}

function extractStoredImageReference(text: string): { storedPath: string; mime: string } | null {
  const storedPath = text.match(/^(?:Stored path|Workspace path|Path):\s*(.+)$/im)?.[1]?.trim();
  if (!storedPath) return null;

  const explicitKind = text.match(/^Kind:\s*([^\s]+)/im)?.[1]?.trim().toLowerCase();
  if (explicitKind && explicitKind !== 'image') return null;

  const explicitMime = text.match(/^MIME:\s*([^\s;]+)/im)?.[1]?.trim().toLowerCase();
  if (explicitMime && !explicitMime.startsWith('image/')) return null;

  const kindIsImage = explicitKind === 'image';
  const inferredMime = imageMimeFromFilename(storedPath);
  const mime = explicitMime || inferredMime;
  if (!mime || (!mime.startsWith('image/') && !kindIsImage)) return null;
  return { storedPath, mime };
}

function scopedImageRoots(tenantId: string, userId: string): string[] {
  const roots = [chatUploadRoot()];
  const tenant = safeStorageSegment(tenantId);
  const user = safeStorageSegment(userId);
  if (tenant && user) {
    roots.push(path.join(userRootBase(), tenant, user));
  }
  return roots;
}

async function storedImageDataUrlFromText(text: string, allowedRoots: string[]): Promise<string | null> {
  const ref = extractStoredImageReference(text);
  if (!ref) return null;

  const resolved = path.resolve(ref.storedPath);
  const insideAllowedRoot = allowedRoots.some((candidateRoot) => {
    const root = path.resolve(candidateRoot);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  });
  if (!insideAllowedRoot) {
    console.warn('[chat/route] Ignoring stored image outside upload root', { storedPath: ref.storedPath });
    return null;
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > STORED_IMAGE_MAX_BYTES) return null;
  const buf = await fs.readFile(resolved);
  return `data:${ref.mime};base64,${buf.toString('base64')}`;
}

async function addStoredImageFallbacks(messages: unknown, tenantId: string, userId: string): Promise<unknown> {
  if (!Array.isArray(messages)) return messages;

  let changed = false;
  const next = await Promise.all(messages.map(async (message) => {
    if (!isJsonObject(message) || message.role !== 'user') return message;
    if (messageHasImagePart(message.content)) return message;

    const content = message.content;
    const text = typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => (isJsonObject(part) && typeof part.text === 'string' ? part.text : ''))
            .filter(Boolean)
            .join('\n')
        : '';
    if (!text) return message;

    try {
      const dataUrl = await storedImageDataUrlFromText(text, scopedImageRoots(tenantId, userId));
      if (!dataUrl) return message;
      changed = true;
      return {
        ...message,
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      };
    } catch (err) {
      console.warn('[chat/route] Failed to attach stored image fallback', {
        error: err instanceof Error ? err.message : String(err),
      });
      return message;
    }
  }));

  return changed ? next : messages;
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    const body = await req.json();
    if (!isJsonObject(body)) {
      return new Response(JSON.stringify({ error: 'Request body must be an object' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: body?.tenantId ?? body?.tenant_id ?? body?.requester_tenant_id,
    });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userEmail, userId, userName } = actorResult.actor;
    const {
      requester_tenant_id: _ignoredRequesterTenantId,
      requester_user_id: _ignoredRequesterUserId,
      requester_email: _ignoredRequesterEmail,
      user_id: _ignoredUserId,
      user_email: _ignoredUserEmail,
      ...safeBody
    } = body;
    const safeMessages = await addStoredImageFallbacks(safeBody.messages, tenantId, userId);
    const scopedBody = {
      ...safeBody,
      messages: safeMessages,
      tenantId,
      tenant_id: tenantId,
      requester_tenant_id: tenantId,
      requester_user_id: userId,
      requester_email: userEmail,
      user_id: userId,
      user_email: userEmail,
      sessionUserId: userId,
      sessionUserEmail: userEmail,
      sessionUserName: userName,
    };

    const timeoutMs = 60_000;
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      console.error('[chat/route] Webchat downstream timeout after 60s');
      timeoutController.abort();
    }, timeoutMs);

    let upstream: Response;
    try {
      upstream = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
        method: 'POST',
        headers: gatewayHeaders(userEmail, userId, tenantId, userName),
        body: JSON.stringify(scopedBody),
        signal: timeoutController.signal,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        return new Response(
          `data: ${JSON.stringify({ error: 'Webchat downstream timeout after 60s. The gateway did not respond in time.' })}\n\n`,
          {
            status: 200,
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            },
          },
        );
      }
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
        status: upstream.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stream the SSE response through
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
