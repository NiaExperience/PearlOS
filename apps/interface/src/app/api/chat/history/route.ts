import { NextRequest } from 'next/server';
import { requireAuth } from '@interface/lib/api-auth';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import {
  chatGatewayHeaders,
  requestedTenantFromSearch,
  searchParamsFor,
} from '../_lib/tenant-proxy';

const BOT_GATEWAY_URL = process.env.BOT_GATEWAY_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';

export async function GET(req: NextRequest) {
  const authError = await requireAuth(req);
  if (authError) return authError;
  try {
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: requestedTenantFromSearch(req),
    });
    if (!actorResult.ok) return actorResult.response;

    const searchParams = searchParamsFor(req);
    const limit = searchParams.get('limit') || '50';
    const before = searchParams.get('before') || '';

    const params = new URLSearchParams({ limit });
    if (before) params.set('before', before);

    const upstream = await fetch(`${BOT_GATEWAY_URL}/api/chat/history?${params}`, {
      method: 'GET',
      headers: chatGatewayHeaders(actorResult.actor),
    });

    if (!upstream.ok) {
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await upstream.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ messages: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
