import {
  createAccount,
  deleteAccount,
  getAccountById,
  getAccountByProviderAccountId,
  getAccounts,
  updateAccount
} from '../src/core/actions/account-actions';
import { IAccount } from '../src/core/blocks/account.block';
import { createTestUser } from '../src/testing/testlib';

describe('Account Actions (shared)', () => {

  describe('createAccount', () => {
    it('should create an account successfully', async () => {
      // Create a test user first
      const user = await createTestUser();
      expect(user._id).toBeTruthy();

      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth',
        refresh_token: 'refresh-token-123',
        expires_at: Date.now() + 3600000, // 1 hour from now
        scope: 'email profile',
      };

      const result = await createAccount(accountData);

      expect(result._id).toBeTruthy();
      expect(result.userId).toEqual(user._id);
      expect(result.provider).toEqual('google');
      expect(result.providerAccountId).toEqual('google-123456');
      expect(result.type).toEqual('oauth');
      expect(result.refresh_token).toEqual('refresh-token-123');
    });

    it('should throw error when userId is missing', async () => {
      const accountData = {
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      } as IAccount;

      await expect(createAccount(accountData)).rejects.toThrow('userId, provider, providerAccountId, and type are required');
    });

    it('should throw error when provider is missing', async () => {
      const user = await createTestUser();
      const accountData = {
        userId: user._id!,
        providerAccountId: 'google-123456',
        type: 'oauth'
      } as IAccount;

      await expect(createAccount(accountData)).rejects.toThrow('userId, provider, providerAccountId, and type are required');
    });

    it('should throw error when providerAccountId is missing', async () => {
      const user = await createTestUser();
      const accountData = {
        userId: user._id!,
        provider: 'google',
        type: 'oauth'
      } as IAccount;

      await expect(createAccount(accountData)).rejects.toThrow('userId, provider, providerAccountId, and type are required');
    });

    it('should throw error when type is missing', async () => {
      const user = await createTestUser();
      const accountData = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456'
      } as IAccount;

      await expect(createAccount(accountData)).rejects.toThrow('userId, provider, providerAccountId, and type are required');
    });
  });

  describe('getAccounts', () => {
    it('should return all accounts for a user', async () => {
      // Create a test user
      const user = await createTestUser();
      expect(user._id).toBeTruthy();

      // Create multiple accounts for the user
      const accountData1: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      };

      const accountData2: IAccount = {
        userId: user._id!,
        provider: 'github',
        providerAccountId: 'github-789012',
        type: 'oauth'
      };

      await createAccount(accountData1);
      await createAccount(accountData2);

      // Get all accounts for the user
      const accounts = await getAccounts(user._id);

      expect(accounts).toBeDefined();
      expect(accounts.length).toBeGreaterThanOrEqual(2);
      
      const googleAccount = accounts.find(acc => acc.provider === 'google');
      const githubAccount = accounts.find(acc => acc.provider === 'github');
      
      expect(googleAccount).toBeDefined();
      expect(githubAccount).toBeDefined();
      expect(googleAccount?.providerAccountId).toEqual('google-123456');
      expect(githubAccount?.providerAccountId).toEqual('github-789012');
    });

    it('should return all accounts when no userId is provided', async () => {
      // Create multiple users and accounts
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      const accountData1: IAccount = {
        userId: user1._id!,
        provider: 'google',
        providerAccountId: 'google-user1',
        type: 'oauth'
      };

      const accountData2: IAccount = {
        userId: user2._id!,
        provider: 'github',
        providerAccountId: 'github-user2',
        type: 'oauth'
      };

      await createAccount(accountData1);
      await createAccount(accountData2);

      // Get all accounts
      const accounts = await getAccounts();

      expect(accounts).toBeDefined();
      expect(accounts.length).toBeGreaterThanOrEqual(2);
      
      const googleAccount = accounts.find(acc => acc.provider === 'google');
      const githubAccount = accounts.find(acc => acc.provider === 'github');
      
      expect(googleAccount).toBeDefined();
      expect(githubAccount).toBeDefined();
    });

    it('should return empty array when no accounts exist for user', async () => {
      const user = await createTestUser();
      const accounts = await getAccounts(user._id);
      
      expect(accounts).toBeDefined();
      expect(Array.isArray(accounts)).toBe(true);
    });
  });

  describe('getAccountById', () => {
    it('should return account by ID', async () => {
      // Create a test user and account
      const user = await createTestUser();
      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      };

      const createdAccount = await createAccount(accountData);
      expect(createdAccount._id).toBeTruthy();

      // Get account by ID
      const result = await getAccountById(createdAccount._id!);

      expect(result).not.toBeNull();
      expect(result?.userId).toEqual(user._id);
      expect(result?.provider).toEqual('google');
      expect(result?.providerAccountId).toEqual('google-123456');
      expect(result?.type).toEqual('oauth');
    });

    it('should return null for non-existent account ID', async () => {
      const result = await getAccountById('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null when accountId is empty', async () => {
      const result = await getAccountById('');
      expect(result).toBeNull();
    });
  });

  describe('getAccountByProviderAccountId', () => {
    it('should return account by provider and providerAccountId', async () => {
      // Create a test user and account
      const user = await createTestUser();
      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      };

      await createAccount(accountData);

      // Get account by provider and providerAccountId
      const result = await getAccountByProviderAccountId('google', 'google-123456');

      expect(result).not.toBeNull();
      expect(result?.userId).toEqual(user._id);
      expect(result?.provider).toEqual('google');
      expect(result?.providerAccountId).toEqual('google-123456');
      expect(result?.type).toEqual('oauth');
    });

    it('should return null for non-existent provider and providerAccountId', async () => {
      const result = await getAccountByProviderAccountId('google', 'non-existent');
      expect(result).toBeNull();
    });

    it('should return null when provider is empty', async () => {
      const result = await getAccountByProviderAccountId('', 'google-123456');
      expect(result).toBeNull();
    });

    it('should return null when providerAccountId is empty', async () => {
      const result = await getAccountByProviderAccountId('google', '');
      expect(result).toBeNull();
    });
  });

  describe('updateAccount', () => {
    it('should update account successfully', async () => {
      // Create a test user and account
      const user = await createTestUser();
      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      };

      const createdAccount = await createAccount(accountData);
      expect(createdAccount._id).toBeTruthy();

      // Update the account
      const updateData = {
        access_token: 'old-access-token', // This should be removed in the update method
        refresh_token: 'new-refresh-token',
        expires_at: Date.now() + 7200000 // 2 hours from now
      };

      const result = await updateAccount(createdAccount._id!, updateData);

      expect(result._id).toEqual(createdAccount._id);
      expect(result.refresh_token).toEqual('new-refresh-token');
      expect(result.expires_at).toBeDefined();
      // Original fields should remain unchanged
      expect(result.userId).toEqual(user._id);
      expect(result.provider).toEqual('google');
      expect('access_token' in Object.keys(result)).toBe(false);
      expect(result.providerAccountId).toEqual('google-123456');
      expect(result.type).toEqual('oauth');
    });

    it('should throw error when accountId is missing', async () => {
      const updateData = {
        expires_at: Date.now() + 7200000 // 2 hours from now
      };

      await expect(updateAccount('', updateData)).rejects.toThrow('Account ID is required');
    });

    it('should throw error when account not found', async () => {
      const updateData = {
        expires_at: Date.now() + 7200000 // 2 hours from now
      };

      await expect(updateAccount('non-existent-id', updateData)).rejects.toThrow('Account ID is invalid');
    });
  });

  describe('deleteAccount', () => {
    it('should delete account successfully', async () => {
      // Create a test user and account
      const user = await createTestUser();
      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth'
      };

      const createdAccount = await createAccount(accountData);
      expect(createdAccount._id).toBeTruthy();

      // Delete the account
      const result = await deleteAccount(createdAccount._id!);

      expect(result.success).toBe(true);
      expect(result.message).toEqual('Account deleted successfully');

      // Verify account is deleted
      const deletedAccount = await getAccountById(createdAccount._id!);
      expect(deletedAccount).toBeNull();
    });

    it('should throw error when accountId is missing', async () => {
      await expect(deleteAccount('')).rejects.toThrow('Account ID is required');
    });

    it('should throw error when account not found', async () => {
      await expect(deleteAccount('non-existent-id')).rejects.toThrow('Account ID is invalid');
    });
  });

  describe('Account with different providers', () => {
    it('should handle multiple OAuth providers', async () => {
      const user = await createTestUser();

      // Create accounts for different providers
      const googleAccount: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth',
        scope: 'email profile'
      };

      const githubAccount: IAccount = {
        userId: user._id!,
        provider: 'github',
        providerAccountId: 'github-789012',
        type: 'oauth',
        scope: 'user:email'
      };

      const facebookAccount: IAccount = {
        userId: user._id!,
        provider: 'facebook',
        providerAccountId: 'facebook-345678',
        type: 'oauth',
        scope: 'email public_profile'
      };

      const createdGoogle = await createAccount(googleAccount);
      const createdGithub = await createAccount(githubAccount);
      const createdFacebook = await createAccount(facebookAccount);

      // Verify all accounts were created
      expect(createdGoogle._id).toBeTruthy();
      expect(createdGithub._id).toBeTruthy();
      expect(createdFacebook._id).toBeTruthy();

      // Get all accounts for the user
      const userAccounts = await getAccounts(user._id);
      expect(userAccounts.length).toBeGreaterThanOrEqual(3);

      // Verify each provider account
      const google = userAccounts.find(acc => acc.provider === 'google');
      const github = userAccounts.find(acc => acc.provider === 'github');
      const facebook = userAccounts.find(acc => acc.provider === 'facebook');

      expect(google).toBeDefined();
      expect(github).toBeDefined();
      expect(facebook).toBeDefined();

      expect(google?.providerAccountId).toEqual('google-123456');
      expect(github?.providerAccountId).toEqual('github-789012');
      expect(facebook?.providerAccountId).toEqual('facebook-345678');
    });
  });

  describe('Account with credentials', () => {
    it('should handle accounts with full OAuth credentials', async () => {
      const user = await createTestUser();
      const expiresAt = Date.now() + 3600000; // 1 hour from now

      const accountData: IAccount = {
        userId: user._id!,
        provider: 'google',
        providerAccountId: 'google-123456',
        type: 'oauth',
        refresh_token: 'refresh-token-123',
        expires_at: expiresAt,
        scope: 'email profile openid',
      };

      const result = await createAccount(accountData);

      expect(result._id).toBeTruthy();
      expect(result.refresh_token).toEqual('refresh-token-123');
      expect(result.expires_at).toEqual(expiresAt);
      expect(result.scope).toEqual('email profile openid');
    });
  });
}); 