import { NextRequest, NextResponse } from 'next/server';

import { createBotClaimHeaders } from '@interface/lib/bot-auth-claims';
import { getLogger, setLogContext } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const BOT_BASE = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');

const log = getLogger('[api_bot_config]');

export async function POST(req: NextRequest) {
  if (!BOT_BASE) {
    return NextResponse.json({ error: 'bot_control_base_unconfigured' }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    // empty body is fine
  }

  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: body?.tenantId ?? body?.tenant_id,
  });
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;

  const headerSessionId = req.headers.get('x-session-id') || undefined;
  const headerRoomUrl = req.headers.get('x-room-url') || undefined;

  const resolvedSessionId =
    body?.sessionId ||
    headerSessionId ||
    body?.session_id;

  const resolvedUserId =
    actor.userId;

  const resolvedUserName =
    actor.userName;

  const resolvedUserEmail =
    actor.userEmail;
  const resolvedTenantId = actor.tenantId;
  log.info('Multitenancy audit context resolved', {
    event: 'multitenancy_audit_config_context',
    tenantId: resolvedTenantId,
    sessionUserId: resolvedUserId,
    sessionId: resolvedSessionId,
    roomUrl: body?.room_url || body?.roomUrl || null,
    hasTenantAccess: true,
  });

  const resolvedRoomUrl = body?.room_url || body?.roomUrl || headerRoomUrl;

  if (!resolvedRoomUrl) {
    log.warn('Config request missing room_url');
    return NextResponse.json({ error: 'room_url_required' }, { status: 400 });
  }

  setLogContext({
    sessionId: resolvedSessionId ?? null,
    userId: resolvedUserId ?? null,
    userName: resolvedUserName ?? null,
  });

  const safeBody = { ...body };
  for (const key of [
    'tenantId',
    'tenant_id',
    'requester_user_id',
    'requester_email',
    'requester_tenant_id',
    'sessionUserId',
    'session_user_id',
    'sessionUserEmail',
    'session_user_email',
    'sessionUserName',
    'session_user_name',
  ]) {
    delete safeBody[key];
  }

  body = {
    ...safeBody,
    ...(resolvedRoomUrl ? { room_url: resolvedRoomUrl } : {}),
    ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
    ...(resolvedUserId ? { sessionUserId: resolvedUserId } : {}),
    ...(resolvedUserName ? { sessionUserName: resolvedUserName } : {}),
    ...(resolvedUserEmail ? { sessionUserEmail: resolvedUserEmail } : {}),
    tenantId: resolvedTenantId,
  };

  log.info('Config request forwarded to bot control', {
    url: `${BOT_BASE}/config`,
    roomUrl: body?.room_url,
    sessionId: resolvedSessionId,
    userId: resolvedUserId,
  });

  try {
    const claimHeaders = createBotClaimHeaders({
      tenantId: resolvedTenantId,
      sessionUserId: resolvedUserId,
      sessionId: resolvedSessionId,
      sessionUserEmail: resolvedUserEmail,
      sessionUserName: resolvedUserName,
    });

    const r = await fetch(BOT_BASE + '/config', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Server-side secret: never expose to client. Optional header until auth is enforced.
        ...(process.env.BOT_CONTROL_SHARED_SECRET
          ? { 'X-Bot-Secret': process.env.BOT_CONTROL_SHARED_SECRET }
          : {}),
        ...(resolvedSessionId ? { 'x-session-id': resolvedSessionId } : {}),
        ...(resolvedUserId ? { 'x-user-id': resolvedUserId } : {}),
        ...(resolvedUserName ? { 'x-user-name': resolvedUserName } : {}),
        ...(resolvedUserEmail ? { 'x-user-email': resolvedUserEmail } : {}),
        ...claimHeaders,
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) {
      log.error('Bot config upstream error', { status: r.status, body: text || '<no body>' });
      return new NextResponse(text || 'upstream_error', { status: r.status });
    }
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
    log.error('Bot config proxy failed', {
      error: e,
      url: BOT_BASE + '/config',
      body: JSON.stringify(body),
    });
    return NextResponse.json({ error: 'config_proxy_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
