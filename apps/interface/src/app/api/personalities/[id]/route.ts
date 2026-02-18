import { NextRequest, NextResponse } from 'next/server';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getSessionSafely } from '@nia/prism/core/auth';
import { getPersonalityById } from '@nia/prism/core/actions/personality.actions';

// GET /api/personalities/[id]?tenantId=...
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const session = await getSessionSafely(req, interfaceAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const id = ctx.params.id;
    const personality = await getPersonalityById(id);
    if (!personality) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ item: personality });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch personality' }, { status: 500 });
  }
}