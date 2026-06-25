import {
  STUDIO_LEDGER_MAX_ITEMS,
  findStudioLedgerItem,
  markStudioLedgerItemShared,
  normalizeStudioLedger,
  normalizeStudioLedgerItem,
  upsertStudioLedgerItem,
} from '../studio-ledger';

describe('studio ledger', () => {
  const NOW = 1_700_000_000_000;

  it('normalizes a valid applied ui_manifest item', () => {
    const item = normalizeStudioLedgerItem(
      {
        id: 'Task-9/UI Manifest',
        title: 'Calmer desktop',
        kind: 'ui_manifest',
        status: 'applied',
        summary: 'Applied a calmer theme.',
        artifactPath: '/srv/pearl-user-workspaces/t/u/task-9/pearlos-ui-customization.json',
        shareEligible: true,
      },
      NOW
    );

    expect(item).not.toBeNull();
    expect(item!.id).toBe('task-9-ui-manifest');
    expect(item!.kind).toBe('ui_manifest');
    expect(item!.status).toBe('applied');
    expect(item!.shareEligible).toBe(true);
    expect(item!.createdAt).toBe(NOW);
  });

  it('drops items without a stable id', () => {
    expect(normalizeStudioLedgerItem({ title: 'no id' }, NOW)).toBeNull();
    expect(normalizeStudioLedgerItem(null, NOW)).toBeNull();
    expect(normalizeStudioLedgerItem(['array'], NOW)).toBeNull();
  });

  it('never marks a code_artifact as share-eligible', () => {
    const item = normalizeStudioLedgerItem(
      {
        id: 'task-9-code',
        kind: 'code_artifact',
        status: 'needs_review',
        shareEligible: true,
      },
      NOW
    );
    expect(item!.shareEligible).toBe(false);
  });

  it('only allows share eligibility for applied manifests', () => {
    const pending = normalizeStudioLedgerItem(
      { id: 'a', kind: 'ui_manifest', status: 'needs_review', shareEligible: true },
      NOW
    );
    expect(pending!.shareEligible).toBe(false);
  });

  it('defaults unknown kind/status to safe values', () => {
    const item = normalizeStudioLedgerItem({ id: 'x', kind: 'wild', status: 'bogus' }, NOW);
    expect(item!.kind).toBe('code_artifact');
    expect(item!.status).toBe('needs_review');
  });

  it('normalizeStudioLedger filters invalid entries', () => {
    const ledger = normalizeStudioLedger(
      [{ id: 'ok' }, { title: 'missing id' }, 42, null],
      NOW
    );
    expect(ledger).toHaveLength(1);
    expect(ledger[0].id).toBe('ok');
  });

  it('upsert inserts new items newest-first', () => {
    const first = upsertStudioLedgerItem([], { id: 'a', title: 'A' }, NOW);
    const second = upsertStudioLedgerItem(first!.ledger, { id: 'b', title: 'B' }, NOW + 1);
    expect(second!.ledger.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('upsert updates in place, preserving createdAt and bumping updatedAt', () => {
    const created = upsertStudioLedgerItem(
      [],
      { id: 'a', status: 'needs_review', summary: 'first' },
      NOW
    );
    const updated = upsertStudioLedgerItem(
      created!.ledger,
      { id: 'a', status: 'applied', kind: 'ui_manifest', summary: 'second' },
      NOW + 5000
    );
    expect(updated!.ledger).toHaveLength(1);
    expect(updated!.item.createdAt).toBe(NOW);
    expect(updated!.item.updatedAt).toBe(NOW + 5000);
    expect(updated!.item.status).toBe('applied');
    expect(updated!.item.summary).toBe('second');
  });

  it('upsert returns null for an item without an id', () => {
    expect(upsertStudioLedgerItem([], { title: 'no id' }, NOW)).toBeNull();
  });

  it('caps the ledger at STUDIO_LEDGER_MAX_ITEMS', () => {
    let ledger: unknown = [];
    for (let i = 0; i < STUDIO_LEDGER_MAX_ITEMS + 10; i += 1) {
      const res = upsertStudioLedgerItem(ledger, { id: `item-${i}` }, NOW + i);
      ledger = res!.ledger;
    }
    expect((ledger as unknown[]).length).toBe(STUDIO_LEDGER_MAX_ITEMS);
  });

  it('never carries a playUrl: a PearlOS change item is a record, not a creation', () => {
    const item = normalizeStudioLedgerItem(
      {
        id: 'task-9',
        title: 'Calmer desktop',
        kind: 'ui_manifest',
        status: 'applied',
        // A client cannot smuggle a launch affordance into a change record.
        playUrl: '/api/creation/task-9/',
        outputPath: '/srv/whatever/',
      },
      NOW
    );
    expect(item).not.toBeNull();
    expect(item).not.toHaveProperty('playUrl');
    expect(item).not.toHaveProperty('outputPath');
  });

  it('normalizes and preserves share metadata only when an applied manifest is shared', () => {
    const item = normalizeStudioLedgerItem(
      {
        id: 'task-9',
        kind: 'ui_manifest',
        status: 'applied',
        share: { publicFeatureId: 'shared-task-9', sharedAt: NOW, status: 'public' },
      },
      NOW
    );
    expect(item!.share).toEqual({ publicFeatureId: 'shared-task-9', sharedAt: NOW, status: 'public' });

    // A bot re-upsert (no share field) must not silently unpublish the change.
    const reupserted = upsertStudioLedgerItem(
      [item],
      { id: 'task-9', kind: 'ui_manifest', status: 'applied', summary: 'updated' },
      NOW + 1000
    );
    expect(reupserted!.item.share).toEqual(
      expect.objectContaining({ publicFeatureId: 'shared-task-9', status: 'public' })
    );
  });

  it('drops share metadata without a stable public feature id', () => {
    const item = normalizeStudioLedgerItem(
      { id: 'task-9', kind: 'ui_manifest', status: 'applied', share: { status: 'public' } },
      NOW
    );
    expect(item!.share).toBeUndefined();
  });

  it('marks a share-eligible item shared in place', () => {
    const ledger = [
      { id: 'a', kind: 'ui_manifest', status: 'applied', shareEligible: true },
      { id: 'b', kind: 'code_artifact', status: 'needs_review' },
    ];
    const share = { publicFeatureId: 'shared-a', sharedAt: NOW, status: 'public' as const };
    const result = markStudioLedgerItemShared(ledger, 'a', share, NOW);
    expect(result).not.toBeNull();
    expect(result!.item.share).toEqual(share);
    // Order is preserved so publishing does not disturb review history.
    expect(result!.ledger.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('refuses to share an item that is not share-eligible', () => {
    const ledger = [{ id: 'b', kind: 'code_artifact', status: 'needs_review' }];
    const share = { publicFeatureId: 'shared-b', sharedAt: NOW, status: 'public' as const };
    expect(markStudioLedgerItemShared(ledger, 'b', share, NOW)).toBeNull();
    expect(markStudioLedgerItemShared(ledger, 'missing', share, NOW)).toBeNull();
  });

  it('findStudioLedgerItem sanitizes the id before matching', () => {
    const ledger = [{ id: 'task-9-ui-manifest', kind: 'ui_manifest', status: 'applied' }];
    expect(findStudioLedgerItem(ledger, 'Task-9/UI Manifest', NOW)?.id).toBe('task-9-ui-manifest');
    expect(findStudioLedgerItem(ledger, 'nope', NOW)).toBeNull();
  });
});
