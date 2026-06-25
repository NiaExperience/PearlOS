/**
 * Our PearlOS — shared, public-facing feature catalog.
 *
 * Where the Studio ledger is the *private* record of changes Pearl applied for
 * one account, "Our PearlOS" is the *public* surface: features that already
 * shipped to everyone, features queued to be folded into the next build, and
 * community-created features people can vote for.
 *
 * Voting is deliberately non-global. A vote only ever touches the voting
 * user's own profile preferences ({@link PearlOSUserPreferences.featureVotes}).
 * The catalog carries a baseline interest count; the rendered tally is that
 * baseline plus whether the signed-in user has added their own vote. Nothing
 * here mutates shared/core state, so a vote can never cascade across accounts.
 *
 * These helpers are pure so they can be unit-tested without a database.
 */

export type PublicFeatureStatus = 'public' | 'integrating' | 'community';

export interface PublicFeature {
  /** Stable id; also the key used to record a user's vote. */
  id: string;
  /** Plain-language title (no internal task/run identifiers). */
  title: string;
  /** Plain-language summary of what the feature does. */
  summary: string;
  /**
   * 'public'      — already shipped to everyone (latest public features).
   * 'integrating' — accepted, being folded into the next build.
   * 'community'   — public user-created feature open for votes.
   */
  status: PublicFeatureStatus;
  /** Baseline community interest captured in the catalog. */
  baseVotes: number;
  /** Optional short grouping label. */
  category?: string;
  /** Optional launch target for community-shared Studio creations. */
  launchUrl?: string;
  /** Optional origin label so clients can install launchable features correctly. */
  sourceType?: 'feature' | 'studio_creation';
}

export interface DecoratedFeature extends PublicFeature {
  /** baseVotes plus the signed-in user's own vote, if any. */
  voteCount: number;
  /** Whether the signed-in user has voted for this feature. */
  hasVoted: boolean;
  /** Whether this feature accepts votes at all. */
  votable: boolean;
}

/** Map of featureId -> true for the features a single user has voted for. */
export type FeatureVotes = Record<string, true>;

/** Map of featureId -> true for community features installed into one user's PearlOS. */
export type FeatureInstalls = Record<string, true>;

/** Only community (public user-created) features accept votes. */
export const VOTABLE_STATUSES: ReadonlySet<PublicFeatureStatus> = new Set<PublicFeatureStatus>([
  'community',
]);

/** Guard so one account cannot grow its profile with unbounded vote keys. */
export const MAX_TRACKED_VOTES = 200;

/** Guard so one account cannot grow its profile with unbounded install keys. */
export const MAX_TRACKED_INSTALLS = 200;

/**
 * Curated catalog. Ships with the build; community items are seeded here until
 * a later phase promotes share-eligible personal changes into this list. Order
 * within a status is preserved for display.
 */
