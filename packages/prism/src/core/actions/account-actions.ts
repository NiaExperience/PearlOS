import { Prism } from '../../prism';
import { BlockType_Account, IAccount, AccountSchema } from '../blocks/account.block';
import { ContentData } from '../content/types';
import { getLogger } from '../logger';
import { isValidUUID } from '../utils';

const log = getLogger('prism:actions:account');


export async function getAccounts(userId?: string): Promise<IAccount[]> {
  const prism = await Prism.getInstance();
  const query: any = {
    contentType: BlockType_Account,
    tenantId: 'any',
    where: {},
    orderBy: { createdAt: 'desc' as const },
  };
  if (userId) {
    query.where = { parent_id: userId };
  }
  const result = await prism.query(query);
  return result.items as IAccount[];
}

export async function getAccountById(accountId: string): Promise<IAccount | null> {
  const prism = await Prism.getInstance();
  if (!accountId || !isValidUUID(accountId)) return null;
  const query = {
    contentType: BlockType_Account,
    tenantId: 'any',
    where: { page_id: accountId },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  return result.items[0] as IAccount;
}

/**
 * Retrieves a user account by provider only (without requiring provider account ID).
 * Useful for cases where you just need to find the user's account for a specific OAuth provider.
 *
 * @param userId - The unique identifier of the user.
 * @param provider - The OAuth provider (e.g., 'google', 'github').
 * @returns A promise that resolves to the account or null if not found.
 */
export async function getUserAccountByProvider(
  userId: string,
  provider: string
): Promise<ContentData | null> {
  if (!userId || !provider) {
    throw new Error('User ID and provider are required');
  }

  const prism = await Prism.getInstance();
  const query = {
    contentType: BlockType_Account,
    tenantId: 'any',
    where: { parent_id: userId, 
      indexer: { path: "provider", equals: provider }
    },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result || result.total === 0 || !result.items || result.items.length === 0) {
    return null;
  }
  if (result.total > 1) {
    log.warn('Multiple accounts found for user and provider; returning first', { userId, provider, total: result.total });
  }
  return result.items[0] as IAccount;
}

export async function getAccountByProviderAccountId(provider: string, providerAccountId: string): Promise<IAccount | null> {
  const prism = await Prism.getInstance();
  if (!provider || !providerAccountId) return null;
  
  // Query specifically for the account with the given provider and providerAccountId using indexer
  const query = {
    contentType: BlockType_Account,
    tenantId: 'any',
    where: {
      indexer: { 
        path: "provider", 
        equals: provider 
      }
    },
    orderBy: { createdAt: 'desc' as const },
  };
  const result = await prism.query(query);
  if (!result.items || result.items.length === 0) return null;
  
  // Filter by providerAccountId since the indexer query only filters by provider
  const account = result.items.find((item: IAccount) => item.providerAccountId === providerAccountId);
  return account || null;
}

export async function createAccount(accountData: IAccount): Promise<IAccount> {
  const prism = await Prism.getInstance(); 
  if (!accountData.userId || !accountData.provider || !accountData.providerAccountId || !accountData.type) {
    throw new Error('userId, provider, providerAccountId, and type are required');
  }
  const created = await prism.create(BlockType_Account, accountData, 'any');
  if (!created || created.total === 0 || created.items.length === 0) {
    throw new Error('Failed to create account');
  }
  return created.items[0] as unknown as IAccount;
}

export async function updateAccount(accountId: string, updateData: Partial<IAccount>): Promise<IAccount> {
  const prism = await Prism.getInstance();
  if (!accountId) {
    throw new Error('Account ID is required');
  }
  if (!isValidUUID(accountId)) {
    throw new Error('Account ID is invalid');
  }
  
  // Use atomic JSONB merge - let the database handle merging
  // Only send the fields being updated, preserving all others
  const cleanedUpdate = { ...updateData };
  
  // Auto-migration: Remove any fields not part of the reduced Account schema
  for (const key of Object.keys(cleanedUpdate)) {
    if (!AccountSchema.shape.hasOwnProperty(key)) {
      delete cleanedUpdate[key as keyof IAccount];
    }
  }

  const updated = await prism.update(BlockType_Account, accountId, cleanedUpdate, 'any');
  if (!updated || updated.total === 0 || updated.items.length === 0) {
    throw new Error('Account not found');
  }
  return updated.items[0] as unknown as IAccount;
}

export async function deleteAccount(accountId: string): Promise<{ success: boolean; message: string }> {
  const prism = await Prism.getInstance();
  if (!accountId) {
    throw new Error('Account ID is required');
  }
  if (!isValidUUID(accountId)) {
    throw new Error('Account ID is invalid');
  }
  const deleted = await prism.delete(BlockType_Account, accountId, 'any');
  if (!deleted) {
    throw new Error('Account not found');
  }
  return { success: true, message: 'Account deleted successfully' };
}
