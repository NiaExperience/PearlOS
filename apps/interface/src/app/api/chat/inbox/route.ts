import { NextRequest, NextResponse } from 'next/server';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import { chatGatewayHeaders, requestedTenantFromSearch } from '../_lib/tenant-proxy';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');

export async function GET(req: NextRequest) {
  const actorResult = await resolveInterfaceActorContext({
    requestedTenantId: requestedTenantFromSearch(req),
  });
  if (!actorResult.ok) return actorResult.response;

  try {
    const r = await fetch(`${BOT_GATEWAY}/api/chat/inbox`, {
      headers: chatGatewayHeaders(actorResult.actor),
      cache: 'no-store',
    });
    if (!r.ok) {
      return NextResponse.json({ unread_count: 0, messages: [] }, { status: 200 });
    }
    const data = await r.json();
    return NextResponse.json({
      unread_count: data?.unread_count ?? 0,
      messages: Array.isArray(data?.messages) ? data.messages : [],
    });
  } catch {
    return NextResponse.json({ unread_count: 0, messages: [] }, { status: 200 });
  }
}
