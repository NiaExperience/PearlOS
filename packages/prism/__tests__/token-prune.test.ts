import { ResetPasswordTokenActions } from '../src/core/actions';
import { hashTokenForPersistence } from '../src/core/email/index';

// Helper to create a token with custom expiry by calling lower level action directly.
async function createToken(userId: string, purpose: 'invite_activation' | 'password_reset', expiresAt: Date) {
  const token = 'test-' + Math.random().toString(36).slice(2);
  const tokenHash = await hashTokenForPersistence(token);
  const rec = await ResetPasswordTokenActions.createResetPasswordToken({
    tokenHash,
    userId,
    email: userId + '@example.test',
    expiresAt: expiresAt.toISOString(),
    purpose,
    issuedAt: new Date().toISOString(),
    attempts: 0,
  } as any);
  return { rec, tokenHash };
}

describe('token prune scheduler / action', () => {
  const userA = '11111111-1111-1111-1111-111111111111';

  it('prunes only expired tokens', async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60); // 1h ago
    const future = new Date(Date.now() + 1000 * 60 * 60); // 1h ahead
    const { rec: expired } = await createToken(userA, 'invite_activation', past);
    const { rec: active } = await createToken(userA, 'password_reset', future);

    const beforeExpired = await ResetPasswordTokenActions.getResetPasswordTokenById(expired._id as string);
    const beforeActive = await ResetPasswordTokenActions.getResetPasswordTokenById(active._id as string);
    expect(beforeExpired).toBeTruthy();
    expect(beforeActive).toBeTruthy();

    const pruned = await ResetPasswordTokenActions.pruneExpiredResetPasswordTokens(new Date());
    expect(pruned).toBeGreaterThanOrEqual(1);

    const afterExpired = await ResetPasswordTokenActions.getResetPasswordTokenById(expired._id as string);
    const afterActive = await ResetPasswordTokenActions.getResetPasswordTokenById(active._id as string);
    expect(afterExpired).toBeNull();
    expect(afterActive).toBeTruthy();
  });
});
