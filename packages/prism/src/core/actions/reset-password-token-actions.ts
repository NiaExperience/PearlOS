'use server';

import { Prism } from '../../prism';
import { PrismContentQuery } from '../types';
import { isValidUUID } from '../utils';
import { BlockType_ResetPasswordToken, IResetPasswordToken } from './reset-password-token-constants';

/**
 * Create a new reset password (or invite activation) token record.
 * Expects tokenHash (already hashed) and metadata. No plaintext token ever stored.
 */
export async function createResetPasswordToken(data: IResetPasswordToken): Promise<IResetPasswordToken> {
  if (!data.tokenHash) throw new Error('tokenHash required');
  if (!data.userId) throw new Error('userId required');
  if (!data.expiresAt) throw new Error('expiresAt required');
  if (!data.purpose) throw new Error('purpose required');

  const prism = await Prism.getInstance();
  const record: any = {
    ...data,
    attempts: data.attempts ?? 0,
    issuedAt: data.issuedAt || new Date().toISOString(),
  };
  if (data.consumedAt) {
    record.consumedAt = data.consumedAt;
  }
  const created = await prism.create(BlockType_ResetPasswordToken, record, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create reset password token');
  }
  return created.items[0] as unknown as IResetPasswordToken;
}

/**
 * Fetch a token by its page id (uuid) – generally only for admin/debug visibility.
 */
export async function getResetPasswordTokenById(id: string): Promise<IResetPasswordToken | null> {
  if (!id || !isValidUUID(id)) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_ResetPasswordToken,
    tenantId: 'any',
    where: { page_id: id },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IResetPasswordToken;
}

/**
 * Lookup by token hash (exact) for consumption validation.
 */
export async function getResetPasswordTokenByHash(tokenHash: string): Promise<IResetPasswordToken | null> {
  if (!tokenHash) return null;
  const prism = await Prism.getInstance();
  const query: PrismContentQuery = {
    contentType: BlockType_ResetPasswordToken,
    tenantId: 'any',
    where: { indexer: { path: 'tokenHash', equals: tokenHash } },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IResetPasswordToken;
}

/**
 * List active (unconsumed + not expired) tokens for a user, ordered by soonest expiry.
 */
export async function getActiveResetPasswordTokensForUser(userId: string, now: Date = new Date()): Promise<IResetPasswordToken[]> {
  if (!userId) return [];
  const prism = await Prism.getInstance();
  // We can't express all predicates server-side if indexer only supports direct equals; perform post-filter.
  const query: PrismContentQuery = {
    contentType: BlockType_ResetPasswordToken,
    tenantId: 'any',
    where: { parent_id: userId },
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const items = (result.items as IResetPasswordToken[]) || [];
  return items
    .filter(t => !t.consumedAt && new Date(t.expiresAt).getTime() > now.getTime())
    .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime());
}

/**
 * Mark token as consumed. Returns updated record or null if not found / already consumed.
 */
export async function consumeResetPasswordToken(tokenId: string): Promise<IResetPasswordToken | null> {
  if (!tokenId || !isValidUUID(tokenId)) return null;
  const existing = await getResetPasswordTokenById(tokenId);
  if (!existing) return null;
  if (existing.consumedAt) return null;
  const prism = await Prism.getInstance();
  const updated = await prism.update(BlockType_ResetPasswordToken, tokenId, { consumedAt: new Date().toISOString() }, 'any');
  if (!updated || updated.total === 0 || updated.items.length === 0) return null;
  return updated.items[0] as IResetPasswordToken;
}

/**
 * Increment attempt counter on a token (e.g., reuse attempt) – no-op if not found.
 */
export async function incrementResetPasswordTokenAttempts(tokenId: string): Promise<IResetPasswordToken | null> {
  if (!tokenId || !isValidUUID(tokenId)) return null;
  const current = await getResetPasswordTokenById(tokenId);
  if (!current) return null;
  const prism = await Prism.getInstance();
  const attempts = (current.attempts || 0) + 1;
  const updated = await prism.update(BlockType_ResetPasswordToken, tokenId, { attempts }, 'any');
  if (!updated || updated.total === 0 || updated.items.length === 0) return null;
  return updated.items[0] as IResetPasswordToken;
}

/**
 * Delete token (admin or cleanup operation).
 */
export async function deleteResetPasswordToken(tokenId: string): Promise<boolean> {
  if (!tokenId || !isValidUUID(tokenId)) return false;
  const prism = await Prism.getInstance();
  const deleted = await prism.delete(BlockType_ResetPasswordToken, tokenId, 'any');
  return !!deleted;
}

/**
 * Prune expired tokens. Optional: keep consumed tokens X hours after consumption.
 */
export async function pruneExpiredResetPasswordTokens(now: Date = new Date()): Promise<number> {
  const prism = await Prism.getInstance();
  // Fetch all tokens (could optimize with server-side filtering when supported)
  const query: PrismContentQuery = {
    contentType: BlockType_ResetPasswordToken,
    tenantId: 'any',
    where: {},
    orderBy: { createdAt: 'desc' as const },
  } as any;
  const result = await prism.query(query);
  const items = (result.items as IResetPasswordToken[]) || [];
  const toDelete = items.filter(t => new Date(t.expiresAt).getTime() <= now.getTime());
  let deletedCount = 0;
  for (const token of toDelete) {
    const deleted = await prism.delete(BlockType_ResetPasswordToken, token._id as string, 'any');
    if (deleted) deletedCount++;
  }
  return deletedCount;
}
