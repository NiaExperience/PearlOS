import {
  SHARED_FEATURES_MAX_ITEMS,
  buildSharedFeatureFromLedgerItem,
  normalizeSharedFeature,
  normalizeSharedFeatures,
  ownerOwnsSharedFeature,
  sharedFeatureId,
  sharedFeatureToPublic,
  upsertSharedFeature,
  type SharedFeatureRecord,
} from '../shared-features-store';
import type { StudioLedgerItem } from '../studio-ledger';

const NOW = 1_700_000_000_000;

function ledgerItem(overrides: Partial<StudioLedgerItem> = {}): StudioLedgerItem {
  return {
    id: 'task-9',
    title: 'Calmer desktop',
    kind: 'ui_manifest',
    status: 'applied',
    summary: 'Applied a calmer low-contrast theme.',
    artifactPath: '/srv/pearl-user-workspaces/t/u/task-9/pearlos-ui-customization.json',
    shareEligible: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const OWNER = { userId: 'alice-id', tenantId: 'tenant-a' };

describe('shared-features store', () => {
  it('builds a public-ready record from a share-eligible ledger item', () => {
    const record = buildSharedFeatureFromLedgerItem(ledgerItem(), OWNER, NOW, 'Interface');
    expect(record).not.toBeNull();
    expect(record!.id).toBe(sharedFeatureId('task-9'));
    expect(record!.id).toBe('shared-task-9');
    expect(record!.title).toBe('Calmer desktop');
    expect(record!.category).toBe('Interface');
    expect(record!.sharedByUserId).toBe('alice-id');
    expect(record!.sharedByTenantId).toBe('tenant-a');
    expect(record!.sourceLedgerItemId).toBe('task-9');
    expect(record!.baseVotes).toBe(0);
  });

  it('refuses to build from a non-share-eligible item', () => {
    expect(buildSharedFeatureFromLedgerItem(ledgerItem({ shareEligible: false }), OWNER, NOW)).toBeNull();
  });

  it('refuses to build without an owner identity', () => {
    expect(buildSharedFeatureFromLedgerItem(ledgerItem(), { userId: '', tenantId: 't' }, NOW)).toBeNull();
  });

  it('public projection strips owner identity and the server-side artifact path', () => {
    const record = buildSharedFeatureFromLedgerItem(ledgerItem(), OWNER, NOW)!;
    const pub = sharedFeatureToPublic(record);
    expect(pub).toEqual({
      id: 'shared-task-9',
      title: 'Calmer desktop',
      summary: 'Applied a calmer low-contrast theme.',
      status: 'community',
      baseVotes: 0,
      sourceType: 'feature',
    });
    expect(pub).not.toHaveProperty('artifactPath');
    expect(pub).not.toHaveProperty('sharedByUserId');
    expect(pub).not.toHaveProperty('sharedByTenantId');
    // Discovery metadata only — never a launchable creation.
    expect(pub).not.toHaveProperty('playUrl');
  });

  it('normalizes untrusted records and drops ones without an identity', () => {
    expect(normalizeSharedFeature({ title: 'no id' }, NOW)).toBeNull();
    expect(normalizeSharedFeature({ id: 'x', sharedByUserId: 'u' }, NOW)).toBeNull();
    const ok = normalizeSharedFeature(
      { id: 'shared-x', sharedByUserId: 'u', sourceLedgerItemId: 'x', title: 'X' },
      NOW
    );
    expect(ok).not.toBeNull();
    expect(ok!.sharedByTenantId).toBe('unknown');
    expect(normalizeSharedFeatures([{ id: 'a' }, null, 5], NOW)).toHaveLength(0);
  });

  it('ownership requires both tenant and user to match', () => {
    const record = buildSharedFeatureFromLedgerItem(ledgerItem(), OWNER, NOW)!;
    expect(ownerOwnsSharedFeature(record, OWNER)).toBe(true);
    expect(ownerOwnsSharedFeature(record, { userId: 'bob-id', tenantId: 'tenant-a' })).toBe(false);
    expect(ownerOwnsSharedFeature(record, { userId: 'alice-id', tenantId: 'tenant-b' })).toBe(false);
  });

  it('upsert inserts newest-first then updates in place preserving createdAt and votes', () => {
    const first = buildSharedFeatureFromLedgerItem(ledgerItem({ id: 'a' }), OWNER, NOW)!;
    const second = buildSharedFeatureFromLedgerItem(ledgerItem({ id: 'b' }), OWNER, NOW + 1)!;
    const afterFirst = upsertSharedFeature([], first, NOW)!;
    const afterSecond = upsertSharedFeature(afterFirst.features, second, NOW + 1)!;
    expect(afterSecond.features.map((f) => f.id)).toEqual(['shared-b', 'shared-a']);

    const withVotes: SharedFeatureRecord = { ...first, baseVotes: 12 };
    const seeded = upsertSharedFeature([withVotes], { ...first, title: 'Renamed', baseVotes: 0 }, NOW + 5)!;
    expect(seeded.feature.title).toBe('Renamed');
    expect(seeded.feature.createdAt).toBe(NOW);
    expect(seeded.feature.baseVotes).toBe(12);
    expect(seeded.feature.updatedAt).toBe(NOW + 5);
  });

  it('upsert refuses to overwrite another account record with the same id', () => {
    const mine = buildSharedFeatureFromLedgerItem(ledgerItem({ id: 'a' }), OWNER, NOW)!;
    const theirsSameId: SharedFeatureRecord = {
      ...mine,
      sharedByUserId: 'mallory-id',
      sharedByTenantId: 'tenant-evil',
    };
    expect(upsertSharedFeature([mine], theirsSameId, NOW + 1)).toBeNull();
  });

  it('caps the store at SHARED_FEATURES_MAX_ITEMS', () => {
    let features: SharedFeatureRecord[] = [];
    for (let i = 0; i < SHARED_FEATURES_MAX_ITEMS + 5; i += 1) {
      const record = buildSharedFeatureFromLedgerItem(ledgerItem({ id: `item-${i}` }), OWNER, NOW + i)!;
      features = upsertSharedFeature(features, record, NOW + i)!.features;
    }
    expect(features).toHaveLength(SHARED_FEATURES_MAX_ITEMS);
  });
});
