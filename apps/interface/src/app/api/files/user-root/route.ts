import { getSessionSafely } from '@nia/prism/core/auth';
import { getUserTenantRoles } from '@nia/prism/core/actions/tenant-actions';
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_files_user_root]');

const FILEBROWSER_ROOT = '/workspace/user';

/** Only hex / alphanumeric user ids; no traversal characters. */
function isSafeUserId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

async function tenantForSession(req: NextRequest, userId: string, sessionUser: any): Promise<string | NextResponse> {
  const params = new URL(req.url).searchParams;
  const requested = params.get('tenantId') || params.get('tenant_id');
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

/**
 * GET /api/files/user-root
 * Returns the per-user root directory, creating it on first access.
 * Response: { userId, relativePath, filebrowserUrl }
 */
export async function GET(req: NextRequest) {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id ? String(session.user.id) : '';
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isSafeUserId(userId)) {
    log.warn('Rejected unsafe userId for filebrowser root', { userId });
    return NextResponse.json({ error: 'invalid_user_id' }, { status: 400 });
  }
  const tenantId = await tenantForSession(req, userId, session?.user);
  if (tenantId instanceof NextResponse) return tenantId;

  const userDir = path.join(FILEBROWSER_ROOT, tenantId, userId);
  const docsDir = path.join(userDir, 'Documents');

  try {
    await fs.mkdir(docsDir, { recursive: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    log.error('Failed to create per-user filebrowser dir', { userId, docsDir, detail });
    return NextResponse.json({ error: 'mkdir_failed', detail }, { status: 500 });
  }

  const relativePath = `${tenantId}/${userId}/Documents`;
  return NextResponse.json({
    userId,
    tenantId,
    relativePath,
    filebrowserUrl: `/filebrowser/files/${encodeURIComponent(tenantId)}/${encodeURIComponent(userId)}/Documents/`,
  });
}
