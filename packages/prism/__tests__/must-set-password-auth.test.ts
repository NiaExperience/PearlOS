/**
 * Tests for mustSetPassword flag propagation across auth callbacks
 */

import { createAuthOptions } from '../src/core/auth/authOptions';

// Mock minimal action modules used in callbacks to avoid touching real data layer
jest.mock('../src/core/actions/user-actions', () => ({
  getUserByEmail: jest.fn().mockResolvedValue(null),
  createUser: jest.fn().mockResolvedValue({ _id: 'newUserId', email: 'user@example.com', name: 'User' }),
  verifyUserPassword: jest.fn(),
  getUserById: jest.fn().mockResolvedValue({ _id: 'newUserId', email: 'user@example.com', name: 'User', image: null }),
}));

jest.mock('../src/core/actions/account-actions', () => ({
  getUserAccountByProvider: jest.fn().mockResolvedValue(null),
  createAccount: jest.fn().mockResolvedValue({ _id: 'accountId' }),
  updateAccount: jest.fn(),
}));

jest.mock('../src/core/actions/anonymous-user-actions', () => ({
  createAnonymousUser: jest.fn().mockResolvedValue({ _id: 'anonId' }),
}));

describe('authOptions mustSetPassword behavior', () => {
  const baseConfig = {
    appType: 'interface' as const,
    baseUrl: 'http://localhost:3000',
    googleCredentials: { clientId: 'cid', clientSecret: 'secret' },
  };
  const { callbacks } = createAuthOptions(baseConfig);
  if (!callbacks) throw new Error('callbacks missing');

  test('credentials provisional user retains mustSetPassword = true through jwt/session', async () => {
    // Simulate a provisional credentials login (authorize already set mustSetPassword=true)
    const provisionalUser: any = {
      id: 'user1',
      email: 'prov@example.com',
      sessionId: 'sess1',
      is_anonymous: false,
      mustSetPassword: true,
    };
    // jwt callback with credentials provider (no account or provider)
  const tokenAfterJwt: any = await (callbacks.jwt as any)({ token: {}, user: provisionalUser, account: { provider: 'credentials' } as any, profile: undefined });
    expect(tokenAfterJwt.mustSetPassword).toBe(true);

    // session callback should copy flag to session.user
  const session: any = { user: { id: '', sessionId: '' } };
  const sessionAfter: any = await (callbacks.session as any)({ session, token: tokenAfterJwt });
  expect(sessionAfter.user.mustSetPassword).toBe(true);
  });

  test('google auth always clears mustSetPassword even if user had it set', async () => {
    const googleUser: any = {
      id: 'user2',
      email: 'g@example.com',
      sessionId: 'sess2',
      is_anonymous: false,
      mustSetPassword: true, // simulate stale flag
      google_access_token: 'token123',
    };

    // First pass through jwt with explicit google account
  const tokenAfterJwt: any = await (callbacks.jwt as any)({ token: {}, user: googleUser, account: { provider: 'google' } as any, profile: undefined });
    expect(tokenAfterJwt.mustSetPassword).toBe(false);

    // Session should also reflect false
  const session: any = { user: { id: '', sessionId: '' } };
  const sessionAfter: any = await (callbacks.session as any)({ session, token: tokenAfterJwt });
  expect(sessionAfter.user.mustSetPassword).toBe(false);
  });

  test('jwt callback clears mustSetPassword when google_access_token present even without account object', async () => {
    const googleUser: any = {
      id: 'user3',
      email: 'g2@example.com',
      sessionId: 'sess3',
      is_anonymous: false,
      mustSetPassword: true,
      google_access_token: 'xyz',
    };
  const tokenAfterJwt: any = await (callbacks.jwt as any)({ token: {}, user: googleUser, account: undefined as any, profile: undefined });
    expect(tokenAfterJwt.mustSetPassword).toBe(false);
  });
});
