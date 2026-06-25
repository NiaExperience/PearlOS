import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences } from '@interface/lib/pearlos-user-preferences';
import { decorateCatalog, normalizeFeatureInstalls } from '@interface/lib/our-pearlos-catalog';
import { readSharedFeatures, sharedFeaturesToPublic } from '@interface/lib/shared-features-store';

export const dynamic = 'force-dynamic';

/**
 * Our PearlOS public feature catalog.
 *
 * GET returns the shared catalog grouped by status, decorated with the
 * signed-in user's own votes. The curated catalog plus every user-shared
 * community feature is the same for everyone; only the per-user vote flags
 * differ. Unauthenticated callers still get the public catalog, just with no
 * votes applied. Only discovery metadata is published — no owner identity or
 * server-side artifact path reaches the reader.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id;
  const email = (session?.user as { email?: string } | undefined)?.email || undefined;

  const shared = sharedFeaturesToPublic(await readSharedFeatures());

  let votes: unknown = {};
  let installedFeatureIds: Record<string, true> = {};
  if (userId || email) {
    const found = await UserProfileActions.findByUser(userId || undefined, email);
    const profile = found?.userProfile || null;
    const prefs = getPearlOSPreferences(profile?.privateMemory);
    const sharedIds = shared.filter((f) => f.status === 'community').map((f) => f.id);
    votes = prefs.featureVotes;
    installedFeatureIds = normalizeFeatureInstalls(prefs.installedCommunityFeatures, sharedIds);
  }

  return NextResponse.json(
    { ok: true, catalog: decorateCatalog(votes, shared), installedFeatureIds, signedIn: Boolean(userId || email) },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
