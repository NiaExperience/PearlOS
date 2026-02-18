/* eslint-disable @typescript-eslint/no-explicit-any */
import { Prism, PrismContentQuery, PrismContentResult } from '@nia/prism';
import { BlockType_UserProfile, IUserProfile } from '@nia/prism/core/blocks/userProfile.block';
import { NextAuthOptions } from 'next-auth';

import { getSessionSafely } from '../auth/getSessionSafely';
import { getLogger, setLogContext } from '../logger';
import { UserProfileDefinition } from '../platform-definitions';

const log = getLogger('prism:actions:user-profile');

/**
 * Metadata operations for flexible CRUD on UserProfile metadata field
 */
export enum MetadataOperation {
  /** Merge incoming keys with existing (default - preserves existing keys) */
  MERGE = 'merge',
  /** Replace entire metadata object (overwrites all keys) */
  REPLACE = 'replace',
  /** Delete specific keys from metadata */
  DELETE_KEYS = 'delete_keys',
  /** Clear all metadata */
  CLEAR = 'clear'
}

export async function createUserProfileDefinition() {
  const prism = await Prism.getInstance();
  const created = await prism.createDefinition(UserProfileDefinition);
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create UserProfile definition');
  }
  return created.items[0];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Replace bracketed tokens, allowing inner spaces: ( at ), [ at ], { at } and ( dot ) / ( period )
  s = s.replace(/\(\s*at\s*\)|\[\s*at\s*\]|\{\s*at\s*\}/gi, '@');
  s = s.replace(/\(\s*(dot|period)\s*\)|\[\s*(dot|period)\s*\]|\{\s*(dot|period)\s*\}/gi, '.');

  // Replace standalone words with separators
  s = s.replace(/\bat\b/gi, '@');
  s = s.replace(/\b(dot|period)\b/gi, '.');

  // Remove spaces around and between separators
  s = s.replace(/\s*@\s*/g, '@');
  s = s.replace(/\s*\.\s*/g, '.');

  // Strip leftover bracket characters
  // eslint-disable-next-line no-useless-escape
  s = s.replace(/[\[\]\(\)\{\}]/g, '');

  // Remove any remaining whitespace
  s = s.replace(/\s+/g, '');

  // Collapse duplicate separators
  s = s.replace(/@+/g, '@').replace(/\.{2,}/g, '.');
  return s;
}

/**
 * Normalizes metadata by de-stringifying JSON strings into proper objects.
 * Handles legacy records where metadata was stored as stringified JSON.
 * @param metadata - The metadata to normalize (can be string, object, or undefined)
 * @returns Normalized metadata as an object or undefined
 */
export function normalizeMetadata(metadata: any): Record<string, any> | undefined {
  if (metadata === null || metadata === undefined) {
    return undefined;
  }
  
  // If it's already an object, return as-is
  if (typeof metadata === 'object' && !Array.isArray(metadata)) {
    return metadata;
  }
  
  // If it's a string that looks like JSON, try to parse it
  if (typeof metadata === 'string' && metadata.trim().startsWith('{') && metadata.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(metadata);
      if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        log.debug('De-stringified legacy metadata', { metadata, parsed });
        return parsed;
      }
    } catch (e) {
      log.warn('Failed to parse metadata as JSON, keeping as-is', { error: e });
    }
  }
  
  // For other types, convert to object format or return undefined
  if (typeof metadata === 'string') {
    // Non-JSON strings get wrapped in a generic field
    return { value: metadata };
  }
  
  return undefined;
}

/**
 * Backfill UserProfile records for a given tenant/email with the resolved userId
 */
export async function backfillUserIdByEmail(email: string, userId: string) {
  const prism = await Prism.getInstance();
  // Find matching UserProfiles by email + tenant
  const op = async () => await prism.query({
    contentType: BlockType_UserProfile,
    tenantId: 'any',
    where: { type: { eq: BlockType_UserProfile }, indexer: { path: 'email', equals: email } },
    limit: 100,
  } as PrismContentQuery);
  const found: PrismContentResult = await ensureUserProfileDefinition(op);
  if (!found?.total) return { updated: 0 };
  let updated = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  // Find matching UserProfiles by email + tenant
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

  // Normalize metadata if it exists
  if (userProfile.metadata) {
    userProfile.metadata = normalizeMetadata(userProfile.metadata);
  }

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
  // Find matching UserProfiles by email + tenant
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

  // Normalize metadata if it exists
  if (userProfile.metadata) {
    userProfile.metadata = normalizeMetadata(userProfile.metadata);
  }

  return { userProfile };
}

