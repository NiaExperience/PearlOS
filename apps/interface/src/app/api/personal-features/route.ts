import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences } from '@interface/lib/pearlos-user-preferences';
import { normalizePersonalFeaturePackages } from '@interface/lib/personal-feature-packages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function cleanString(value: unknown, limit = 240): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

async function profileFor(userId?: string, email?: string) {
  const found = await UserProfileActions.findByUser(userId || undefined, email || undefined);
  return found?.userProfile || null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const sessionUser = session?.user as { id?: unknown; email?: unknown } | undefined;
  const userId = cleanString(sessionUser?.id, 160);
  const email = cleanString(sessionUser?.email, 240);
  if (!userId && !email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const profile = await profileFor(userId, email);
  const prefs = getPearlOSPreferences(profile?.privateMemory);
  return NextResponse.json(
    {
      ok: true,
      packages: normalizePersonalFeaturePackages(prefs.personalFeaturePackages, Date.now()),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
