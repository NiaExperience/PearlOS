import { NextRequest, NextResponse } from 'next/server';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';
import {
  chatGatewayHeaders,
  isPlainObject,
  requestedTenantFromBody,
  requestedTenantFromSearch,
  scopedBody,
} from '../../_lib/tenant-proxy';

const BOT_GATEWAY = (process.env.BOT_GATEWAY_URL || 'http://localhost:4444').replace(/\/$/, '');

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const actorResult = await resolveInterfaceActorContext({
      requestedTenantId: requestedTenantFromBody(body) || requestedTenantFromSearch(req),
    });
    if (!actorResult.ok) return actorResult.response;

    const r = await fetch(`${BOT_GATEWAY}/api/chat/inbox/mark-read`, {
      method: 'POST',
      headers: chatGatewayHeaders(actorResult.actor),
      body: JSON.stringify(scopedBody(isPlainObject(body) ? body : {}, actorResult.actor)),
    });
    if (!r.ok) {
      return NextResponse.json({ ok: false, marked: 0 }, { status: 200 });
    }
    const data = await r.json();
    return NextResponse.json({ ok: true, marked: data?.marked ?? 0 });
  } catch {
    return NextResponse.json({ ok: false, marked: 0 }, { status: 200 });
  }
}
