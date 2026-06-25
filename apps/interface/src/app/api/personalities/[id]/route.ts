import { NextRequest, NextResponse } from 'next/server';
import { getPersonalityById } from '@nia/prism/core/actions/personality.actions';
import { resolveInterfaceActorContext } from '@interface/lib/tenant-actor';

// GET /api/personalities/[id]?tenantId=...
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const url = new URL(req.url);
    const requestedTenantId = url.searchParams.get('tenantId') || url.searchParams.get('tenant_id');
    const actorResult = await resolveInterfaceActorContext({ requestedTenantId });
    if (!actorResult.ok) return actorResult.response;

    const id = ctx.params.id;
    const personality = await getPersonalityById(id, actorResult.actor.tenantId);
    if (!personality) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ item: personality });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch personality' }, { status: 500 });
  }
}
