import { NextRequest, NextResponse } from 'next/server';

import { createBotClaimHeaders } from '@interface/lib/bot-auth-claims';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

const OPENCLAW_BASE = process.env.OPENCLAW_GATEWAY_URL ?? 'http://localhost:18789';

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return NextResponse.json({ error: 'openclaw_proxy_mutation_disabled' }, { status: 405 });
  }

  const { path } = await params;
  const url = new URL(request.url);
  const requestedTenantId = clean(url.searchParams.get('tenantId')) || clean(url.searchParams.get('tenant_id'));
  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: requestedTenantId || undefined,
  });
  if (!actorResult.ok) return actorResult.response;
  const actor = actorResult.actor;

  const targetPath = path.map((part) => encodeURIComponent(part)).join('/');
  const targetUrl = new URL(targetPath, `${OPENCLAW_BASE.replace(/\/$/, '')}/`);
  targetUrl.search = url.search;
  targetUrl.searchParams.delete('tenantId');
  targetUrl.searchParams.delete('tenant_id');
  targetUrl.searchParams.delete('sessionId');
  targetUrl.searchParams.delete('session_id');

  const sessionId = actor.userId;

  const headers: Record<string, string> = {
    'Accept': request.headers.get('accept') || 'application/json',
    'x-user-id': actor.userId,
    'x-user-email': actor.userEmail,
    'x-user-name': actor.userName,
    'x-tenant-id': actor.tenantId,
    'x-session-id': sessionId,
    ...createBotClaimHeaders({
      tenantId: actor.tenantId,
      sessionUserId: actor.userId,
      sessionUserEmail: actor.userEmail,
      sessionUserName: actor.userName,
      sessionId,
    }),
  };

  const contentType = request.headers.get('content-type');
  if (contentType) headers['Content-Type'] = contentType;

  const apiKey = clean(process.env.OPENCLAW_API_KEY);
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(30000),
    };

    const response = await fetch(targetUrl, fetchOptions);

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      if (!['transfer-encoding', 'connection'].includes(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'OpenClaw gateway unreachable', detail: String(error) },
      { status: 502 }
    );
  }
}

export const GET = proxy;

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
