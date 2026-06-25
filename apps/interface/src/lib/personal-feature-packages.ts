/**
 * Account-local PearlOS feature packages.
 *
 * These are the safe bridge between "a user asked the Agency to make a
 * PearlOS feature" and "that feature appears in Studio and can later be shared
 * to Our PearlOS." A package is declarative metadata around a sandboxed Studio
 * artifact. It does not grant source-write access or execute server code.
 */

export type PersonalFeatureExtensionPoint = 'desktop.shortcut' | 'agency.toolbar';

export interface PersonalFeatureShortcut {
  enabled: boolean;
  emoji?: string;
  iconSrc?: string;
}

export interface PersonalFeaturePackageRecord {
  id: string;
  schemaVersion: 1;
  title: string;
  summary: string;
  extensionPoint: PersonalFeatureExtensionPoint;
  entrypoint: string;
  artifactPath: string;
  launchUrl?: string;
  desktopShortcut?: PersonalFeatureShortcut;
  shareEligible: boolean;
  permissions: string[];
  createdAt: number;
  updatedAt: number;
}

export interface BuildPersonalFeatureRecordInput {
  manifest: unknown;
  artifactPath: string;
  fallbackId?: string;
  fallbackTitle?: string;
  fallbackSummary?: string;
  fallbackLaunchUrl?: string;
}

export const PERSONAL_FEATURE_PACKAGES_MAX_ITEMS = 100;

const EXTENSION_POINTS: ReadonlySet<PersonalFeatureExtensionPoint> = new Set([
  'desktop.shortcut',
  'agency.toolbar',
]);

const ALLOWED_PERMISSIONS = new Set(['open-window']);

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, limit) : '';
}

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

function cleanEntrypoint(value: unknown): string {
  const text = cleanText(value, 160).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!text || text.startsWith('/') || text.includes('://')) return 'index.html';
  const parts = text.split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) return 'index.html';
  const joined = parts.join('/');
  if (!/^[a-zA-Z0-9._/-]+$/.test(joined)) return 'index.html';
  return joined;
}

function cleanLaunchUrl(value: unknown): string {
  const text = cleanText(value, 400);
  if (!text || !text.startsWith('/api/creation/') || text.startsWith('//')) return '';
  if (text.includes('..') || text.includes('\\') || text.includes('://')) return '';
  return text;
}

function cleanIconSrc(value: unknown): string {
  const text = cleanText(value, 400);
  if (!text || text.startsWith('//') || text.includes('..') || text.includes('\\') || text.includes('://')) {
    return '';
  }
  return text.startsWith('/api/creation/') ? text : '';
}

function normalizeShortcut(raw: unknown, extensionPoint: PersonalFeatureExtensionPoint): PersonalFeatureShortcut | undefined {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const enabled = input.enabled === false ? false : extensionPoint === 'desktop.shortcut';
  if (!enabled) return { enabled: false };
  const emoji = cleanText(input.emoji, 8);
  const iconSrc = cleanIconSrc(input.iconSrc);
  return {
    enabled: true,
    ...(emoji ? { emoji } : {}),
    ...(iconSrc ? { iconSrc } : {}),
  };
}

function normalizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const permission = cleanText(value, 60);
    if (permission && ALLOWED_PERMISSIONS.has(permission) && !out.includes(permission)) {
      out.push(permission);
    }
  }
  return out.slice(0, 5);
}

export function buildPersonalFeaturePackageRecord(
  input: BuildPersonalFeatureRecordInput,
  now: number
): PersonalFeaturePackageRecord | null {
  if (!input.manifest || typeof input.manifest !== 'object' || Array.isArray(input.manifest)) return null;
  const manifest = input.manifest as Record<string, unknown>;
  const id = safeId(manifest.id) || safeId(input.fallbackId);
  if (!id) return null;
  const extensionPoint = EXTENSION_POINTS.has(manifest.extensionPoint as PersonalFeatureExtensionPoint)
    ? (manifest.extensionPoint as PersonalFeatureExtensionPoint)
    : 'desktop.shortcut';
  const title = cleanText(manifest.title, 160) || cleanText(input.fallbackTitle, 160) || 'Personal PearlOS feature';
  const summary = cleanText(manifest.summary, 1200)
    || cleanText(input.fallbackSummary, 1200)
    || 'A personal PearlOS feature package created in this account.';
  const artifactPath = cleanText(input.artifactPath, 400);
  if (!artifactPath) return null;
  const launchUrl = cleanLaunchUrl(manifest.launchUrl) || cleanLaunchUrl(input.fallbackLaunchUrl);
  return {
    id,
    schemaVersion: 1,
    title,
    summary,
    extensionPoint,
    entrypoint: cleanEntrypoint(manifest.entrypoint),
    artifactPath,
    ...(launchUrl ? { launchUrl } : {}),
    desktopShortcut: normalizeShortcut(manifest.desktopShortcut, extensionPoint),
    shareEligible: manifest.shareEligible === true,
    permissions: normalizePermissions(manifest.permissions),
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizePersonalFeaturePackageRecord(
  raw: unknown,
  now: number
): PersonalFeaturePackageRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = safeId(input.id);
  const artifactPath = cleanText(input.artifactPath, 400);
  if (!id || !artifactPath) return null;
  const extensionPoint = EXTENSION_POINTS.has(input.extensionPoint as PersonalFeatureExtensionPoint)
    ? (input.extensionPoint as PersonalFeatureExtensionPoint)
    : 'desktop.shortcut';
  const launchUrl = cleanLaunchUrl(input.launchUrl);
  return {
    id,
    schemaVersion: 1,
    title: cleanText(input.title, 160) || 'Personal PearlOS feature',
    summary: cleanText(input.summary, 1200),
    extensionPoint,
    entrypoint: cleanEntrypoint(input.entrypoint),
    artifactPath,
    ...(launchUrl ? { launchUrl } : {}),
    desktopShortcut: normalizeShortcut(input.desktopShortcut, extensionPoint),
    shareEligible: input.shareEligible === true,
    permissions: normalizePermissions(input.permissions),
    createdAt: asNumber(input.createdAt, now),
    updatedAt: asNumber(input.updatedAt, now),
  };
}

export function normalizePersonalFeaturePackages(raw: unknown, now: number): PersonalFeaturePackageRecord[] {
  const entries = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.values(raw as Record<string, unknown>)
      : [];
  const out: PersonalFeaturePackageRecord[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const normalized = normalizePersonalFeaturePackageRecord(entry, now);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out.slice(0, PERSONAL_FEATURE_PACKAGES_MAX_ITEMS);
}

export function upsertPersonalFeaturePackage(
  currentRaw: unknown,
  incoming: PersonalFeaturePackageRecord,
  now: number
): { packages: PersonalFeaturePackageRecord[]; package: PersonalFeaturePackageRecord } | null {
  const normalized = normalizePersonalFeaturePackageRecord({ ...incoming, updatedAt: now }, now);
  if (!normalized) return null;
  const current = normalizePersonalFeaturePackages(currentRaw, now);
  const prior = current.find((entry) => entry.id === normalized.id);
  const record: PersonalFeaturePackageRecord = {
    ...normalized,
    createdAt: prior ? prior.createdAt : normalized.createdAt,
    updatedAt: now,
  };
  const rest = current.filter((entry) => entry.id !== record.id);
  return {
    packages: [record, ...rest].slice(0, PERSONAL_FEATURE_PACKAGES_MAX_ITEMS),
    package: record,
  };
}
