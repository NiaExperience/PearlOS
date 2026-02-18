import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';

const BOT_BASE = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');

const log = getLogger('[api_bot_config]');

export async function POST(req: NextRequest) {
  if (!BOT_BASE) {
    return NextResponse.json({ error: 'bot_control_base_unconfigured' }, { status: 500 });
  }

  // Try to get session (optional - some callers may not be authenticated)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const session = await getSessionSafely(req, interfaceAuthOptions);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    // empty body is fine
  }

  const headerSessionId = req.headers.get('x-session-id') || undefined;
  const headerRoomUrl = req.headers.get('x-room-url') || undefined;
  const headerUserId = req.headers.get('x-user-id') || undefined;
  const headerUserName = req.headers.get('x-user-name') || undefined;
  const headerUserEmail = req.headers.get('x-user-email') || undefined;

  const resolvedSessionId =
    body?.sessionId ||
    headerSessionId ||
    (session as any)?.sessionId ||
    (session?.user as any)?.sessionId;

  const sessionUser = session?.user as any;

  const resolvedUserId =
    body?.sessionUserId ||
    headerUserId ||
    sessionUser?.id ||
    (session as any)?.userId;

  const resolvedUserName =
    body?.sessionUserName ||
    headerUserName ||
    sessionUser?.name ||
    sessionUser?.userName ||
    (session as any)?.userName;

  const resolvedUserEmail =
    body?.sessionUserEmail ||
    headerUserEmail ||
    sessionUser?.email ||
    (session as any)?.userEmail;

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

  body = {
    ...body,
    ...(resolvedRoomUrl ? { room_url: resolvedRoomUrl } : {}),
    ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
    ...(resolvedUserId ? { sessionUserId: resolvedUserId } : {}),
    ...(resolvedUserName ? { sessionUserName: resolvedUserName } : {}),
    ...(resolvedUserEmail ? { sessionUserEmail: resolvedUserEmail } : {}),
  };

  log.info('Config request forwarded to bot control', {
    url: `${BOT_BASE}/config`,
    roomUrl: body?.room_url,
    sessionId: resolvedSessionId,
    userId: resolvedUserId,
  });

  try {
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
