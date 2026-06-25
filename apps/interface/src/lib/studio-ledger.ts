/**
 * Studio personal-change ledger.
 *
 * Every personal PearlOS feature task that Pearl runs for a specific user
 * produces a ledger item on that user's account. The ledger is the reviewable
 * record of what was changed *for that requester only* — a live UI manifest
 * applied to their profile, or a non-manifest code artifact parked for review.
 * Core PearlOS source is never mutated as a user feature; the ledger is how a
 * personal change later becomes eligible to be folded into core.
 *
 * These helpers are pure so they can be unit-tested without a database. The
 * ledger itself is persisted inside the requester's PearlOS user preferences
 * (see {@link PearlOSUserPreferences.personalChangeLedger}).
 */

export type StudioLedgerKind = 'ui_manifest' | 'code_artifact';
export type StudioLedgerStatus = 'applied' | 'needs_review' | 'failed';

/**
 * Optional share metadata stamped onto a ledger item once its owner publishes
 * the change to the public "Our PearlOS" catalog. Recording the share here keeps
 * the owner's ledger as the single source of truth for which of their personal
 * changes are public — and never implies the change mutated core PearlOS.
 */
export interface StudioLedgerShare {
  /** Id of the public catalog feature this change was published as. */
  publicFeatureId: string;
  /** When the owner shared it. */
  sharedAt: number;
  /** Always 'public' — sharing only publishes discovery metadata. */
  status: 'public';
}

export interface StudioLedgerItem {
  /** Stable id; repeated upserts with the same id update in place. */
  id: string;
  /** Plain-language title of the change (no internal task/run identifiers). */
  title: string;
  kind: StudioLedgerKind;
  status: StudioLedgerStatus;
  /** Plain-language summary of what the change does. */
  summary: string;
  /** Workspace-relative or absolute path to the artifact backing this change. */
  artifactPath: string;
  /**
   * Whether this change is eligible to be shared / folded into core PearlOS.
   * Applied UI manifests are share-eligible; un-reviewed code artifacts are not.
   */
  shareEligible: boolean;
  /**
   * Present once the owner has published this change to the public catalog.
   * A PearlOS change item is a record, not a runnable creation, so it never
   * carries a playUrl or any other launch affordance.
   */
  share?: StudioLedgerShare;
  createdAt: number;
  updatedAt: number;
}

export const STUDIO_LEDGER_MAX_ITEMS = 100;

const KINDS: ReadonlySet<StudioLedgerKind> = new Set<StudioLedgerKind>(['ui_manifest', 'code_artifact']);
const STATUSES: ReadonlySet<StudioLedgerStatus> = new Set<StudioLedgerStatus>([
  'applied',
  'needs_review',
  'failed',
]);

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

function safeLedgerId(value: unknown): string {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * Normalize untrusted share metadata. Returns undefined unless a stable public
 * feature id is present — a share record without one cannot be matched back to
 * the catalog and is dropped rather than guessed.
 */
export function normalizeStudioLedgerShare(raw: unknown, now: number): StudioLedgerShare | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const publicFeatureId = safeLedgerId(input.publicFeatureId);
  if (!publicFeatureId) return undefined;
  return {
    publicFeatureId,
    sharedAt: asNumber(input.sharedAt, now),
    status: 'public',
  };
}

/**
 * Normalize an untrusted ledger item. Returns null when the item cannot carry
 * a stable identity (no id) — such records are dropped rather than guessed.
 */
export function normalizeStudioLedgerItem(raw: unknown, now: number): StudioLedgerItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = safeLedgerId(input.id);
  if (!id) return null;
  const kind: StudioLedgerKind = KINDS.has(input.kind as StudioLedgerKind)
    ? (input.kind as StudioLedgerKind)
    : 'code_artifact';
  const status: StudioLedgerStatus = STATUSES.has(input.status as StudioLedgerStatus)
    ? (input.status as StudioLedgerStatus)
    : 'needs_review';
  // Only applied UI manifests may be share-eligible. A code artifact is never
  // share-eligible until a human review promotes it.
  const requestedShare = input.shareEligible === true;
  const shareEligible = requestedShare && kind === 'ui_manifest' && status === 'applied';
  const createdAt = asNumber(input.createdAt, now);
  const share = normalizeStudioLedgerShare(input.share, now);
  return {
    id,
    title: cleanText(input.title, 160) || 'Personal PearlOS change',
    kind,
    status,
    summary: cleanText(input.summary, 1200),
    artifactPath: cleanText(input.artifactPath, 400),
    shareEligible,
    ...(share ? { share } : {}),
    createdAt,
    updatedAt: asNumber(input.updatedAt, now),
  };
}

export function normalizeStudioLedger(raw: unknown, now: number): StudioLedgerItem[] {
  if (!Array.isArray(raw)) return [];
  const items: StudioLedgerItem[] = [];
  for (const entry of raw) {
    const normalized = normalizeStudioLedgerItem(entry, now);
    if (normalized) items.push(normalized);
  }
  return items;
}

/**
 * Insert or update a ledger item, matching on id. Preserves the original
 * createdAt, stamps updatedAt, and caps the ledger to the most recent items.
 */
export function upsertStudioLedgerItem(
  currentRaw: unknown,
  incomingRaw: unknown,
  now: number
): { ledger: StudioLedgerItem[]; item: StudioLedgerItem } | null {
  const incoming = normalizeStudioLedgerItem(incomingRaw, now);
  if (!incoming) return null;
  const current = normalizeStudioLedger(currentRaw, now);
  const prior = current.find((entry) => entry.id === incoming.id);
  const merged: StudioLedgerItem = {
    ...incoming,
    createdAt: prior ? prior.createdAt : incoming.createdAt,
    updatedAt: now,
    // A re-upsert from the worker carries no share metadata; preserve the
    // owner's prior share so re-reporting a change doesn't silently unpublish it.
    ...(incoming.share ? {} : prior?.share ? { share: prior.share } : {}),
  };
  const rest = current.filter((entry) => entry.id !== incoming.id);
  // Newest first, capped so an active account cannot grow the profile unbounded.
  const ledger = [merged, ...rest].slice(0, STUDIO_LEDGER_MAX_ITEMS);
  return { ledger, item: merged };
}

/** Find a single normalized ledger item by id (after id-sanitization). */
export function findStudioLedgerItem(
  ledgerRaw: unknown,
  itemId: string,
  now: number
): StudioLedgerItem | null {
  const id = safeLedgerId(itemId);
  if (!id) return null;
  return normalizeStudioLedger(ledgerRaw, now).find((entry) => entry.id === id) ?? null;
}

/**
 * Stamp share metadata onto an owner's ledger item. Returns null when the item
 * is missing or is not share-eligible — only an applied, share-eligible change
 * may be published. The returned ledger keeps the item in place (no reordering)
 * so publishing does not disturb the owner's review history.
 */
export function markStudioLedgerItemShared(
  ledgerRaw: unknown,
  itemId: string,
  share: StudioLedgerShare,
  now: number
): { ledger: StudioLedgerItem[]; item: StudioLedgerItem } | null {
  const ledger = normalizeStudioLedger(ledgerRaw, now);
  const id = safeLedgerId(itemId);
  const idx = ledger.findIndex((entry) => entry.id === id);
  if (idx === -1) return null;
  const target = ledger[idx];
  if (!target.shareEligible) return null;
  const normalizedShare = normalizeStudioLedgerShare(share, now);
  if (!normalizedShare) return null;
  const item: StudioLedgerItem = { ...target, share: normalizedShare, updatedAt: now };
  const next = [...ledger];
  next[idx] = item;
  return { ledger: next, item };
}
