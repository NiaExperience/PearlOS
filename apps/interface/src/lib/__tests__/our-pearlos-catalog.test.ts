import {
  MAX_TRACKED_INSTALLS,
  MAX_TRACKED_VOTES,
  OUR_PEARLOS_FEATURES,
  applyFeatureInstall,
  applyVote,
  decorateCatalog,
  decorateFeature,
  isKnownInstallableFeature,
  isKnownVotableFeature,
  isVotableStatus,
  normalizeFeatureInstalls,
  normalizeFeatureVotes,
} from '../our-pearlos-catalog';

const COMMUNITY_IDS = OUR_PEARLOS_FEATURES.filter((f) => f.status === 'community').map((f) => f.id);
const COMMUNITY_ID = COMMUNITY_IDS[0];
const COMMUNITY_ID_2 = COMMUNITY_IDS[1];
const PUBLIC_ID = OUR_PEARLOS_FEATURES.find((f) => f.status === 'public')!.id;

describe('our-pearlos catalog', () => {
  it('only community features are votable', () => {
    expect(isVotableStatus('community')).toBe(true);
    expect(isVotableStatus('public')).toBe(false);
    expect(isVotableStatus('integrating')).toBe(false);
  });

  it('recognizes known votable features and rejects others', () => {
    expect(isKnownVotableFeature(COMMUNITY_ID)).toBe(true);
    expect(isKnownVotableFeature(PUBLIC_ID)).toBe(false);
    expect(isKnownVotableFeature('does-not-exist')).toBe(false);
    expect(isKnownVotableFeature('')).toBe(false);
  });

  it('recognizes known installable features and rejects showcase items', () => {
    expect(isKnownInstallableFeature(COMMUNITY_ID)).toBe(true);
    expect(isKnownInstallableFeature('workspace-extras-pack')).toBe(true);
    expect(isKnownInstallableFeature(PUBLIC_ID)).toBe(false);
    expect(isKnownInstallableFeature('does-not-exist')).toBe(false);
  });

  it('offers removed workspace defaults as an installable package', () => {
    const pack = OUR_PEARLOS_FEATURES.find((f) => f.id === 'workspace-extras-pack');
    expect(pack).toMatchObject({
      title: 'Workspace extras pack',
      status: 'community',
      category: 'Workspace',
      sourceType: 'feature_package',
    });
    expect(pack?.summary).toContain('Council');
    expect(pack?.summary).toContain('Web Browser');
    expect(pack?.summary).toContain('Pulse');
  });

  it('normalizes votes, dropping non-votable and malformed keys', () => {
    const votes = normalizeFeatureVotes({
      [COMMUNITY_ID]: true,
      [PUBLIC_ID]: true, // showcase feature — not votable
      'unknown-feature': true,
      [COMMUNITY_ID_2]: false as unknown as true, // falsy value dropped
    });
    expect(votes).toEqual({ [COMMUNITY_ID]: true });
  });

  it('ignores non-object vote input', () => {
    expect(normalizeFeatureVotes(null)).toEqual({});
    expect(normalizeFeatureVotes(['a'])).toEqual({});
    expect(normalizeFeatureVotes(42)).toEqual({});
  });

  it('applyVote adds and removes a vote, ignoring non-votable ids', () => {
    const added = applyVote({}, COMMUNITY_ID, true);
    expect(added[COMMUNITY_ID]).toBe(true);
    const removed = applyVote(added, COMMUNITY_ID, false);
    expect(removed[COMMUNITY_ID]).toBeUndefined();
    // A public showcase feature can never receive a vote.
    expect(applyVote({}, PUBLIC_ID, true)).toEqual({});
  });

  it('normalizes and applies installed community features', () => {
    expect(normalizeFeatureInstalls({
      [COMMUNITY_ID]: true,
      [PUBLIC_ID]: true,
      'unknown-feature': true,
      [COMMUNITY_ID_2]: false as unknown as true,
    })).toEqual({ [COMMUNITY_ID]: true });

    const added = applyFeatureInstall({}, COMMUNITY_ID, true);
    expect(added[COMMUNITY_ID]).toBe(true);
    expect(applyFeatureInstall(added, COMMUNITY_ID, false)[COMMUNITY_ID]).toBeUndefined();
    expect(applyFeatureInstall({}, PUBLIC_ID, true)).toEqual({});
  });

  it('decorateFeature reflects the user vote in the count for votable items only', () => {
    const community = OUR_PEARLOS_FEATURES.find((f) => f.id === COMMUNITY_ID)!;
    const voted = decorateFeature(community, { [COMMUNITY_ID]: true });
    expect(voted.hasVoted).toBe(true);
    expect(voted.voteCount).toBe(community.baseVotes + 1);

    const pub = OUR_PEARLOS_FEATURES.find((f) => f.id === PUBLIC_ID)!;
    const decoratedPublic = decorateFeature(pub, { [PUBLIC_ID]: true } as Record<string, true>);
    expect(decoratedPublic.votable).toBe(false);
    expect(decoratedPublic.hasVoted).toBe(false);
    expect(decoratedPublic.voteCount).toBe(pub.baseVotes);
  });

  it('decorateCatalog groups by status and sorts community by votes', () => {
    const catalog = decorateCatalog({ [COMMUNITY_ID]: true });
    expect(catalog.public.every((f) => f.status === 'public')).toBe(true);
    expect(catalog.integrating.every((f) => f.status === 'integrating')).toBe(true);
    expect(catalog.community.every((f) => f.status === 'community')).toBe(true);
    // Sorted by descending vote count.
    for (let i = 1; i < catalog.community.length; i += 1) {
      expect(catalog.community[i - 1].voteCount).toBeGreaterThanOrEqual(catalog.community[i].voteCount);
    }
  });

  it('caps the tracked votes to the bound', () => {
    const big: Record<string, true> = {};
    for (let i = 0; i < MAX_TRACKED_VOTES + 25; i += 1) big[`feat-${i}`] = true;
    // None of these synthetic ids are real votable features, so they are all dropped.
    expect(Object.keys(normalizeFeatureVotes(big)).length).toBe(0);
  });

  it('caps the tracked installs to the bound', () => {
    const big: Record<string, true> = {};
    for (let i = 0; i < MAX_TRACKED_INSTALLS + 25; i += 1) big[`feat-${i}`] = true;
    expect(Object.keys(normalizeFeatureInstalls(big)).length).toBe(0);
  });
});