export const OUR_PEARLOS_FEATURES: readonly PublicFeature[] = [
  {
    id: 'desktop-themes',
    title: 'Personal desktop themes',
    summary: 'Recolor the desktop, windows, and chat to a palette that fits you, saved to your account.',
    status: 'public',
    baseVotes: 0,
    category: 'Interface',
  },
  {
    id: 'studio-ledger',
    title: 'Studio change ledger',
    summary: 'Every personal PearlOS change Pearl makes for you is itemized with its status and artifact.',
    status: 'public',
    baseVotes: 0,
    category: 'Studio',
  },
  {
    id: 'shared-feature-votes',
    title: 'Community feature voting',
    summary: 'Vote on user-created features so the most wanted ones move toward the next build.',
    status: 'integrating',
    baseVotes: 0,
    category: 'Our PearlOS',
  },
  {
    id: 'window-snap-layouts',
    title: 'Window snap layouts',
    summary: 'Snap app windows into halves and quarters for side-by-side multitasking.',
    status: 'integrating',
    baseVotes: 0,
    category: 'Interface',
  },
  {
    id: 'shared-notes-pin',
    title: 'Pinned quick notes',
    summary: 'Keep a small notes panel pinned to the desktop for jotting things between apps.',
    status: 'community',
    baseVotes: 18,
    category: 'Notes',
  },
  {
    id: 'voice-shortcuts',
    title: 'Custom voice shortcuts',
    summary: 'Teach Pearl a phrase that opens a specific app or runs a saved routine for you.',
    status: 'community',
    baseVotes: 31,
    category: 'Voice',
  },
  {
    id: 'community-calm-theme',
    title: 'Community calm theme',
    summary: 'Install a soft desktop and window palette shared by another PearlOS user.',
    status: 'community',
    baseVotes: 24,
    category: 'Our PearlOS',
  },
  {
    id: 'desktop-quick-button',
    title: 'Desktop quick button',
    summary: 'Add a single desktop button that opens a favorite note, site, or Studio creation.',
    status: 'community',
    baseVotes: 21,
    category: 'Our PearlOS',
  },
  {
    id: 'workspace-extras-pack',
    title: 'Workspace extras pack',
    summary: 'Add Council, Web Browser, and Pulse back to your workspace desktop as personal shortcuts.',
    status: 'community',
    baseVotes: 15,
    category: 'Workspace',
    sourceType: 'feature_package',
  },
  {
    id: 'one-button-focus',
    title: 'One-button focus mode',
    summary: 'A tiny shared workflow that starts a focus timer and opens Notes in one tap.',
    status: 'community',
    baseVotes: 17,
    category: 'Workflow',
  },
  {
    id: 'focus-soundscapes',
    title: 'Focus soundscapes',
    summary: 'Background ambiences you can switch on while you work, separate from the music player.',
    status: 'community',
    baseVotes: 12,
    category: 'Audio',
  },
];

export function isVotableStatus(status: PublicFeatureStatus): boolean {
  return VOTABLE_STATUSES.has(status);
}

function safeFeatureId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
}

/** Set of ids that are real, votable catalog features. */
const VOTABLE_IDS: ReadonlySet<string> = new Set(
  OUR_PEARLOS_FEATURES.filter((f) => isVotableStatus(f.status)).map((f) => f.id)
);

/**
 * Build the live set of votable ids: the curated community features plus any
 * dynamically shared community features supplied by the caller. Extra ids are
 * sanitized the same way so a malformed id can never slip into the vote space.
 */
function votableIdSet(extraVotableIds?: Iterable<string>): ReadonlySet<string> {
  if (!extraVotableIds) return VOTABLE_IDS;
  const merged = new Set<string>(VOTABLE_IDS);
  for (const raw of extraVotableIds) {
    const id = safeFeatureId(raw);
    if (id) merged.add(id);
  }
  return merged;
}

export function isKnownVotableFeature(featureId: string, extraVotableIds?: Iterable<string>): boolean {
  return votableIdSet(extraVotableIds).has(safeFeatureId(featureId));
}

export function isKnownInstallableFeature(featureId: string, extraInstallableIds?: Iterable<string>): boolean {
  return votableIdSet(extraInstallableIds).has(safeFeatureId(featureId));
}

/**
 * Sanitize an untrusted votes record. Keeps only well-formed ids that map to a
 * real votable feature, dedupes, and caps the total so the profile stays bounded.
 * `extraVotableIds` adds dynamically shared community features to the allow-set.
 */
export function normalizeFeatureVotes(raw: unknown, extraVotableIds?: Iterable<string>): FeatureVotes {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const votable = votableIdSet(extraVotableIds);
  const out: FeatureVotes = {};
  let count = 0;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (count >= MAX_TRACKED_VOTES) break;
    if ((raw as Record<string, unknown>)[key] !== true) continue;
    const id = safeFeatureId(key);
    if (!id || !votable.has(id) || out[id]) continue;
    out[id] = true;
    count += 1;
  }
  return out;
}

/**
 * Apply a single user's vote toggle to their votes record. Returns a new record;
 * a falsy `voted` removes the vote. Non-votable / unknown ids are ignored so a
 * client cannot record a vote against a showcase feature.
 */
