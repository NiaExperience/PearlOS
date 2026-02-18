import {
  IConversationSummary,
  ISessionHistoryEntry,
  IUserProfile,
} from '@nia/prism/core/blocks/userProfile.block';

export type ConversationSummarySource = 'lastConversationSummary' | 'sessionHistory';

export interface ConversationSummaryDetail {
  timestamp?: string;
  summary: string;
  source: ConversationSummarySource;
  resourceId?: string;
}

export interface ConversationSummaryGroup {
  sessionId?: string;
  assistantName?: string;
  participantCount?: number;
  durationSeconds?: number;
  latestTimestamp?: string;
  items: ConversationSummaryDetail[];
}

interface InternalSummaryGroup extends ConversationSummaryGroup {
  key: string;
  latestTimestampValue: number;
}

const NO_SESSION_KEY_PREFIX = '__conversation_summary_no_session__';
const CONVERSATION_SUMMARY_TYPE = 'conversation-summary';

function parseTimestamp(value?: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

function normaliseSessionId(sessionId?: string | null): string | undefined {
  if (!sessionId) return undefined;
  const trimmed = sessionId.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function ensureGroup(
  groups: Map<string, InternalSummaryGroup>,
  sessionId: string | undefined,
  fallbackIndex: () => number,
): InternalSummaryGroup {
  const key = sessionId ?? `${NO_SESSION_KEY_PREFIX}${fallbackIndex()}`;
  const existing = groups.get(key);
  if (existing) {
    return existing;
  }

  const group: InternalSummaryGroup = {
    key,
    sessionId,
    items: [],
    assistantName: undefined,
    participantCount: undefined,
    durationSeconds: undefined,
    latestTimestamp: undefined,
    latestTimestampValue: Number.NEGATIVE_INFINITY,
  };

  groups.set(key, group);
  return group;
}

function addDetail(group: InternalSummaryGroup, detail: ConversationSummaryDetail): void {
  group.items.push(detail);
  const numericTimestamp = parseTimestamp(detail.timestamp);
  if (numericTimestamp > group.latestTimestampValue) {
    group.latestTimestampValue = numericTimestamp;
    group.latestTimestamp = detail.timestamp;
  }
}

function addConversationSummary(
  groups: Map<string, InternalSummaryGroup>,
  summary: IConversationSummary,
  fallbackIndex: () => number,
): void {
  const sessionId = normaliseSessionId(summary.sessionId);
  const group = ensureGroup(groups, sessionId, fallbackIndex);

  group.assistantName = group.assistantName ?? summary.assistantName;
  group.participantCount = group.participantCount ?? summary.participantCount;
  group.durationSeconds = group.durationSeconds ?? summary.durationSeconds;

  if (summary.summary && summary.summary.trim().length > 0) {
    addDetail(group, {
      timestamp: summary.timestamp,
      summary: summary.summary.trim(),
      source: 'lastConversationSummary',
    });
  }
}

function extractSessionHistorySummaries(entry: ISessionHistoryEntry): ConversationSummaryDetail[] {
  if (!entry.refIds || entry.refIds.length === 0) {
    return [];
  }

  return entry.refIds
    .filter(ref => ref && typeof ref.type === 'string')
    .filter(ref => ref.type.toLowerCase() === CONVERSATION_SUMMARY_TYPE)
    .map(ref => ({
      timestamp: entry.time,
      summary: (ref.description ?? '').trim(),
      resourceId: ref.id,
      source: 'sessionHistory' as const,
    }))
    .filter(detail => detail.summary.length > 0);
}

function addSessionHistoryEntry(
  groups: Map<string, InternalSummaryGroup>,
  entry: ISessionHistoryEntry,
  fallbackIndex: () => number,
): void {
  if (entry.action !== 'session-summary') {
    return;
  }

  const summaries = extractSessionHistorySummaries(entry);
  if (summaries.length === 0) {
    return;
  }

  const sessionId = normaliseSessionId(entry.sessionId);
  const group = ensureGroup(groups, sessionId, fallbackIndex);

  summaries.forEach(summary => addDetail(group, summary));
}

export function buildConversationSummaries(profile?: IUserProfile | null): ConversationSummaryGroup[] {
  if (!profile) {
    return [];
  }

  const groups = new Map<string, InternalSummaryGroup>();
  let fallbackCounter = 0;
  const nextFallbackIndex = () => ++fallbackCounter;

  if (profile.lastConversationSummary) {
    addConversationSummary(groups, profile.lastConversationSummary, nextFallbackIndex);
  }

  if (Array.isArray(profile.sessionHistory)) {
    profile.sessionHistory.forEach(entry => {
      addSessionHistoryEntry(groups, entry, nextFallbackIndex);
    });
  }

  const result = Array.from(groups.values())
    .map(group => {
      const sortedItems = [...group.items].sort(
        (a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp),
      );

      const mapped: ConversationSummaryGroup = {
        sessionId: group.sessionId,
        assistantName: group.assistantName,
        participantCount: group.participantCount,
        durationSeconds: group.durationSeconds,
        latestTimestamp: group.latestTimestamp,
        items: sortedItems,
      };

      return mapped;
    })
    .filter(group => group.items.length > 0);

  return result.sort((a, b) => {
    const aValue = parseTimestamp(a.latestTimestamp);
    const bValue = parseTimestamp(b.latestTimestamp);
    if (aValue === bValue) {
      return 0;
    }
    return bValue - aValue;
  });
}

export function hasConversationSummaries(profile?: IUserProfile | null): boolean {
  if (!profile) {
    return false;
  }

  if (profile.lastConversationSummary && profile.lastConversationSummary.summary?.trim()) {
    return true;
  }

  return Array.isArray(profile.sessionHistory)
    ? profile.sessionHistory.some(entry => entry.action === 'session-summary' && extractSessionHistorySummaries(entry).length > 0)
    : false;
}
