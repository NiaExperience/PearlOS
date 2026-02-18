import { issueResetToken, consumeResetToken } from '../src/core/email';
import { ResetPasswordTokenActions } from '../src/core/actions';

jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'msg123' });
  return {
    __esModule: true,
    default: {
      createTestAccount: jest.fn().mockResolvedValue({ smtp: { host: 'localhost', port: 1025, secure: false }, user: 'u', pass: 'p' }),
      createTransport: jest.fn().mockReturnValue({ sendMail }),
      getTestMessageUrl: jest.fn().mockReturnValue('preview-url')
    }
  };
});

describe('reset token persistence feature flag', () => {
  beforeAll(() => {
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
    }
  });

  it('falls back to in-memory when flag explicitly disabled', async () => {
    process.env.RESET_TOKEN_PERSISTENCE = 'disabled';
    // Use non-UUID user id to ensure memory path still works without DB parent_id constraint
    const token = await issueResetToken('user-flag-off', 'flagoff@example.com');
    expect(typeof token).toBe('string');
    const rec = await consumeResetToken(token);
    expect(rec?.userId).toBe('user-flag-off');
  // Assert token hash is NOT persisted
  const crypto = await import('crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const persisted = await ResetPasswordTokenActions.getResetPasswordTokenByHash(tokenHash);
  expect(persisted).toBeNull();
  });

  it('persists by default when flag not disabled', async () => {
    delete process.env.RESET_TOKEN_PERSISTENCE; // default enabled
    // Use a UUID-form user id to satisfy parent_id UUID requirement in persistence path
    const userUuid = '11111111-1111-4111-8111-111111111111';
    const token = await issueResetToken(userUuid, 'flagon@example.com');
    // Lookup via hash using actions to confirm persistence path
    const crypto = await import('crypto');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const persisted = await ResetPasswordTokenActions.getResetPasswordTokenByHash(tokenHash);
    expect(persisted).toBeTruthy();
    expect(persisted?.userId).toBe(userUuid);
    const consumed = await consumeResetToken(token);
    expect(consumed?.userId).toBe(userUuid);
    // Second consume should fail
    const reuse = await consumeResetToken(token);
    expect(reuse).toBeNull();
  });
});
