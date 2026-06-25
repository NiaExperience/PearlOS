import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences, PEARLOS_USER_PREFERENCES_KEY } from '@interface/lib/pearlos-user-preferences';
import {
  applyVote,
  decorateFeature,
  isKnownVotableFeature,
  normalizeFeatureVotes,
  OUR_PEARLOS_FEATURES,
  type PublicFeature,
} from '@interface/lib/our-pearlos-catalog';
import { readSharedFeatures, sharedFeaturesToPublic } from '@interface/lib/shared-features-store';

export const dynamic = 'force-dynamic';

/**
 * Record one authenticated user's vote for a public, user-created feature.
 *
 * The vote is written only to the voting user's own profile preferences. It
 * never mutates the shared catalog or any other account, so a vote can never
 * cascade into a global change. Votes are scoped to authenticated users — an
 * unauthenticated request is rejected.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id;
  const email = (session?.user as { email?: string } | undefined)?.email || undefined;
  if (!userId && !email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const featureId = typeof body.featureId === 'string' ? body.featureId : '';
  const voted = body.voted === true;

  // Shared community features are votable too; fold their ids into the allow-set.
  const sharedFeatures = sharedFeaturesToPublic(await readSharedFeatures());
  const sharedIds = sharedFeatures.map((f) => f.id);
  if (!isKnownVotableFeature(featureId, sharedIds)) {
    return NextResponse.json({ error: 'invalid_feature' }, { status: 400 });
  }

  const found = await UserProfileActions.findByUser(userId || undefined, email);
  const profile = found?.userProfile || null;
  const existingPrefs = getPearlOSPreferences(profile?.privateMemory);
  const nextVotes = applyVote(existingPrefs.featureVotes, featureId, voted, sharedIds);

  const nextPearlOS = { ...existingPrefs, featureVotes: nextVotes };
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

  const candidates: PublicFeature[] = [...OUR_PEARLOS_FEATURES, ...sharedFeatures];
  const feature = candidates.find((f) => f.id === featureId);
  const normalizedVotes = normalizeFeatureVotes(nextVotes, sharedIds);
  return NextResponse.json({
    ok: true,
    feature: feature ? decorateFeature(feature, normalizedVotes) : null,
  });
}
