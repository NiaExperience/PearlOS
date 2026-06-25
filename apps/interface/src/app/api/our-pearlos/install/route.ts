import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences, PEARLOS_USER_PREFERENCES_KEY } from '@interface/lib/pearlos-user-preferences';
import {
  OUR_PEARLOS_FEATURES,
  applyFeatureInstall,
  isKnownInstallableFeature,
  normalizeFeatureInstalls,
} from '@interface/lib/our-pearlos-catalog';
import { readSharedFeatures, sharedFeaturesToPublic } from '@interface/lib/shared-features-store';

export const dynamic = 'force-dynamic';

/**
 * Persist one signed-in user's Our PearlOS Add/Remove state.
 *
 * This is per-account membership only. It does not promote a community feature
 * into the global catalog, and it never mutates another user's settings.
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
  const installed = body.installed === true;

  const sharedFeatures = sharedFeaturesToPublic(await readSharedFeatures());
  const sharedIds = sharedFeatures.filter((f) => f.status === 'community').map((f) => f.id);
  if (!isKnownInstallableFeature(featureId, sharedIds)) {
    return NextResponse.json({ error: 'invalid_feature' }, { status: 400 });
  }

  const found = await UserProfileActions.findByUser(userId || undefined, email);
  const profile = found?.userProfile || null;
  const existingPrefs = getPearlOSPreferences(profile?.privateMemory);
  const nextInstalls = applyFeatureInstall(existingPrefs.installedCommunityFeatures, featureId, installed, sharedIds);

  const nextPearlOS = { ...existingPrefs, installedCommunityFeatures: nextInstalls };
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

  const allFeatures = [...OUR_PEARLOS_FEATURES, ...sharedFeatures];
  const feature = allFeatures.find((f) => f.id === featureId) || null;
  return NextResponse.json({
    ok: true,
    installedFeatureIds: normalizeFeatureInstalls(nextInstalls, sharedIds),
    feature,
  });
}
