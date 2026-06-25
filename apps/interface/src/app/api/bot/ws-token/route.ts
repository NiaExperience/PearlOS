import { NextRequest, NextResponse } from 'next/server';

import { createGatewayWsToken } from '@interface/lib/bot-auth-claims';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

function clean(value: string | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const requestedTenantId = clean(url.searchParams.get('tenantId')) || clean(url.searchParams.get('tenant_id'));
  const requestedSessionId = clean(url.searchParams.get('sessionId')) || clean(url.searchParams.get('session_id'));

  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: requestedTenantId || undefined,
  });
  if (!actorResult.ok) return actorResult.response;

  const actor = actorResult.actor;
  const sessionId = requestedSessionId || actor.userId;
  const { token, expiresAt } = createGatewayWsToken({
    tenantId: actor.tenantId,
    sessionUserId: actor.userId,
    sessionUserEmail: actor.userEmail,
    sessionUserName: actor.userName,
    sessionId,
    allowedScopes: [sessionId, actor.userId],
  });

  return NextResponse.json(
    {
      token,
      expiresAt,
      sessionId,
      userId: actor.userId,
      tenantId: actor.tenantId,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
