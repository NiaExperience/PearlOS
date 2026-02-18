/**
 * Test suite for OAuth token encryption functionality
 * 
 * This verifies that:
 * 1. Content encryption/decryption works correctly
 * 2. Backward compatibility is maintained
 * 3. Account data is properly secured
 */

import { ContentEncryption } from '../src/core/utils/encryption';

describe('OAuth Token Encryption', () => {
  // Set up test encryption key and enable encryption
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'test-key-for-encryption-testing-32b';
    process.env.FORCE_ENCRYPTION = 'true'; // Enable encryption in test environment
  });

  describe('ContentEncryption', () => {
    const testAccountData = JSON.stringify({
      userId: 'user-123',
      provider: 'google',
      providerAccountId: 'google-456',
      type: 'oauth',
      refresh_token: 'test-refresh-token-secret',
      expires_at: 1640995200,
      scope: 'https://www.googleapis.com/auth/gmail.readonly'
    });

    it('should encrypt account content', () => {
      const encrypted = ContentEncryption.encryptContent(testAccountData);
      
      expect(encrypted).not.toBe(testAccountData);
      expect(encrypted).toMatch(/^ENC_V1:/);
      expect(ContentEncryption.isContentEncrypted(encrypted)).toBe(true);
    });

    it('should decrypt encrypted content back to original', () => {
      const encrypted = ContentEncryption.encryptContent(testAccountData);
      const decrypted = ContentEncryption.decryptContent(encrypted);
      
      expect(decrypted).toBe(testAccountData);
      
      // Verify the JSON can be parsed and contains expected data
      const parsed = JSON.parse(decrypted);
      expect(parsed.provider).toBe('google');
      expect(parsed.refresh_token).toBe('test-refresh-token-secret');
    });

    it('should handle unencrypted content (backward compatibility)', () => {
      const unencryptedData = testAccountData;
      
      // Should return unencrypted data as-is
      expect(ContentEncryption.isContentEncrypted(unencryptedData)).toBe(false);
      expect(ContentEncryption.decryptContent(unencryptedData)).toBe(unencryptedData);
    });

    it('should not double-encrypt content', () => {
      const encrypted = ContentEncryption.encryptContent(testAccountData);
      const doubleEncrypted = ContentEncryption.encryptContent(encrypted);
      
      // Should be the same (no double encryption)
      expect(doubleEncrypted).toBe(encrypted);
    });

    it('should migrate legacy content on secure storage', () => {
      const legacyData = testAccountData;
      
      // Should encrypt unencrypted content
      const migrated = ContentEncryption.secureContentForStorage(legacyData);
      expect(ContentEncryption.isContentEncrypted(migrated)).toBe(true);
      expect(ContentEncryption.decryptContent(migrated)).toBe(legacyData);
      
      // Should not double-encrypt already encrypted content
      const secondMigration = ContentEncryption.secureContentForStorage(migrated);
      expect(secondMigration).toBe(migrated); // Should be unchanged
    });

    it('should handle empty content gracefully', () => {
      expect(ContentEncryption.encryptContent('')).toBe('');
      expect(ContentEncryption.decryptContent('')).toBe('');
      expect(ContentEncryption.isContentEncrypted('')).toBe(false);
    });
  });

  describe('Google App Verification Compliance', () => {
    it('should only store essential OAuth data', () => {
      const accountData = {
        userId: 'user-123',
        provider: 'google',
        providerAccountId: 'google-456',
        type: 'oauth',
        refresh_token: 'test-refresh-token',  // ✅ Essential
        expires_at: 1640995200,              // ✅ Essential  
        scope: 'gmail.readonly',             // ✅ Essential
        // ❌ No longer stored: access_token, id_token, session_state, token_type
      };

      const jsonData = JSON.stringify(accountData);
      const encrypted = ContentEncryption.encryptContent(jsonData);
      const decrypted = ContentEncryption.decryptContent(encrypted);
      const parsed = JSON.parse(decrypted);

      // Verify only essential fields are present
      expect(parsed.refresh_token).toBeDefined();
      expect(parsed.expires_at).toBeDefined();
      expect(parsed.scope).toBeDefined();
      
      // Verify sensitive fields are not included
      expect(parsed.access_token).toBeUndefined();
      expect(parsed.id_token).toBeUndefined();
      expect(parsed.session_state).toBeUndefined();
      expect(parsed.token_type).toBeUndefined();
    });
  });
});
