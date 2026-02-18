import { NextRequest, NextResponse } from 'next/server';

import { getLogger, setLogContext } from '@interface/lib/logger';

// Core implementation for /api/bot/leave
// Route layer should simply re-export POST_impl as POST.
// Clears pending config from Redis to prevent stale sprite/voice config
// from affecting the next session in the same room.

const BOT_BASE = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');
const log = getLogger('[daily_call]');

export async function POST_impl(req: NextRequest) {
  log.info('Bot proxy leave request', {
    event: 'bot_proxy_leave_request',
    upstream: BOT_BASE,
  });
  if (!BOT_BASE) {
    return NextResponse.json({ error: 'bot_control_base_unconfigured' }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    // empty body is fine
  }

  if (!body?.room_url) {
    return NextResponse.json({ error: 'room_url_required' }, { status: 400 });
  }

  const headerSessionId = req.headers.get('x-session-id') || undefined;
  const headerUserId = req.headers.get('x-user-id') || undefined;

  setLogContext({
    sessionId: headerSessionId ?? null,
    userId: headerUserId ?? null,
  });

  try {
    log.info('Bot proxy leave dispatch', {
      event: 'bot_proxy_leave_dispatch',
      roomUrl: body.room_url,
    });

    const r = await fetch(BOT_BASE + '/leave', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Server-side secret: never expose to client. Optional header until auth is enforced.
        ...(process.env.BOT_CONTROL_SHARED_SECRET
          ? { 'X-Bot-Secret': process.env.BOT_CONTROL_SHARED_SECRET }
          : {}),
        // Forward session context headers
        ...(headerSessionId ? { 'x-session-id': headerSessionId } : {}),
        ...(headerUserId ? { 'x-user-id': headerUserId } : {}),
      },
      body: JSON.stringify({ room_url: body.room_url }),
    });

    const text = await r.text();
    if (!r.ok) {
      log.error('Bot proxy leave upstream error', {
        event: 'bot_proxy_leave_upstream_error',
        status: r.status,
        body: text || '<no body>',
      });
      return new NextResponse(text || 'upstream_error', { status: r.status });
    }

    log.info('Bot proxy leave success', {
      event: 'bot_proxy_leave_success',
      roomUrl: body.room_url,
    });

    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.error('Bot proxy leave failed', {
      event: 'bot_proxy_leave_failed',
      error: errorMessage,
      roomUrl: body.room_url,
    });
    return NextResponse.json({ error: 'leave_proxy_failed', detail: errorMessage }, { status: 502 });
  }
}
