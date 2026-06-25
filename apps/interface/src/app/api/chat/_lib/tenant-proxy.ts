import type { NextRequest } from 'next/server';

import type { InterfaceActorContext } from '@interface/lib/tenant-actor';
import { createBotClaimHeaders } from '@interface/lib/bot-auth-claims';

export function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function searchParamsFor(req: Pick<NextRequest, 'url'> & Partial<Pick<NextRequest, 'nextUrl'>>): URLSearchParams {
  if (req.nextUrl?.searchParams) return req.nextUrl.searchParams;
  return new URL(req.url).searchParams;
}

export function requestedTenantFromSearch(req: Pick<NextRequest, 'url'> & Partial<Pick<NextRequest, 'nextUrl'>>): string | undefined {
  const params = searchParamsFor(req);
  return cleanString(params.get('tenantId')) || cleanString(params.get('tenant_id')) || undefined;
}

export function requestedTenantFromBody(body: unknown): string | undefined {
  if (!isPlainObject(body)) return undefined;
  return (
    cleanString(body.tenantId) ||
    cleanString(body.tenant_id) ||
    cleanString(body.requester_tenant_id) ||
    undefined
  );
}

export function chatGatewayHeaders(actor: InterfaceActorContext): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-email': actor.userEmail,
    'x-user-id': actor.userId,
    'x-user-name': actor.userName,
    'x-tenant-id': actor.tenantId,
    'x-pearl-tenant-id': actor.tenantId,
    ...createBotClaimHeaders({
      tenantId: actor.tenantId,
      sessionUserId: actor.userId,
      sessionUserEmail: actor.userEmail,
      sessionUserName: actor.userName,
      sessionId: `web-chat:${actor.tenantId}:${actor.userId}`,
    }),
  };

  const secret = process.env.BOT_CONTROL_SHARED_SECRET || '';
  if (secret) {
    headers['X-Bot-Secret'] = secret;
    headers.Authorization = `Bearer ${secret}`;
  }

  return headers;
}

export function scopedBody(body: Record<string, unknown>, actor: InterfaceActorContext): Record<string, unknown> {
  const {
    tenantId: _ignoredTenantId,
    tenant_id: _ignoredTenantSnake,
    requester_tenant_id: _ignoredRequesterTenantId,
    requester_user_id: _ignoredRequesterUserId,
    requester_email: _ignoredRequesterEmail,
    user_id: _ignoredUserId,
    user_email: _ignoredUserEmail,
    sessionUserId: _ignoredSessionUserId,
    sessionUserEmail: _ignoredSessionUserEmail,
    sessionUserName: _ignoredSessionUserName,
    ...safeBody
  } = body;

  return {
    ...safeBody,
    tenantId: actor.tenantId,
    tenant_id: actor.tenantId,
    requester_tenant_id: actor.tenantId,
    requester_user_id: actor.userId,
    requester_email: actor.userEmail,
    user_id: actor.userId,
    user_email: actor.userEmail,
    sessionUserId: actor.userId,
    sessionUserEmail: actor.userEmail,
    sessionUserName: actor.userName,
  };
}
