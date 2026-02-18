import { TokenEncryption, ContentEncryption, EncryptionConfig } from '@nia/prism/core/utils/encryption';

describe('encryption utilities', () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeAll(() => {
    process.env.TOKEN_ENCRYPTION_KEY = 'test-master-key-32-chars-min-length-!!';
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('encrypts and decrypts a token round trip', () => {
    const token = 'plain-token-value';
    const enc = TokenEncryption.encryptToken(token);
    expect(enc).not.toEqual(token);
    expect(TokenEncryption.isEncrypted(enc)).toBeTruthy();
    const dec = TokenEncryption.decryptToken(enc);
    expect(dec).toEqual(token);
  });

  it('handles empty and legacy tokens', () => {
    expect(TokenEncryption.encryptToken('')).toEqual('');
    // legacy (no colon) just returns as-is on decrypt
    expect(TokenEncryption.decryptToken('legacyToken')).toEqual('legacyToken');
  });

  it('migrates unencrypted tokens and skips already encrypted', async () => {
    const token = 'migrate-me';
    const migrated = await TokenEncryption.migrateToken(token);
    expect(migrated).not.toEqual(token);
    const migratedAgain = await TokenEncryption.migrateToken(migrated);
    expect(migratedAgain).toEqual(migrated);
  });

  it('throws on malformed encrypted string', () => {
    // Malformed because it has too many parts
    expect(() => TokenEncryption.decryptToken('a:b:c')).toThrow();
  });

  it('content encryption adds prefix and is idempotent', () => {
    const content = JSON.stringify({ a: 1 });
    const encrypted = ContentEncryption.encryptContent(content);
    expect(encrypted).not.toEqual(content);
    expect(ContentEncryption.isContentEncrypted(encrypted)).toBeTruthy();
    const decrypted = ContentEncryption.decryptContent(encrypted);
    expect(decrypted).toEqual(content);
    const double = ContentEncryption.encryptContent(encrypted); // Should not double encrypt
    expect(double).toEqual(encrypted);
  });

  it('secureContentForStorage respects test env vs FORCE_ENCRYPTION', () => {
    const content = JSON.stringify({ secret: true });
    // In test env without FORCE_ENCRYPTION should return original (encryption disabled)
    delete process.env.FORCE_ENCRYPTION;
    const normal = ContentEncryption.secureContentForStorage(content);
    expect(normal).toEqual(content);
    // Forcing encryption should encrypt
    process.env.FORCE_ENCRYPTION = 'true';
    const forced = ContentEncryption.secureContentForStorage(content);
    expect(forced).not.toEqual(content);
    expect(ContentEncryption.isContentEncrypted(forced)).toBeTruthy();
  });
});
