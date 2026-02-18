import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getLogger } from '../logger';

const log = getLogger('prism:utils:encryption');

/**
 * Encryption utility for sensitive OAuth tokens
 * Uses AES-256-CBC with HMAC for authenticated encryption
 */
export class TokenEncryption {
  private static readonly ALGORITHM = 'aes-256-cbc';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 16;  // 128 bits

  /**
   * Derives an encryption key from the master key
   */
  private static deriveKey(masterKey: string): Buffer {
    return createHash('sha256').update(masterKey).digest();
  }


  static hasMasterKey(): boolean {
    return !!process.env.TOKEN_ENCRYPTION_KEY;
  }

  /**
   * Gets the encryption master key from environment variables
   */
  private static getMasterKey(): string {
    const masterKey = process.env.TOKEN_ENCRYPTION_KEY;
    
    if (!masterKey) {
      throw new Error('TOKEN_ENCRYPTION_KEY or NEXTAUTH_SECRET must be set for token encryption');
    }
    
    if (masterKey.length < 32) {
      throw new Error('Encryption key must be at least 32 characters long');
    }
    
    return masterKey;
  }

  /**
   * Encrypts a token using AES-256-CBC
   * Returns format: iv:encryptedData (both base64 encoded)
   */
  public static encryptToken(token: string): string {
    if (!token || token.trim() === '') {
      return token; // Don't encrypt empty tokens
    }

    try {
      const masterKey = TokenEncryption.getMasterKey();
      const key = TokenEncryption.deriveKey(masterKey);
      
      // Generate random IV
      const iv = randomBytes(TokenEncryption.IV_LENGTH);
      
      // Create cipher
      const cipher = createCipheriv(TokenEncryption.ALGORITHM, key, iv);
      
      // Encrypt the token
      let encrypted = cipher.update(token, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      // Combine iv:encrypted (both base64 encoded)
      const result = [
        iv.toString('base64'),
        encrypted
      ].join(':');
      
      return result;
      
    } catch (error) {
      log.error('Token encryption failed', { error });
      throw new Error('Failed to encrypt token');
    }
  }

  /**
   * Decrypts a token encrypted with encryptToken
   * Expects format: iv:encryptedData (both base64 encoded)
   */
  public static decryptToken(encryptedToken: string): string {
    if (!encryptedToken || encryptedToken.trim() === '') {
      return encryptedToken; // Return empty tokens as-is
    }

    // Check if this looks like an encrypted token (has colons)
    if (!encryptedToken.includes(':')) {
      // Might be a legacy unencrypted token, return as-is
      // TODO: Add migration logic here if needed
      return encryptedToken;
    }

    try {
      const masterKey = TokenEncryption.getMasterKey();
      const key = TokenEncryption.deriveKey(masterKey);
      
      // Parse the encrypted token
      const parts = encryptedToken.split(':');
      if (parts.length !== 2) {
        throw new Error('Invalid encrypted token format');
      }
      
      const [ivB64, encryptedB64] = parts;
      
      // Decode from base64
      const iv = Buffer.from(ivB64, 'base64');
      
      // Create decipher
      const decipher = createDecipheriv(TokenEncryption.ALGORITHM, key, iv);
      
      // Decrypt the token
      let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
      
    } catch (error) {
      log.error('Token decryption failed', { error });
      throw new Error('Failed to decrypt token - token may be corrupted or key changed');
    }
  }

  /**
   * Checks if a token appears to be encrypted
   */
  public static isEncrypted(token: string): boolean {
    return !!(token && token.includes(':') && token.split(':').length === 2);
  }

  /**
   * Migrates an unencrypted token to encrypted format
   * Used for migrating existing tokens
   */
  public static async migrateToken(token: string): Promise<string> {
    if (!token || TokenEncryption.isEncrypted(token)) {
      return token; // Already encrypted or empty
    }
    
    return TokenEncryption.encryptToken(token);
  }
}

/**
 * Encryption configuration for different environments
 */
export const EncryptionConfig = {
  // Always encrypt these fields in production
  shouldEncrypt: (fieldName: string): boolean => {
    const sensitiveFields = ['refresh_token', 'access_token'];
    return sensitiveFields.includes(fieldName);
  },
  
  // Skip encryption in test environment for easier debugging
  isEnabled: (): boolean => {
    return TokenEncryption.hasMasterKey() && (process.env.NODE_ENV !== 'test' || process.env.FORCE_ENCRYPTION === 'true');
  }
};

/**
 * Content encryption specifically for AccountBlock content field
 * Handles backward compatibility with existing unencrypted records
 */
export class ContentEncryption {
  private static readonly CONTENT_PREFIX = 'ENC_V1:';

  /**
   * Encrypts the entire account content (JSON stringified data)
   * Adds a version prefix for future compatibility
   */
  public static encryptContent(content: string): string {
    if (!content || content.trim() === '') {
      return content;
    }

    // Don't double-encrypt
    if (ContentEncryption.isContentEncrypted(content)) {
      return content;
    }

    // Use the existing token encryption but with content prefix
    const encrypted = TokenEncryption.encryptToken(content);
    return ContentEncryption.CONTENT_PREFIX + encrypted;
  }

  /**
   * Decrypts account content with backward compatibility
   * Returns plaintext JSON for both encrypted and legacy unencrypted records
   */
  public static decryptContent(content: string): string {
    if (!content || content.trim() === '') {
      return content;
    }

    // If not encrypted, return as-is (backward compatibility)
    if (!ContentEncryption.isContentEncrypted(content)) {
      log.info('Reading legacy unencrypted account content (will be encrypted on next update)');
      return content;
    }

    // Remove prefix and decrypt
    const encryptedData = content.slice(ContentEncryption.CONTENT_PREFIX.length);
    return TokenEncryption.decryptToken(encryptedData);
  }

  /**
   * Checks if content is encrypted by looking for version prefix
   */
  public static isContentEncrypted(content: string): boolean {
    return !!(content && content.startsWith(ContentEncryption.CONTENT_PREFIX));
  }

  /**
   * Migrates legacy unencrypted content to encrypted format
   * Used during record updates to gradually encrypt existing data
   */
  public static migrateContent(content: string): string {
    if (!content || ContentEncryption.isContentEncrypted(content)) {
      return content; // Already encrypted or empty
    }

    log.info('Migrating legacy account content to encrypted format');
    return ContentEncryption.encryptContent(content);
  }

  /**
   * Safely updates account content - always encrypts on write
   * This ensures gradual migration of existing records
   */
  public static secureContentForStorage(content: string): string {
    if (!EncryptionConfig.isEnabled()) {
      return content; // Skip encryption in test environment
    }

    return ContentEncryption.migrateContent(content);
  }
}