export function applyVote(
  currentRaw: unknown,
  featureId: string,
  voted: boolean,
  extraVotableIds?: Iterable<string>
): FeatureVotes {
  const votable = votableIdSet(extraVotableIds);
  const current = normalizeFeatureVotes(currentRaw, extraVotableIds);
  const id = safeFeatureId(featureId);
  if (!id || !votable.has(id)) return current;
  const next: FeatureVotes = { ...current };
  if (voted) {
    next[id] = true;
  } else {
    delete next[id];
  }
  return next;
}

/**
 * Sanitize an untrusted install record. Installs use the same bounded,
 * community-only feature id space as votes, but they control per-account
 * desktop membership rather than community interest.
 */
export function normalizeFeatureInstalls(raw: unknown, extraInstallableIds?: Iterable<string>): FeatureInstalls {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const installable = votableIdSet(extraInstallableIds);
  const out: FeatureInstalls = {};
  let count = 0;
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (count >= MAX_TRACKED_INSTALLS) break;
    if ((raw as Record<string, unknown>)[key] !== true) continue;
    const id = safeFeatureId(key);
    if (!id || !installable.has(id) || out[id]) continue;
    out[id] = true;
    count += 1;
  }
  return out;
}

export function applyFeatureInstall(
  currentRaw: unknown,
  featureId: string,
  installed: boolean,
  extraInstallableIds?: Iterable<string>
): FeatureInstalls {
  const installable = votableIdSet(extraInstallableIds);
  const current = normalizeFeatureInstalls(currentRaw, extraInstallableIds);
  const id = safeFeatureId(featureId);
  if (!id || !installable.has(id)) return current;
  const next: FeatureInstalls = { ...current };
  if (installed) {
    next[id] = true;
  } else {
    delete next[id];
  }
  return next;
}

export function decorateFeature(feature: PublicFeature, votes: FeatureVotes): DecoratedFeature {
  const votable = isVotableStatus(feature.status);
  const hasVoted = votable && votes[feature.id] === true;
  return {
    ...feature,
    votable,
    hasVoted,
    voteCount: feature.baseVotes + (hasVoted ? 1 : 0),
  };
}

export interface DecoratedCatalog {
  /** Already shipped to everyone. */
  public: DecoratedFeature[];
  /** Accepted, being folded into the next build. */
  integrating: DecoratedFeature[];
  /** Public user-created features open for votes, most-wanted first. */
  community: DecoratedFeature[];
}

/**
 * Merge the curated catalog with dynamically shared community features. Curated
 * ids win on collision so a shared feature can never shadow a showcase entry.
 */
function mergeCatalog(extra: readonly PublicFeature[]): PublicFeature[] {
  if (!extra.length) return [...OUR_PEARLOS_FEATURES];
  const seen = new Set(OUR_PEARLOS_FEATURES.map((f) => f.id));
  const merged: PublicFeature[] = [...OUR_PEARLOS_FEATURES];
  for (const feature of extra) {
    if (!feature?.id || seen.has(feature.id)) continue;
    seen.add(feature.id);
    merged.push(feature);
  }
  return merged;
}

/**
 * Decorate the full catalog with the signed-in user's votes and group it by
 * status. Community items are sorted by live vote count (then title) so the
 * most-wanted feature leads. `extra` carries user-shared community features
 * pulled from the durable shared-features store.
 */
export function decorateCatalog(votesRaw: unknown, extra: readonly PublicFeature[] = []): DecoratedCatalog {
  const features = mergeCatalog(extra);
  const votes = normalizeFeatureVotes(
    votesRaw,
    features.filter((f) => isVotableStatus(f.status)).map((f) => f.id)
  );
  const decorated = features.map((f) => decorateFeature(f, votes));
  const community = decorated
    .filter((f) => f.status === 'community')
    .sort((a, b) => b.voteCount - a.voteCount || a.title.localeCompare(b.title));
  return {
    public: decorated.filter((f) => f.status === 'public'),
    integrating: decorated.filter((f) => f.status === 'integrating'),
    community,
  };
}
