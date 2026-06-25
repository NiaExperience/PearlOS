import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { getLogger } from '../logger';

const log = getLogger('prism:utils:encryption');

/**
 * Encryption utility for sensitive OAuth tokens
 * Uses AES-256-GCM for authenticated encryption (encrypt-then-authenticate)
 */
export class TokenEncryption {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly KEY_LENGTH = 32; // 256 bits
  private static readonly IV_LENGTH = 12;  // 96 bits (recommended for GCM)
  private static readonly AUTH_TAG_LENGTH = 16; // 128-bit auth tag

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
   * Encrypts a token using AES-256-GCM (authenticated encryption)
   * Returns format: iv:authTag:encryptedData (all base64 encoded)
   */
  public static encryptToken(token: string): string {
    if (!token || token.trim() === '') {
      return token; // Don't encrypt empty tokens
    }

    try {
      const masterKey = TokenEncryption.getMasterKey();
      const key = TokenEncryption.deriveKey(masterKey);

      // Generate random IV (96 bits recommended for GCM)
      const iv = randomBytes(TokenEncryption.IV_LENGTH);

      // Create cipher with GCM
      const cipher = createCipheriv(TokenEncryption.ALGORITHM, key, iv, {
        authTagLength: TokenEncryption.AUTH_TAG_LENGTH,
      } as any);

      // Encrypt the token
      let encrypted = cipher.update(token, 'utf8', 'base64');
      encrypted += cipher.final('base64');

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Combine iv:authTag:encrypted (all base64 encoded)
      const result = [
        iv.toString('base64'),
        authTag.toString('base64'),
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
   * Supports both:
   *   - GCM format: iv:authTag:encryptedData (3 parts)
   *   - Legacy CBC format: iv:encryptedData (2 parts) — for backward compatibility
   */
  public static decryptToken(encryptedToken: string): string {
    if (!encryptedToken || encryptedToken.trim() === '') {
      return encryptedToken; // Return empty tokens as-is
    }

    // Check if this looks like an encrypted token (has colons)
    if (!encryptedToken.includes(':')) {
      // Might be a legacy unencrypted token, return as-is
      return encryptedToken;
    }

    try {
      const masterKey = TokenEncryption.getMasterKey();
      const key = TokenEncryption.deriveKey(masterKey);

      const parts = encryptedToken.split(':');

      if (parts.length === 3) {
        // GCM format: iv:authTag:encrypted
        const [ivB64, authTagB64, encryptedB64] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const authTag = Buffer.from(authTagB64, 'base64');

        const decipher = createDecipheriv(TokenEncryption.ALGORITHM, key, iv, {
          authTagLength: TokenEncryption.AUTH_TAG_LENGTH,
        } as any);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;

      } else if (parts.length === 2) {
        // Legacy CBC format: iv:encrypted — decrypt with CBC for backward compat
        const [ivB64, encryptedB64] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedB64, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        log.warn('Decrypted legacy CBC token — will be re-encrypted as GCM on next write');
        return decrypted;

      } else {
        throw new Error('Invalid encrypted token format');
      }

    } catch (error) {
      log.error('Token decryption failed', { error });
      throw new Error('Failed to decrypt token - token may be corrupted or key changed');
    }
  }

  /**
   * Checks if a token appears to be encrypted
   */
  public static isEncrypted(token: string): boolean {
    if (!token || !token.includes(':')) return false;
    const parts = token.split(':').length;
    return parts === 2 || parts === 3; // 2 = legacy CBC, 3 = GCM
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