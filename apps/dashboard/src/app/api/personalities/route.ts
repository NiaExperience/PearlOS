import { NextRequest, NextResponse } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { shouldBypassAuth } from '@dashboard/lib/utils';
import { getSessionSafely } from '@nia/prism/core/auth';
import { listPersonalities, createPersonality, listAllPersonalities } from '@nia/prism/core/actions/personality.actions';

// GET /api/personalities?tenantId=...
export async function GET(req: NextRequest) : Promise<NextResponse> {
  try {
    // Check auth unless bypassed for local dev
    if (!shouldBypassAuth(req)) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const tenantId = req.nextUrl.searchParams.get('tenantId');
    let items;
    if (!tenantId) {
      items = await listAllPersonalities();
    } else {
      items = await listPersonalities(tenantId);
    }
    return NextResponse.json({ items });
  } catch (e: any) {
    console.error('[personalities] Error:', e);
    return NextResponse.json({ error: e?.message || 'Failed to list personalities' }, { status: 500 });
  }
}

// POST /api/personalities  (create)
export async function POST(req: NextRequest) : Promise<NextResponse> {
  try {
    // Check auth unless bypassed for local dev
    if (!shouldBypassAuth(req)) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await req.json();
    const { tenantId, content } = body || {};
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    if (!content) return NextResponse.json({ error: 'Missing content' }, { status: 400 });
    let created;
    try {
      created = await createPersonality(tenantId, content);
    } catch (err: any) {
      if (err?.code === 'NAME_CONFLICT') {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
      }
      throw err;
    }
    return NextResponse.json({ item: created });
  } catch (e: any) {
    console.error('[personalities] Error creating:', e);
    return NextResponse.json({ error: e?.message || 'Failed to create personality' }, { status: 500 });
  }
}
