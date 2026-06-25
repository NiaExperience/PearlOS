/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSessionSafely } from "@nia/prism/core/auth";
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from "@interface/lib/auth-config";
import { createBotClaimHeaders } from "@interface/lib/bot-auth-claims";
import { getLogger, setLogContext } from '@interface/lib/logger';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

// Core implementation for /api/bot/join
// Route layer should simply re-export POST_impl as POST.
// Handles both voice-only sessions and DailyCall video sessions.

const BOT_BASE = (process.env.BOT_CONTROL_BASE_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || '').replace(/\/$/, '');
const log = getLogger('[daily_call]');
let didLogJoinRuntimeEnv = false;
const DEFAULT_PUBLIC_TENANT_ID = '00000000-0000-0000-0000-000000000001';

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

function requestedTenantForActor(body: Record<string, unknown>): unknown {
  const requestedTenantId = body?.tenantId ?? body?.tenant_id;
  return requestedTenantId === DEFAULT_PUBLIC_TENANT_ID ? undefined : requestedTenantId;
}

export async function POST_impl(req: NextRequest) {
  if (!didLogJoinRuntimeEnv) {
    didLogJoinRuntimeEnv = true;
    log.info('Bot join runtime env snapshot', {
      event: 'bot_join_runtime_env_snapshot',
      botBasePresent: !!BOT_BASE,
      authRequired: envBool(process.env.BOT_CONTROL_AUTH_REQUIRED, false),
      hasSharedSecret: !!process.env.BOT_CONTROL_SHARED_SECRET,
      hasClaimsSecret: !!process.env.BOT_CONTROL_CLAIMS_SECRET,
      useRedis: process.env.USE_REDIS ?? '<unset>',
      redisUrlPresent: !!process.env.REDIS_URL,
    });
  }
  log.info('Bot proxy join request', {
    event: 'bot_proxy_join_request',
    upstream: BOT_BASE,
  });
  if (!BOT_BASE) {
    return NextResponse.json({ error: 'bot_control_base_unconfigured' }, { status: 500 });
  }
  
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {
    // empty body is fine; server will fill defaults
  }
  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: requestedTenantForActor(body),
  });
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;

  // Keep the raw session only for optional session-id fallbacks.
  const session = await getSessionSafely(req, interfaceAuthOptions).catch(() => null);
  const sessionUser = session?.user as any;
  const headerSessionId = req.headers.get('x-session-id') || undefined;
  const headerUserName = req.headers.get('x-user-name') || undefined;
  const headerUserEmail = req.headers.get('x-user-email') || undefined;

  const resolvedSessionId =
    body?.sessionId ||
    headerSessionId ||
      (session as any)?.sessionId ||
      (sessionUser as any)?.sessionId ||
      `${actor.userId}:${Date.now()}`;

  const resolvedUserId = actor.userId;

  const resolvedUserName = actor.userName || sessionUser?.name || sessionUser?.userName || headerUserName;

  const resolvedUserEmail = actor.userEmail || sessionUser?.email || headerUserEmail;
  const resolvedTenantId = actor.tenantId;
  if (!resolvedTenantId) {
    return NextResponse.json({ error: 'tenant_required' }, { status: 403 });
  }
  log.info('Multitenancy audit context resolved', {
    event: 'multitenancy_audit_join_context',
    tenantId: resolvedTenantId,
    sessionUserId: resolvedUserId,
    sessionId: resolvedSessionId,
    roomUrl: body?.room_url || null,
    hasTenantAccess: true,
  });

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
      sessionUserId: resolvedUserId,
      sessionUserEmail: resolvedUserEmail,
      sessionUserName: resolvedUserName,
      tenantId: resolvedTenantId,
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
      visionMode: enrichedBody.visionMode === true,
      modeConfigKeys: enrichedBody.modePersonalityVoiceConfig ? Object.keys(enrichedBody.modePersonalityVoiceConfig) : [],
      hasSessionOverride: !!enrichedBody.sessionOverride,
      sessionId: enrichedBody.sessionId,
      sessionUserId: enrichedBody.sessionUserId,
      sessionUserEmail: enrichedBody.sessionUserEmail ? 'present' : 'absent',
      sessionUserName: enrichedBody.sessionUserName,
      tenantId: enrichedBody.tenantId,
      debugTraceId,
    });

    const claimHeaders = createBotClaimHeaders({
      tenantId: resolvedTenantId,
      sessionUserId: resolvedUserId,
      sessionId: resolvedSessionId,
      sessionUserEmail: resolvedUserEmail,
      sessionUserName: resolvedUserName,
    });
    const hasBotSecretHeader = !!process.env.BOT_CONTROL_SHARED_SECRET;
    const hasClaimsHeaders = !!(
      claimHeaders['x-bot-claims-ts']
      && claimHeaders['x-bot-claims']
      && claimHeaders['x-bot-claims-sig']
    );
    log.info('Bot join upstream auth headers prepared', {
      event: 'bot_proxy_join_auth_headers_prepared',
      hasBotSecretHeader,
      hasClaimsHeaders,
      tenantId: resolvedTenantId,
      sessionUserId: resolvedUserId,
      sessionId: resolvedSessionId,
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
        ...claimHeaders,
      },
      body: JSON.stringify(enrichedBody),
    });
    const text = await r.text();
    if (!r.ok) {
      let parsedDetail: string | null = null;
      try {
        parsedDetail = JSON.parse(text || '{}')?.detail || null;
      } catch {
        parsedDetail = null;
      }
      log.error('Bot proxy join upstream error', {
        event: 'bot_proxy_join_upstream_error',
        status: r.status,
        parsedDetail,
        hasBotSecretHeader,
        hasClaimsHeaders,
        tenantId: resolvedTenantId,
        sessionUserId: resolvedUserId,
        sessionId: resolvedSessionId,
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
        tenantId: resolvedTenantId,
        sessionUserId: resolvedUserId,
        sessionId: resolvedSessionId,
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
