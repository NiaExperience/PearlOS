/**
 * Durable store for user-shared "Our PearlOS" features.
 *
 * When an owner shares one of their personal PearlOS changes from Studio, the
 * change's discovery metadata (title, summary, the artifact/manifest path that
 * backs it) is published here as a community feature. Other users can then see
 * and vote on it, and an operator can later incorporate it into core through the
 * separate, human-reviewed integration process.
 *
 * Sharing publishes *metadata only*. Nothing in this store runs, mutates shared
 * state, or touches core PearlOS source — the artifact path is retained server
 * side purely so a later incorporation step can find the original work. It is
 * deliberately never returned to the public catalog reader.
 *
 * The pure helpers (build / normalize / upsert / toPublic / ownership) carry the
 * model so they can be unit-tested without touching disk; the read/write pair at
 * the bottom is the only part that performs IO.
 */

import { promises as fs } from 'fs';

import type { StudioLedgerItem } from './studio-ledger';
import type { PublicFeature } from './our-pearlos-catalog';

/** Resolved per call so the storage path can be configured at runtime. */
function sharedFeaturesFile(): string {
  return process.env.PEARL_SHARED_FEATURES_FILE || '/tmp/pearlos-shared-features.json';
}

/** Cap so the shared catalog cannot grow without bound. */
export const SHARED_FEATURES_MAX_ITEMS = 500;

export interface SharedFeatureRecord {
  /** Public catalog id; derived from the owner + source ledger item. */
  id: string;
  /** Plain-language title (no internal task/run identifiers). */
  title: string;
  /** Plain-language summary of what the feature does. */
  summary: string;
  /** Optional short grouping label shown in the catalog. */
  category?: string;
  /**
   * Path to the artifact/manifest backing the shared change. Retained for a
   * later incorporation step only — NEVER surfaced to the public reader.
   */
  artifactPath: string;
  /** Account that shared it (userId or, as a fallback, email). */
  sharedByUserId: string;
  /** Tenant of the sharing account; scopes owner-only mutation. */
  sharedByTenantId: string;
  /** The owner ledger item this share was published from. */
  sourceLedgerItemId: string;
  /** Baseline community interest; user-shared features start at zero. */
  baseVotes: number;
  /** Optional public launch URL for shared Studio creations. */
  launchUrl?: string;
  /** Origin kind for install handling. */
  sourceType?: 'feature' | 'studio_creation';
  createdAt: number;
  updatedAt: number;
}

export interface SharedFeatureOwner {
  userId: string;
  tenantId: string;
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

// Cap matches our-pearlos-catalog's safeFeatureId so a shared id round-trips
// through the catalog/vote validators unchanged.
function safeId(value: unknown): string {
  return cleanText(value, 160)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Public catalog id for a change shared by a given owner. */
export function sharedFeatureId(sourceLedgerItemId: string): string {
  const base = safeId(sourceLedgerItemId);
  return base ? `shared-${base}`.slice(0, 96) : '';
}

/**
 * Build a shareable feature record from an owner's ledger item. Returns null
 * when the item is not share-eligible — only an applied, share-eligible change
 * may be published. The caller supplies the owner identity so the record is
 * scoped for later owner-only mutation.
 */
export function buildSharedFeatureFromLedgerItem(
  item: StudioLedgerItem,
  owner: SharedFeatureOwner,
  now: number,
  category?: string
): SharedFeatureRecord | null {
  if (!item || !item.shareEligible) return null;
  const ownerUserId = safeId(owner.userId);
  const ownerTenantId = safeId(owner.tenantId) || 'unknown';
  if (!ownerUserId) return null;
  const id = sharedFeatureId(item.id);
  if (!id) return null;
  return {
    id,
    title: cleanText(item.title, 160) || 'Shared PearlOS change',
    summary: cleanText(item.summary, 1200),
    ...(category ? { category: cleanText(category, 60) } : {}),
    artifactPath: cleanText(item.artifactPath, 400),
    sharedByUserId: ownerUserId,
    sharedByTenantId: ownerTenantId,
    sourceLedgerItemId: safeId(item.id),
    baseVotes: 0,
    sourceType: 'feature',
    createdAt: now,
    updatedAt: now,
  };
}

export interface ShareableLaunchpadProject {
  id: string;
  title: string;
  content?: string;
  type?: string;
  outputPath?: string;
  playUrl?: string;
}

export function buildSharedFeatureFromLaunchpadProject(
  project: ShareableLaunchpadProject,
  owner: SharedFeatureOwner,
  now: number,
  category?: string
): SharedFeatureRecord | null {
  const ownerUserId = safeId(owner.userId);
  const ownerTenantId = safeId(owner.tenantId) || 'unknown';
  const projectId = safeId(project.id);
  if (!ownerUserId || !projectId || !project.playUrl) return null;
  const id = sharedFeatureId(`project-${projectId}`);
  if (!id) return null;
  const summary = cleanText(project.content, 1200) || 'A community-shared Studio creation you can add to your PearlOS desktop.';
  return {
    id,
    title: cleanText(project.title, 160) || 'Shared Studio app',
    summary,
    category: cleanText(category, 60) || cleanText(project.type, 60) || 'Studio app',
    artifactPath: cleanText(project.outputPath || project.playUrl, 400),
    sharedByUserId: ownerUserId,
    sharedByTenantId: ownerTenantId,
    sourceLedgerItemId: `project-${projectId}`.slice(0, 96),
    baseVotes: 0,
    launchUrl: cleanText(project.playUrl, 400),
    sourceType: 'studio_creation',
    createdAt: now,
    updatedAt: now,
  };
}

/** Normalize an untrusted record from disk; drops anything without an identity. */
export function normalizeSharedFeature(raw: unknown, now: number): SharedFeatureRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = safeId(input.id);
  const sharedByUserId = safeId(input.sharedByUserId);
  const sourceLedgerItemId = safeId(input.sourceLedgerItemId);
  if (!id || !sharedByUserId || !sourceLedgerItemId) return null;
  const category = cleanText(input.category, 60);
  const launchUrl = cleanText(input.launchUrl, 400);
  const sourceType = input.sourceType === 'studio_creation' ? 'studio_creation' : 'feature';
  return {
    id,
    title: cleanText(input.title, 160) || 'Shared PearlOS change',
    summary: cleanText(input.summary, 1200),
    ...(category ? { category } : {}),
    artifactPath: cleanText(input.artifactPath, 400),
    sharedByUserId,
    sharedByTenantId: safeId(input.sharedByTenantId) || 'unknown',
    sourceLedgerItemId,
    baseVotes: Math.min(asNumber(input.baseVotes, 0), 1_000_000),
    ...(launchUrl ? { launchUrl } : {}),
    sourceType,
    createdAt: asNumber(input.createdAt, now),
    updatedAt: asNumber(input.updatedAt, now),
  };
}

export function normalizeSharedFeatures(raw: unknown, now: number): SharedFeatureRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: SharedFeatureRecord[] = [];
  for (const entry of raw) {
    const normalized = normalizeSharedFeature(entry, now);
    if (normalized) out.push(normalized);
  }
  return out;
}

