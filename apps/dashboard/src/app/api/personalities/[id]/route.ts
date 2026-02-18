import { getPersonalityById, updatePersonality, deletePersonality } from '@nia/prism/core/actions/personality.actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { shouldBypassAuth } from '@dashboard/lib/utils';

// GET /api/personalities/[id]?tenantId=...
export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const bypassAuth = shouldBypassAuth(req);
    if (!bypassAuth) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = req.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    const item = await getPersonalityById((await ctx.params).id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch personality' }, { status: 500 });
  }
}

// PUT /api/personalities/[id]?tenantId=...
export async function PUT(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const bypassAuth = shouldBypassAuth(req);
    let userId = 'local-dev-admin';
    if (!bypassAuth) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      userId = session.user.id;
    }
    const tenantId = req.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    const body = await req.json();
    const patch = body?.content || body;
    let updated;
    try {
      updated = await updatePersonality(tenantId, (await ctx.params).id, patch, userId);
    } catch (err: any) {
      if (err?.code === 'NAME_CONFLICT') {
        return NextResponse.json({ error: err.message, code: err.code }, { status: 409 });
      }
      throw err;
    }
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update personality' }, { status: 500 });
  }
}

// DELETE /api/personalities/[id]?tenantId=...
export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const bypassAuth = shouldBypassAuth(req);
    if (!bypassAuth) {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const tenantId = req.nextUrl.searchParams.get('tenantId');
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    const ok = await deletePersonality(tenantId, (await ctx.params).id);
    if (!ok) return NextResponse.json({ error: 'Not found or delete failed' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete personality' }, { status: 500 });
  }
}

// POST /api/personalities/[id]/clone?tenantId=...
// POST removed (clone now has its own /clone route)
