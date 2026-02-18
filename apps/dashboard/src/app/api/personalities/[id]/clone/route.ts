import { NextRequest, NextResponse } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { getSessionSafely } from '@nia/prism/core/auth';
import { clonePersonality } from '@nia/prism/core/actions/personality.actions';
import { shouldBypassAuth } from '@dashboard/lib/utils';

// POST /api/personalities/[id]/clone?tenantId=...
export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const bypassAuth = shouldBypassAuth(req);
    if (!bypassAuth) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = req.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    const cloned = await clonePersonality(tenantId, (await ctx.params).id);
    return NextResponse.json({ item: cloned });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to clone personality' }, { status: 500 });
  }
}
