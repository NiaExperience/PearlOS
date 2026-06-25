import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences, PEARLOS_USER_PREFERENCES_KEY } from '@interface/lib/pearlos-user-preferences';
import { normalizeStudioLedger, upsertStudioLedgerItem } from '@interface/lib/studio-ledger';

export const dynamic = 'force-dynamic';

/**
 * Studio personal-change ledger endpoint.
 *
 * POST is bot-only (the worker reports applied manifests / parked code
 * artifacts here). GET returns the signed-in user's own ledger so the Studio
 * surface can render it. Both operate strictly on the requester's account —
 * core PearlOS source is never touched here.
 */

function botAuthorized(req: NextRequest): boolean {
  const secret = process.env.BOT_CONTROL_SHARED_SECRET || process.env.PEARL_TASKS_BOT_SECRET || '';
  if (!secret) return false;
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return req.headers.get('x-bot-secret') === secret || bearer === secret;
}

function cleanString(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

async function profileFor(userId?: string, email?: string) {
  const found = await UserProfileActions.findByUser(userId || undefined, email || undefined);
  return found?.userProfile || null;
}

function sessionEmail(session: Awaited<ReturnType<typeof getSessionSafely>>): string | undefined {
  const value = (session?.user as { email?: unknown } | undefined)?.email;
  return typeof value === 'string' ? value : undefined;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const profile = await profileFor(session?.user?.id, sessionEmail(session));
  const prefs = getPearlOSPreferences(profile?.privateMemory);
  return NextResponse.json(
    { ok: true, ledger: normalizeStudioLedger(prefs.personalChangeLedger, Date.now()) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!botAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const userId = cleanString(body.requester_user_id || body.requesterUserId, 160);
  const email = cleanString(body.requester_email || body.requesterEmail, 240);
  if (!userId && !email) {
    return NextResponse.json({ error: 'missing_requester' }, { status: 400 });
  }

  const profile = await profileFor(userId, email);
  const existingPrefs = getPearlOSPreferences(profile?.privateMemory);
  const now = Date.now();
  const result = upsertStudioLedgerItem(existingPrefs.personalChangeLedger, body.item, now);
  if (!result) {
    return NextResponse.json({ error: 'invalid_ledger_item' }, { status: 400 });
  }

  const nextPearlOS = { ...existingPrefs, personalChangeLedger: result.ledger };
  const updated = await UserProfileActions.createOrUpdateUserProfile(
    {
      id: profile?._id,
      userId: userId || profile?.userId,
      email: email || profile?.email,
      privateMemory: {
        preferences: {
          [PEARLOS_USER_PREFERENCES_KEY]: nextPearlOS,
        },
      },
    },
    false
  );

  if (!updated) {
    return NextResponse.json({ error: 'profile_update_failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: result.item, ledger: result.ledger });
}
