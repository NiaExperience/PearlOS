/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prism, PrismContentQuery, PrismContentResult } from '@nia/prism';
import { BlockType_UserProfile, IOnboardingState, IPrivateMemory, IPublicPersona, IUserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { NextAuthOptions } from 'next-auth';

import { getSessionSafely } from '../auth/getSessionSafely';
import { getLogger, setLogContext } from '../logger';
import { UserProfileDefinition } from '../platform-definitions';

const log = getLogger('prism:actions:user-profile');
const MAX_LAST_CONVERSATION_SUMMARY_CHARS = Number.parseInt(
  process.env.USER_PROFILE_MAX_LAST_CONVERSATION_SUMMARY_CHARS || '4000',
  10
);

function trimStoredText(value: any, maxChars: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}...`;
}

function sanitizeConversationSummary<T extends Record<string, any> | undefined>(
  summary: T
): T {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return summary;
  }

  const next = { ...summary };
  if (next.summary !== undefined) {
    next.summary = trimStoredText(next.summary, MAX_LAST_CONVERSATION_SUMMARY_CHARS);
  }
  return next as T;
}

export async function createUserProfileDefinition() {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(UserProfileDefinition);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create UserProfile definition');
  }
  return created.items[0];
}

export async function ensureUserProfileDefinition(operation: () => Promise<any>) {
  try {
    return await operation();
  } catch (error) {
    const msg = `Content definition for type "${BlockType_UserProfile}" not found.`;
    if (error instanceof Error && error.message.includes(msg)) {
      await createUserProfileDefinition();
      return await operation();
    }
    throw error;
  }
}

// Best-effort normalization for humanized email strings like "bob at example dot com"
export function normalizeHumanizedEmail(input: string): string {
  if (!input) return input;
  let s = String(input).trim();
  s = s.replace(/\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\}/gi, '@');
  s = s.replace(/\(\s*(dot|period)\s*\)|\[\s*(dot|period)\s*\]|\{\s*(dot|period)\s*\}/gi, '.');
  s = s.replace(/\bat\b/gi, '@');
  s = s.replace(/\b(dot|period)\b/gi, '.');
  s = s.replace(/\s*@\s*/g, '@');
  s = s.replace(/\s*\.\s*/g, '.');
  // eslint-disable-next-line no-useless-escape
  s = s.replace(/[\[\]\(\)\{\}]/g, '');
  s = s.replace(/\s+/g, '');
  s = s.replace(/@+/g, '@').replace(/\.{2,}/g, '.');
  return s;
}

/**
 * De-stringifies legacy metadata values. Older records stored metadata as JSON strings;
 * this unwraps them back into objects. Kept internal; callers should use migrateUserProfileRecord.
 */
function normalizeLegacyMetadata(metadata: any): Record<string, any> | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }

  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata;
  }

  if (typeof metadata === 'string' && metadata.trim().startsWith('{') && metadata.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(metadata);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        log.debug('De-stringified legacy metadata', {
          metadataKeys: Object.keys(parsed),
        });
        return parsed;
      }
    } catch (e) {
        log.warn('Failed to parse metadata as JSON, keeping as-is', { error: e });
    }
  }

  if (typeof metadata === 'string') {
    return { value: metadata };
  }

  return undefined;
}

/**
 * Read-time migration: folds a legacy `metadata` bag (if present) into the new
 * `privateMemory.preferences` structure, so downstream code only sees the new
 * shape. Existing `privateMemory` values win over migrated metadata keys on
 * conflict — the new model is authoritative.
 *
 * This mutates the record in place and returns it. The `metadata` field is
 * removed from the returned object so consumers don't accidentally read stale
 * data. Storage is not touched here; the next write will persist the new shape.
 */
export function migrateUserProfileRecord<T extends IUserProfile | Record<string, any>>(
  record: T | null | undefined
): T | null | undefined {
  if (!record) return record;

  const legacy = normalizeLegacyMetadata((record as any).metadata);
  if (legacy && Object.keys(legacy).length > 0) {
    const privateMemory: IPrivateMemory = { ...((record as any).privateMemory || {}) };
    const existingPreferences = privateMemory.preferences || {};
    // New privateMemory.preferences keys take precedence over legacy metadata on conflict.
    privateMemory.preferences = { ...legacy, ...existingPreferences };
    (record as any).privateMemory = privateMemory;
    log.debug('Migrated legacy metadata into privateMemory.preferences', {
      profileId: (record as any)._id,
      migratedKeys: Object.keys(legacy),
    });
  }

  // Strip the legacy field from the returned object so consumers use the new shape.
  if ('metadata' in (record as any)) {
    delete (record as any).metadata;
  }

  if ((record as any).lastConversationSummary !== undefined) {
    (record as any).lastConversationSummary = sanitizeConversationSummary(
      (record as any).lastConversationSummary
    );
  }

  return record;
}

/**
 * @deprecated Prefer {@link migrateUserProfileRecord}. Kept as an internal alias.
 */
export const normalizeMetadata = normalizeLegacyMetadata;

/**
 * Backfill UserProfile records for a given tenant/email with the resolved userId
 */
export async function backfillUserIdByEmail(email: string, userId: string) {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_UserProfile,
    tenantId: 'any',
    where: { type: { eq: BlockType_UserProfile }, indexer: { path: 'email', equals: email } },
    limit: 100,
  } as PrismContentQuery);
  const found: PrismContentResult = await ensureUserProfileDefinition(op);
  if (!found?.total) return { updated: 0 };
  let updated = 0;
  for (const item of found.items as any[]) {
    const id = item._id || item.page_id;
    if (!id) continue;
    const copy = { ...item, userId };
    try {
      await prism.update(BlockType_UserProfile, id, copy);
      updated += 1;
    } catch (error) {
      log.error('Failed to backfill userId for UserProfile', { userId, profileId: id, error });
    }
  }
  return { updated };
}


/**
 * Find UserProfile records by email
 */
export async function findByEmail(email: string) {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_UserProfile,
    tenantId: 'any',
    where: { type: { eq: BlockType_UserProfile }, indexer: { path: 'email', equals: email } },
    limit: 100,
  } as PrismContentQuery);
  const found: PrismContentResult = await ensureUserProfileDefinition(op);
  const userProfile = found?.total ? (found.items[0] as IUserProfile) : null;
  if (!userProfile) {
    return null;
  }

  migrateUserProfileRecord(userProfile);

  return { userProfile };
}

/**
 * Find UserProfile using session info (user id or email)
 */
export async function findByUser(id: string | undefined, email: string | undefined) {
  if (id) {
    const res = await findByUserId(id);
    if (res) {
      return res;
    }
  }
  if (email) {
    const res = await findByEmail(email);
    if (res && id && email) {
      log.info('Backfilling userId for UserProfile', { email, userId: id });
      await backfillUserIdByEmail(email, id);
      return res;
    }
  }
  return null;
}

/**
 * Find UserProfile records by userId
 */
export async function findByUserId(userId: string) {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_UserProfile,
    tenantId: 'any',
    where: { type: { eq: BlockType_UserProfile }, indexer: { path: 'userId', equals: userId } },
    limit: 100,
  } as PrismContentQuery);
  const found: PrismContentResult = await ensureUserProfileDefinition(op);
  const userProfile = found?.total ? (found.items[0] as IUserProfile) : null;
  if (!userProfile) {
    return null;
  }

  migrateUserProfileRecord(userProfile);

  return { userProfile };
}

/**
 * Find UserProfile records by id
 */
export async function findById(id: string) {
  const prism = await Prism.getInstance();
  const op = async () => await prism.query({
    contentType: BlockType_UserProfile,
    tenantId: 'any',
    where: { type: { eq: BlockType_UserProfile }, page_id: { eq: id } },
    limit: 100,
  } as PrismContentQuery);
  const found: PrismContentResult = await ensureUserProfileDefinition(op);
  const userProfile = found?.total ? (found.items[0] as IUserProfile) : null;
  if (!userProfile) {
    return null;
  }

  migrateUserProfileRecord(userProfile);

  return { userProfile };
}

/**
 * Checks for duplicate email addresses, excluding the current record if provided
 */
async function checkForDuplicateEmail(normalizedEmail: string, currentId?: string): Promise<void> {
  try {
    const prism = await Prism.getInstance();
    const op = async () => (await prism.query({
      contentType: UserProfileDefinition.dataModel.block,
      where: {
        type: { eq: UserProfileDefinition.dataModel.block },
        indexer: { path: 'email', equals: normalizedEmail },
      },
      limit: 10,
      tenantId: 'any',
    } as any)) as any;

    const duplicateCheck = await ensureUserProfileDefinition(op);
    if (duplicateCheck?.total && duplicateCheck.total > 0) {
      const hasDifferentDuplicate = duplicateCheck.items.some((item: any) => {
        const itemId = item._id || item.page_id;
        return itemId !== currentId;
      });
      if (hasDifferentDuplicate) {
        log.error('Duplicate email found for UserProfile', { normalizedEmail, currentId });
        throw new Error('DUPLICATE_EMAIL');
      }
    }
  } catch (e) {
    if ((e as Error).message === 'DUPLICATE_EMAIL') {
      throw e;
    }
    log.error('Error searching for existing UserProfile', { normalizedEmail, currentId, error: e });
    throw e;
  }
}

interface CreateOrUpdateUserProfileParams {
  first_name?: string;
  id?: string;
  userId?: string;
  email?: string;
  publicPersona?: IPublicPersona;
  privateMemory?: IPrivateMemory;
  personalityVoiceConfig?: Record<string, any>;
  lastConversationSummary?: Record<string, any>;
  onboardingComplete?: boolean;
  onboardingState?: IOnboardingState;
  overlayDismissed?: boolean;
}

/**
 * Deep-merges two plain objects one level deep (nested objects are merged;
 * arrays and primitives from the incoming object replace the existing value).
 * Used so a partial update to e.g. publicPersona.socialLinks doesn't clobber
 * the whole persona.
 */
function shallowMergeStructured<T extends Record<string, any>>(
  existing: T | undefined,
  incoming: Partial<T> | undefined
): T | undefined {
  if (!incoming) return existing;
  const base: Record<string, any> = { ...(existing || {}) };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const prev = base[key];
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      prev &&
      typeof prev === 'object' &&
      !Array.isArray(prev)
    ) {
      base[key] = { ...prev, ...value };
    } else {
      base[key] = value;
    }
  }
  return base as T;
}

export function mergeUserProfileOnboardingState(
  existing: IOnboardingState | undefined,
  incoming: Partial<IOnboardingState> | undefined
): IOnboardingState | undefined {
  return shallowMergeStructured<IOnboardingState>(existing, incoming);
}

function stableJson(value: any): string {
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (
        nestedValue &&
        typeof nestedValue === 'object' &&
        !Array.isArray(nestedValue)
      ) {
        return Object.keys(nestedValue)
          .sort()
          .reduce((acc: Record<string, any>, key) => {
            acc[key] = nestedValue[key];
            return acc;
          }, {});
      }
      return nestedValue;
    });
  } catch {
    return String(value);
  }
}

function valuesEqual(a: any, b: any): boolean {
  return stableJson(a) === stableJson(b);
}

function profileUpdateContent(existing: IUserProfile): Record<string, any> {
  const content: Record<string, any> = {
    first_name: existing.first_name,
    email: existing.email,
  };
  for (const key of [
    'userId',
    'onboardingComplete',
    'onboardingState',
    'overlayDismissed',
    'createdAt',
    'publicPersona',
    'privateMemory',
    'sessionHistory',
    'personalityVoiceConfig',
    'lastConversationSummary',
  ]) {
    const value = (existing as any)[key];
    if (value !== undefined) {
      content[key] = key === 'lastConversationSummary'
        ? sanitizeConversationSummary(value)
        : value;
    }
  }
  return content;
}

export async function createOrUpdateUserProfile({
  first_name,
  email,
  publicPersona,
  privateMemory,
  id,
  userId,
  personalityVoiceConfig,
  lastConversationSummary,
  onboardingComplete,
  onboardingState,
  overlayDismissed
}: CreateOrUpdateUserProfileParams, removeUserId: boolean) {
    log.debug('createOrUpdateUserProfile called', { userId, id, email });
    try {
      const sanitizedLastConversationSummary = sanitizeConversationSummary(lastConversationSummary);
      let existing: IUserProfile | null = null;
      let normalizedEmail: string | undefined = email;
      if (email) {
        const rawEmail = String(email).trim();
        const simpleEmailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!simpleEmailRe.test(rawEmail)) {
          normalizedEmail = normalizeHumanizedEmail(rawEmail);
        }
      }
      if (id) {
        const res = await findById(id);
        if (res) {
          existing = res.userProfile;
        }
      }
      if (!existing && userId) {
        const res = await findByUserId(userId);
        if (res) {
          existing = res.userProfile;
        }
      }
      if (!existing && email) {
        const res = await findByEmail(email);
        if (res) {
          existing = res.userProfile;
        }
      }

      if (normalizedEmail) {
        await checkForDuplicateEmail(normalizedEmail, existing?._id);
      }

      const prism = await Prism.getInstance();
      if (existing) {
        const profileId = (existing as any)._id || (existing as any).page_id;
        if (!profileId) {
          log.error('Existing UserProfile missing id for update', { userId, email: normalizedEmail });
          return null;
        }

        const changedRecord: any = {};

        if (first_name && first_name !== existing.first_name) changedRecord.first_name = first_name;
        if (normalizedEmail && normalizedEmail !== existing.email) changedRecord.email = normalizedEmail;

        // Always re-link userId on update if provided (fixes stale email-only records).
        if (userId && userId !== existing.userId) {
          changedRecord.userId = userId;
        }

        const mergedPersona = shallowMergeStructured<IPublicPersona>(existing.publicPersona, publicPersona);
        if (mergedPersona !== undefined && !valuesEqual(mergedPersona, existing.publicPersona)) {
          changedRecord.publicPersona = mergedPersona;
        }

        const mergedMemory = shallowMergeStructured<IPrivateMemory>(existing.privateMemory, privateMemory);
        if (mergedMemory !== undefined && !valuesEqual(mergedMemory, existing.privateMemory)) {
          changedRecord.privateMemory = mergedMemory;
        }

        if (personalityVoiceConfig !== undefined && !valuesEqual(personalityVoiceConfig, existing.personalityVoiceConfig)) {
          changedRecord.personalityVoiceConfig = personalityVoiceConfig;
        }
        if (sanitizedLastConversationSummary !== undefined && !valuesEqual(sanitizedLastConversationSummary, existing.lastConversationSummary)) {
          changedRecord.lastConversationSummary = sanitizedLastConversationSummary;
        }
        const mergedOnboardingState = mergeUserProfileOnboardingState(existing.onboardingState, onboardingState);
        if (mergedOnboardingState !== undefined && !valuesEqual(mergedOnboardingState, existing.onboardingState)) {
          changedRecord.onboardingState = mergedOnboardingState;
        }
        if (onboardingComplete !== undefined && onboardingComplete !== existing.onboardingComplete) changedRecord.onboardingComplete = onboardingComplete;
        if (overlayDismissed !== undefined && overlayDismissed !== existing.overlayDismissed) changedRecord.overlayDismissed = overlayDismissed;

        if (removeUserId) {
          changedRecord.userId = undefined;
        }

        const hasChanges = Object.values(changedRecord).some((value) => value !== undefined);
        if (!hasChanges) {
          log.debug('No UserProfile changes to persist', { profileId, userId: existing.userId });
          return migrateUserProfileRecord(existing);
        }

        const updateContent = {
          ...profileUpdateContent(existing),
          ...changedRecord,
        };
        if (removeUserId) {
          delete updateContent.userId;
        }

        log.debug('Updating UserProfile record', {
          profileId,
          userId: updateContent.userId ?? existing.userId,
          changedKeys: Object.keys(changedRecord),
        });
        const updateOp = async () => await prism.update(UserProfileDefinition.dataModel.block, profileId, updateContent);
        const updated = await ensureUserProfileDefinition(updateOp);

        if (!updated || updated.total === 0 || updated.items.length === 0) {
          log.error('Failed to update UserProfile', { profileId, changedKeys: Object.keys(changedRecord) });
          return null;
        }
        return migrateUserProfileRecord(updated.items[0]);
      } else {
        // Create path
        const record: any = {
          first_name,
          email: normalizedEmail,
          userId,
        };

        if (publicPersona !== undefined) record.publicPersona = publicPersona;
        if (privateMemory !== undefined) record.privateMemory = privateMemory;
        if (personalityVoiceConfig !== undefined) record.personalityVoiceConfig = personalityVoiceConfig;
        if (sanitizedLastConversationSummary !== undefined) record.lastConversationSummary = sanitizedLastConversationSummary;
        if (onboardingState !== undefined) record.onboardingState = onboardingState;
        if (onboardingComplete !== undefined) record.onboardingComplete = onboardingComplete;
        if (overlayDismissed !== undefined) record.overlayDismissed = overlayDismissed;

        log.debug('Saving UserProfile record', {
          userId,
          hasEmail: Boolean(normalizedEmail),
          recordKeys: Object.keys(record),
        });
        const createOp = async () => await prism.create(UserProfileDefinition.dataModel.block, record);
        const created = await ensureUserProfileDefinition(createOp);
        if (!created || created.total === 0 || created.items.length === 0) {
            log.error('Failed to save UserProfile', { email: normalizedEmail, userId });
            return null;
        }
        return migrateUserProfileRecord(created.items[0]);
      }
    } catch (error) {
        const err = error as Error;
        log.error('Failed to create or update UserProfile', { error: err, userId, email, id });
        if (err.message === 'DUPLICATE_EMAIL') {
            throw err;
        }
        return null;
    }
}

interface User {
  id: string;
  name?: string | null;
  email?: string | null;
}

const MAX_SESSION_HISTORY = 100;

/**
 * Add a session history entry to the user profile
 * Automatically limits to 100 most recent entries
 */
export async function addSessionHistoryEntry(
  authOptions: NextAuthOptions,
  action: string,
  refIds?: Array<{ type: string; id: string }>
) {
  let sessionId: string | undefined;
  try {
    const session = await getSessionSafely(undefined, authOptions);

    sessionId =
      session?.user && 'sessionId' in session.user && typeof session.user.sessionId === 'string'
        ? session.user.sessionId
        : session?.user?.id;
    if (session?.user) {
      setLogContext({
        sessionId: sessionId ?? undefined,
        userId: session.user.id ?? undefined,
        userName:
          'name' in session.user && typeof session.user.name === 'string'
            ? session.user.name
            : 'email' in session.user && typeof session.user.email === 'string'
              ? session.user.email
              : undefined,
        tag: 'prism:actions:user-profile',
      });
    }

    log.debug('addSessionHistoryEntry called', { action, refIds, sessionId });

    if (!session?.user?.id) {
      log.error('Unauthorized: No valid session found for adding session history entry', { action });
      return null;
    }

    if (!action || typeof action !== 'string') {
      log.error('Invalid action provided for session history entry', { action });
      return null;
    }

    sessionId = 'sessionId' in session.user && typeof session.user.sessionId === 'string'
      ? session.user.sessionId
      : session.user.id;

    const userId = session.user.id;

    const result = await findByUserId(userId);
    if (!result || !result.userProfile) {
      log.warn('[SessionHistory] User profile not found', { userId });
      return null;
    }

    const { userProfile } = result;
    const profileId = userProfile._id;

    if (!profileId) {
      log.warn('[SessionHistory] No profile ID for user', { userId });
      return null;
    }

    const newEntry = {
      time: new Date().toISOString(),
      action,
      sessionId,
      ...(refIds && refIds.length > 0 ? { refIds } : {})
    };

    const existingHistory = userProfile.sessionHistory || [];
    const updatedHistory = [newEntry, ...existingHistory];

    if (updatedHistory.length > MAX_SESSION_HISTORY) {
      updatedHistory.splice(MAX_SESSION_HISTORY);
    }

    const prism = await Prism.getInstance();
    await prism.update(BlockType_UserProfile, profileId, {
      ...userProfile,
      sessionHistory: updatedHistory
    });
    log.debug('[SessionHistory] Added entry for user', { userId, sessionId, newEntry });

    return newEntry;
  } catch (error) {
    log.error('[SessionHistory] Failed to add entry', { action, error, sessionId });
    return null;
  }
}

/**
 * Get the last N session history entries for a user
 */
export async function getRecentSessionHistory(userId: string, count: number = 5) {
  try {
    const result = await findByUserId(userId);
    if (!result || !result.userProfile) {
      return [];
    }

    const history = result.userProfile.sessionHistory || [];
    return history.slice(0, count);
  } catch (error) {
    log.error('[SessionHistory] Failed to get recent history', { userId, error });
    return [];
  }
}
