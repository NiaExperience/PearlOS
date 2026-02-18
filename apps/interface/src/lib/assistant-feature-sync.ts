import { FeatureKeys, type FeatureKey, isFeatureEnabled } from '@nia/features';

const DAILY_CALL_TARGET_ALIASES = new Set(
  [
    'dailycall',
    'daily-call',
    'daily',
    'call',
    'social',
    'video-call',
    'meeting',
  ].map(alias => alias.toLowerCase())
);

function normalizeTarget(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.toLowerCase();
}

function payloadTargetsDailyCall(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const record = payload as Record<string, unknown>;
  const appsField = record.apps;

  if (Array.isArray(appsField)) {
    if (appsField.some(entry => DAILY_CALL_TARGET_ALIASES.has(normalizeTarget(entry) ?? ''))) {
      return true;
    }
  }

  const viewType = normalizeTarget(record.viewType);
  if (viewType && DAILY_CALL_TARGET_ALIASES.has(viewType)) {
    return true;
  }

  const target = normalizeTarget(record.target);
  if (target && DAILY_CALL_TARGET_ALIASES.has(target)) {
    return true;
  }

  return false;
}

export function coerceFeatureKeyList(raw: unknown): FeatureKey[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const set = new Set<FeatureKey>();
  for (const item of raw) {
    if (typeof item === 'string' && FeatureKeys.includes(item as FeatureKey)) {
      set.add(item as FeatureKey);
    }
  }

  return FeatureKeys.filter(key => set.has(key));
}

interface NiaEventLike {
  event?: unknown;
  payload?: unknown;
}

export function isAssistantSelfCloseNiaEvent(envelope: NiaEventLike | null | undefined): boolean {
  if (!envelope || typeof envelope !== 'object') {
    return false;
  }

  const eventName = typeof envelope.event === 'string' ? envelope.event : '';

  if (eventName === 'apps.close') {
    return payloadTargetsDailyCall(envelope.payload);
  }

  if (eventName === 'bot.session.end') {
    return true;
  }

  return false;
}
