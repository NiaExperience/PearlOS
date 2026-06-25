import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@interface/lib/api-auth';
import { createBotClaimHeaders } from '@interface/lib/bot-auth-claims';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';

function gatewayHeaders(
  userEmail: string,
  userId: string,
  tenantId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-email': userEmail,
    'x-user-id': userId,
    'x-tenant-id': tenantId,
    'x-pearl-tenant-id': tenantId,
    ...createBotClaimHeaders({
      tenantId,
      sessionUserId: userId,
      sessionUserEmail: userEmail,
      sessionId: `tools-invoke:${tenantId}:${userId}`,
    }),
  };
  if (SHARED_SECRET) {
    headers['X-Bot-Secret'] = SHARED_SECRET;
    headers.Authorization = `Bearer ${SHARED_SECRET}`;
  }
  return headers;
}

function isJsonObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export async function POST(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    if (!isJsonObject(body)) {
      return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 });
    }
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: body?.tenant_id ?? body?.tenantId ?? body?.params?.requester_tenant_id,
    });
    if (!actorResult.ok) return actorResult.response;
    const { tenantId, userEmail, userId } = actorResult.actor;
    const {
      tenant_id: _ignoredTenantId,
      tenantId: _ignoredCamelTenantId,
      user_id: _ignoredUserId,
      userId: _ignoredCamelUserId,
      user_email: _ignoredUserEmail,
      userEmail: _ignoredCamelUserEmail,
      requester_tenant_id: _ignoredRequesterTenantId,
      requester_user_id: _ignoredRequesterUserId,
      requester_email: _ignoredRequesterEmail,
      params: rawParams,
      ...safeBody
    } = body;
    const {
      tenant_id: _ignoredParamTenantId,
      tenantId: _ignoredParamCamelTenantId,
      user_id: _ignoredParamUserId,
      userId: _ignoredParamCamelUserId,
      user_email: _ignoredParamUserEmail,
      userEmail: _ignoredParamCamelUserEmail,
      requester_tenant_id: _ignoredParamRequesterTenantId,
      requester_user_id: _ignoredParamRequesterUserId,
      requester_email: _ignoredParamRequesterEmail,
      ...safeParams
    } = rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams) ? rawParams : {};
    const scopedBody = {
      ...safeBody,
      tenant_id: tenantId,
      user_id: userId,
      user_email: userEmail,
      requester_tenant_id: tenantId,
      requester_user_id: userId,
      requester_email: userEmail,
      params: {
        ...safeParams,
        requester_tenant_id: tenantId,
        requester_user_id: userId,
        requester_email: userEmail,
      },
    };
    const upstream = await fetch(`${BOT_GATEWAY}/api/tools/invoke`, {
      method: 'POST',
      headers: gatewayHeaders(userEmail, userId, tenantId),
      body: JSON.stringify(scopedBody),
      signal: AbortSignal.timeout(30000),
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get('content-type') || 'application/json';
    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': contentType },
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Bot tool gateway unreachable', detail: String(error) },
      { status: 502 },
    );
  }
}
