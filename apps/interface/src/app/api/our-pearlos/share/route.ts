import { NextRequest, NextResponse } from 'next/server';
import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getPearlOSPreferences, PEARLOS_USER_PREFERENCES_KEY } from '@interface/lib/pearlos-user-preferences';
import {
  findStudioLedgerItem,
  markStudioLedgerItemShared,
  type StudioLedgerShare,
} from '@interface/lib/studio-ledger';
import { decorateFeature, normalizeFeatureVotes } from '@interface/lib/our-pearlos-catalog';
import {
  buildSharedFeatureFromLedgerItem,
  readSharedFeatures,
  sharedFeatureToPublic,
  upsertSharedFeature,
  writeSharedFeatures,
} from '@interface/lib/shared-features-store';

export const dynamic = 'force-dynamic';

/**
 * Share a personal PearlOS change to the public "Our PearlOS" catalog.
 *
 * Owner-only: the signed-in user publishes one of *their own* applied,
 * share-eligible ledger items. Sharing only writes discovery metadata (title,
 * summary, the backing artifact path retained for a later incorporation step)
 * into the durable shared-features store, and stamps share metadata back onto
 * the owner's ledger. It never mutates core PearlOS or any other account — an
 * unauthenticated request is rejected, and a caller can only reach the items in
 * their own profile ledger, so one user can never share another's change.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await getSessionSafely(req, interfaceAuthOptions);
  const userId = session?.user?.id;
  const email = (session?.user as { email?: string } | undefined)?.email || undefined;
  if (!userId && !email) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ledgerItemId = typeof body.ledgerItemId === 'string' ? body.ledgerItemId : '';
  const category = typeof body.category === 'string' ? body.category : undefined;
  if (!ledgerItemId) {
    return NextResponse.json({ error: 'missing_ledger_item' }, { status: 400 });
  }

  const found = await UserProfileActions.findByUser(userId || undefined, email);
  const profile = found?.userProfile || null;
  const prefs = getPearlOSPreferences(profile?.privateMemory);
  const now = Date.now();

  const item = findStudioLedgerItem(prefs.personalChangeLedger, ledgerItemId, now);
  if (!item) {
    return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
  }
  if (!item.shareEligible) {
    return NextResponse.json({ error: 'not_shareable' }, { status: 409 });
  }

  const owner = {
    // Owner identity scopes later owner-only mutation of the shared feature.
    userId: userId || email || '',
    tenantId: (session?.user as { tenantId?: string } | undefined)?.tenantId || 'unknown',
  };
  const record = buildSharedFeatureFromLedgerItem(item, owner, now, category);
  if (!record) {
    return NextResponse.json({ error: 'not_shareable' }, { status: 409 });
  }

  const currentShared = await readSharedFeatures();
  const upserted = upsertSharedFeature(currentShared, record, now);
  if (!upserted) {
    // The public id is already owned by a different account — refuse rather
    // than overwrite someone else's published feature.
    return NextResponse.json({ error: 'share_conflict' }, { status: 409 });
  }
  await writeSharedFeatures(upserted.features);

  const share: StudioLedgerShare = {
    publicFeatureId: upserted.feature.id,
    sharedAt: now,
    status: 'public',
  };
  const stamped = markStudioLedgerItemShared(prefs.personalChangeLedger, ledgerItemId, share, now);
  if (stamped) {
    const nextPearlOS = { ...prefs, personalChangeLedger: stamped.ledger };
    await UserProfileActions.createOrUpdateUserProfile(
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
  }

  const publicFeature = sharedFeatureToPublic(upserted.feature);
  return NextResponse.json({
    ok: true,
    // Decorated against no votes — the owner has not voted, and sharing adds a
    // discovery entry, not a launchable creation (no playUrl).
    feature: decorateFeature(publicFeature, normalizeFeatureVotes({}, [publicFeature.id])),
    item: stamped?.item ?? { ...item, share },
  });
}
