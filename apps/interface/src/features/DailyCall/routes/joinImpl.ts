/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSessionSafely } from "@nia/prism/core/auth";
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { getLogger, setLogContext } from '@interface/lib/logger';

// Core implementation for /api/bot/join
// Route layer should simply re-export POST_impl as POST.
// Handles both voice-only sessions and DailyCall video sessions.

const BOT_BASE = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');
const log = getLogger('[daily_call]');

function envBool(v: string | undefined, def = false): boolean {
  if (!v) return def;
  const s = v.trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// In-memory map of recent intent ids to their resolved pid to suppress duplicate joins
// This is per server instance (non-durable) but good enough to reduce rapid duplicates.
const recentIntents: Record<string, { pid: number; ts: number; reused: boolean }> = {};
const INTENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

function gcIntents(now: number) {
  for (const k of Object.keys(recentIntents)) {
    if (now - recentIntents[k].ts > INTENT_TTL_MS) delete recentIntents[k];
  }
}

export async function POST_impl(req: NextRequest) {
  log.info('Bot proxy join request', {
    event: 'bot_proxy_join_request',
    upstream: BOT_BASE,
  });
  if (!BOT_BASE) {
    return NextResponse.json({ error: 'bot_control_base_unconfigured' }, { status: 500 });
  }
  
  // Try to get session (optional - some callers may not be authenticated)
  const session = await getSessionSafely(req, interfaceAuthOptions);
  
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    // empty body is fine; server will fill defaults
  }
  const headerSessionId = req.headers.get('x-session-id') || undefined;
  const headerUserId = req.headers.get('x-user-id') || undefined;
  const headerUserName = req.headers.get('x-user-name') || undefined;
  const headerUserEmail = req.headers.get('x-user-email') || undefined;

  const sessionUser = session?.user as any;

  const resolvedSessionId =
    body?.sessionId ||
    headerSessionId ||
    (session as any)?.sessionId ||
    (sessionUser as any)?.sessionId;

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

  setLogContext({
    sessionId: resolvedSessionId ?? null,
    userId: resolvedUserId ?? null,
    userName: resolvedUserName ?? null,
  });
  // Backward-compat: some callers may send `voiceId` instead of `voice`.
  // If so, map it to `voice` so the bot server sees the intended override.
  if (!body?.voice && typeof body?.voiceId === 'string') {
    body.voice = body.voiceId;
  }
  // Extract intent and force_new flags for idempotency logic
  const intent = typeof body.call_intent_id === 'string' ? body.call_intent_id.slice(0, 120) : undefined;
  const forceNew = !!body.force_new;
  const now = Date.now();
  const debugTraceId =
    typeof body?.debugTraceId === 'string' && body.debugTraceId.trim()
      ? body.debugTraceId.trim().slice(0, 120)
      : `botjoin:${now}:${Math.random().toString(36).slice(2, 8)}`;
  body.debugTraceId = debugTraceId;
  if (intent) {
    gcIntents(now);
    const existing = recentIntents[intent];
    if (existing && !forceNew) {
      // Return cached response to enforce idempotency
      return NextResponse.json({ pid: existing.pid, room_url: body.room_url, personality: body.personality, reused: true, intent_reused: true, debugTraceId }, { status: 200 });
    } else if (existing && forceNew) {
      // Explicitly drop old intent mapping so a fresh session can spawn
      delete recentIntents[intent];
    }
  }
  try {
    const authRequired = envBool(process.env.BOT_CONTROL_AUTH_REQUIRED, false);
    const secretPresent = !!process.env.BOT_CONTROL_SHARED_SECRET;
    // Do not log any secret values; presence only.
    log.info('Bot proxy join dispatch', {
      event: 'bot_proxy_join_dispatch',
      authRequired,
      secretPresent,
      persona: typeof body.persona === 'string' ? body.persona : 'default',
      personalityId: typeof body.personalityId === 'string' ? body.personalityId : 'default',
      voice: typeof body.voice === 'string' ? body.voice : (typeof body.voiceId === 'string' ? body.voiceId : 'default'),
      intentPresent: !!intent,
      forceNew,
      debugTraceId,
    });
    // Enrich request with session data if available (for authenticated calls)
    const enrichedBody = {
      ...body,
      // Auto-populate session fields from auth session when present
      sessionUserId: body.sessionUserId || resolvedUserId,
      sessionUserEmail: body.sessionUserEmail || resolvedUserEmail,
      sessionUserName: body.sessionUserName || resolvedUserName,
      tenantId: body.tenantId || (session?.user as any)?.tenant_id,
      // Forward sessionId if provided (Interface/OS session ID)
      ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
      debugTraceId,
    };

    log.info('Bot proxy join payload (sanitized)', {
      personalityId: enrichedBody.personalityId,
      persona: enrichedBody.persona,
      voice: enrichedBody.voice || enrichedBody.voiceId,
      voiceProvider: enrichedBody.voiceProvider,
      hasVoiceParameters: !!enrichedBody.voiceParameters,
      supportedFeatures: enrichedBody.supportedFeatures,
      modeConfigKeys: enrichedBody.modePersonalityVoiceConfig ? Object.keys(enrichedBody.modePersonalityVoiceConfig) : [],
      hasSessionOverride: !!enrichedBody.sessionOverride,
      sessionId: enrichedBody.sessionId,
      sessionUserId: enrichedBody.sessionUserId,
      sessionUserEmail: enrichedBody.sessionUserEmail ? 'present' : 'absent',
      sessionUserName: enrichedBody.sessionUserName,
      tenantId: enrichedBody.tenantId,
      debugTraceId,
    });

    const r = await fetch(BOT_BASE + '/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Server-side secret: never expose to client. Optional header until auth is enforced.
        ...(process.env.BOT_CONTROL_SHARED_SECRET
          ? { 'X-Bot-Secret': process.env.BOT_CONTROL_SHARED_SECRET }
          : {}),
      },
      body: JSON.stringify(enrichedBody),
    });
    const text = await r.text();
    if (!r.ok) {
      log.error('Bot proxy join upstream error', {
        event: 'bot_proxy_join_upstream_error',
        status: r.status,
        body: text || '<no body>',
      });
      return new NextResponse(text || 'upstream_error', { status: r.status });
    }
    // Attempt to augment with intent cache if successful JSON
    try {
      const parsed = JSON.parse(text || '{}');
      log.info('Bot proxy join upstream success', {
        event: 'bot_proxy_join_upstream_success',
        debugTraceId,
        status: parsed?.status,
        session_id: parsed?.session_id,
        pid: parsed?.pid,
        reused: parsed?.reused,
        transitioning: parsed?.transitioning,
        room_url: parsed?.room_url,
      });
      if (intent && parsed && typeof parsed.pid === 'number') {
        recentIntents[intent] = { pid: parsed.pid, ts: now, reused: !!parsed.reused };
      }
    } catch (_) {
      // ignore JSON parse errors
    }
    return new NextResponse(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    log.error('Bot proxy join failed', {
      event: 'bot_proxy_join_failed',
      error: String(e?.message || e),
      hasBody: !!body,
    });
    return NextResponse.json({ error: 'join_proxy_failed', detail: String(e?.message || e) }, { status: 502 });
  }
}