/** True when a record belongs to the given owner (tenant + user must match). */
export function ownerOwnsSharedFeature(
  record: SharedFeatureRecord,
  owner: SharedFeatureOwner
): boolean {
  return (
    record.sharedByTenantId === (safeId(owner.tenantId) || 'unknown') &&
    record.sharedByUserId === safeId(owner.userId)
  );
}

/**
 * Insert or update a shared feature, matching on its public id (one share per
 * source ledger item). Re-sharing updates the metadata in place, preserves the
 * original createdAt and accumulated baseVotes, and refuses to overwrite another
 * account's record so a client cannot hijack someone else's published feature.
 */
export function upsertSharedFeature(
  currentRaw: unknown,
  incoming: SharedFeatureRecord,
  now: number
): { features: SharedFeatureRecord[]; feature: SharedFeatureRecord } | null {
  const current = normalizeSharedFeatures(currentRaw, now);
  const prior = current.find((entry) => entry.id === incoming.id);
  if (
    prior &&
    !ownerOwnsSharedFeature(prior, {
      userId: incoming.sharedByUserId,
      tenantId: incoming.sharedByTenantId,
    })
  ) {
    return null;
  }
  const feature: SharedFeatureRecord = {
    ...incoming,
    createdAt: prior ? prior.createdAt : incoming.createdAt,
    baseVotes: prior ? prior.baseVotes : incoming.baseVotes,
    updatedAt: now,
  };
  const rest = current.filter((entry) => entry.id !== incoming.id);
  const features = [feature, ...rest].slice(0, SHARED_FEATURES_MAX_ITEMS);
  return { features, feature };
}

/**
 * Project a stored record to the public catalog shape. Owner identity and the
 * server-side artifact path are intentionally stripped — only discovery fields
 * reach the public reader.
 */
export function sharedFeatureToPublic(record: SharedFeatureRecord): PublicFeature {
  return {
    id: record.id,
    title: record.title,
    summary: record.summary,
    status: 'community',
    baseVotes: record.baseVotes,
    ...(record.category ? { category: record.category } : {}),
    ...(record.launchUrl ? { launchUrl: record.launchUrl } : {}),
    ...(record.sourceType ? { sourceType: record.sourceType } : {}),
  };
}

export function sharedFeaturesToPublic(records: SharedFeatureRecord[]): PublicFeature[] {
  return records.map(sharedFeatureToPublic);
}

// ── IO ───────────────────────────────────────────────────────────────────────

export async function readSharedFeatures(): Promise<SharedFeatureRecord[]> {
  try {
    const raw = await fs.readFile(sharedFeaturesFile(), 'utf-8');
    const parsed = JSON.parse(raw);
    return normalizeSharedFeatures(parsed?.features, Date.now());
  } catch {
    return [];
  }
}

export async function writeSharedFeatures(features: SharedFeatureRecord[]): Promise<void> {
  await fs.writeFile(sharedFeaturesFile(), JSON.stringify({ features }, null, 2), 'utf-8');
}