/**
 * Find UserProfile records by id
 */
export async function findById(id: string) {
  const prism = await Prism.getInstance();
  // Find matching UserProfiles by email + tenant
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

  // Normalize metadata if it exists
  if (userProfile.metadata) {
    userProfile.metadata = normalizeMetadata(userProfile.metadata);
  }

  return { userProfile };
}

/**
 * Checks for duplicate email addresses, excluding the current record if provided
 * @param normalizedEmail - The normalized email to check for duplicates
 * @param currentId - Optional ID of the current record to exclude from duplicate check
 * @throws Error with message 'DUPLICATE_EMAIL' if a duplicate is found
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
      // Check if any duplicate is a different record (not the one we're updating)
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
      throw e; // Re-throw duplicate email errors
    }
    log.error('Error searching for existing UserProfile', { normalizedEmail, currentId, error: e });
    throw e; // Re-throw all other errors as well
  }
}

interface CreateOrUpdateUserProfileParams {
  first_name?: string;
  id?: string;
  userId?: string;
  email?: string;
  metadata?: Record<string, string>;
  metadataOperation?: MetadataOperation;
  metadataKeysToDelete?: string[];
  personalityVoiceConfig?: Record<string, any>;
  lastConversationSummary?: Record<string, any>;
  onboardingComplete?: boolean;
  overlayDismissed?: boolean;
}

export async function createOrUpdateUserProfile({ 
  first_name, 
  email, 
  metadata, 
  id, 
  userId,
  metadataOperation = MetadataOperation.MERGE,
  metadataKeysToDelete,
  personalityVoiceConfig,
  lastConversationSummary,
  onboardingComplete,
  overlayDismissed
}: CreateOrUpdateUserProfileParams, removeUserId: boolean  ) {
    log.debug('createOrUpdateUserProfile called', { userId, id, email });
    try {
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
        // If id is already present, just proceed with the update
        const res = await findById(id);
        if (res) {
          existing = res.userProfile;
        }
      }
      if (!existing && userId) {
        // Find existing UserProfile by userId to get the id
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

      // Duplicate email check (for both create and update scenarios)
      if (normalizedEmail) {
        // Pass existing._id if we found a record, so we don't flag it as a duplicate of itself
        await checkForDuplicateEmail(normalizedEmail, existing?._id);
      }

      const prism = await Prism.getInstance();
      if (existing) {
        // Update path
        // Normalize existing metadata first to handle legacy stringified data
        if (existing.metadata) {
          existing.metadata = normalizeMetadata(existing.metadata);
        }
        
        // Handle metadata based on operation type
        let mergedMetadata: Record<string, any> | undefined = existing.metadata;
        
        if (metadataOperation === MetadataOperation.CLEAR) {
          // Clear all metadata
          mergedMetadata = undefined;
        } else if (metadataOperation === MetadataOperation.REPLACE && metadata !== undefined) {
          // Replace entire metadata object
          if (process.env.DEBUG_PRISM === 'true') {
            log.debug('[UserProfileActions] REPLACE operation - input metadata', { metadata });
          }
          mergedMetadata = normalizeMetadata(metadata);
          if (process.env.DEBUG_PRISM === 'true') {
            log.debug('[UserProfileActions] REPLACE operation - normalized metadata', { mergedMetadata });
          }
        } else if (metadataOperation === MetadataOperation.DELETE_KEYS && metadataKeysToDelete) {
          // Delete specific keys
          mergedMetadata = { ...(existing.metadata || {}) };
          metadataKeysToDelete.forEach(key => delete mergedMetadata![key]);
        } else if (metadataOperation === MetadataOperation.MERGE && metadata !== undefined) {
          // Original merge behavior - incoming keys overwrite existing
          const normalizedIncoming = normalizeMetadata(metadata);
          mergedMetadata = { ...(existing.metadata || {}), ...(normalizedIncoming || {}) };
        } else if (metadata === null) {
          // Legacy support: null clears metadata
          mergedMetadata = undefined;
        }

        // Normalize
        const updatedRecord: any = { ...existing };
        if (first_name) updatedRecord.first_name = first_name;
        if (normalizedEmail) updatedRecord.email = normalizedEmail;
        
        // CRITICAL FIX: Always ensure userId is set if provided, even on updates
        // This fixes the "avatar reset" loop where a profile exists (by email) but has no userId link
        if (userId) {
             updatedRecord.userId = userId;
        }
        
        if (mergedMetadata !== undefined) updatedRecord.metadata = mergedMetadata;
        if (personalityVoiceConfig !== undefined) updatedRecord.personalityVoiceConfig = personalityVoiceConfig;
        if (lastConversationSummary !== undefined) updatedRecord.lastConversationSummary = lastConversationSummary;
        if (onboardingComplete !== undefined) updatedRecord.onboardingComplete = onboardingComplete;
        if (overlayDismissed !== undefined) updatedRecord.overlayDismissed = overlayDismissed;

        // Handle explicit removal of userId
        if (removeUserId) {
          delete updatedRecord.userId;
        }

        log.debug('[UserProfileActions] About to update record with metadata', { metadata: updatedRecord.metadata, userId: updatedRecord.userId, profileId: updatedRecord._id });
        log.debug('Updating UserProfile record', { updatedRecord });
        // Ensure the content definition exists when creating a new record
        const updateOp = async () => await prism.update(UserProfileDefinition.dataModel.block, updatedRecord._id, updatedRecord);
        const updated = await ensureUserProfileDefinition(updateOp);
        
        log.debug('[UserProfileActions] After update metadata', { metadata: updated?.items?.[0]?.metadata, profileId: updatedRecord._id });
        
        if (!updated || updated.total === 0 || updated.items.length === 0) {
          log.error('Failed to update UserProfile', { profileId: updatedRecord._id });
          return null;
        }
        return updated.items[0];
      } else {
        // Create path
        // Normalize incoming metadata
        const normalizedMetadata = metadata ? normalizeMetadata(metadata) : undefined;
        
        const record: any = {
            first_name,
            email: normalizedEmail,
            metadata: normalizedMetadata,
            userId
        } as const;
        
        if (personalityVoiceConfig !== undefined) {
          record.personalityVoiceConfig = personalityVoiceConfig;
        }
        if (lastConversationSummary !== undefined) {
          record.lastConversationSummary = lastConversationSummary;
        }
        if (onboardingComplete !== undefined) {
          record.onboardingComplete = onboardingComplete;
        }
        if (overlayDismissed !== undefined) {
          record.overlayDismissed = overlayDismissed;
        }

        log.debug('Saving UserProfile record', { record });
        // Ensure the content definition exists when creating a new record
        const createOp = async () => await prism.create(UserProfileDefinition.dataModel.block, record);
        const created = await ensureUserProfileDefinition(createOp);
        if (!created || created.total === 0 || created.items.length === 0) {
            log.error('Failed to save UserProfile', { email: normalizedEmail, userId });
            return null;
        }
        return created.items[0];
      }
    } catch (error) {
        const err = error as Error;
        log.error('Failed to create or update UserProfile', { error: err, userId, email, id });
        // Re-throw specific errors so route handlers can handle them properly
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
 * @param userId - User ID
 * @param action - Description of the action
 * @param sessionId - Session ID
 * @param refIds - Optional array of resource references
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

    // Get sessionId from user session, fallback to userId
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

    // Create new entry
    const newEntry = {
      time: new Date().toISOString(),
      action,
      sessionId,
      ...(refIds && refIds.length > 0 ? { refIds } : {})
    };

    // Get existing history or create new array
    const existingHistory = userProfile.sessionHistory || [];
    
    // Add new entry at the beginning (most recent first)
    const updatedHistory = [newEntry, ...existingHistory];
    
    // Limit to MAX_SESSION_HISTORY most recent entries
    if (updatedHistory.length > MAX_SESSION_HISTORY) {
      updatedHistory.splice(MAX_SESSION_HISTORY);
    }

    // Update the profile
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
 * @param userId - User ID
 * @param count - Number of entries to return (default: 5)
 * @returns Array of session history entries (most recent first)
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
