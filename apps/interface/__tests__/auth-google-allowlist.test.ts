/**
 * Google sign-in allowlist: when GOOGLE_SIGNIN_ALLOWLIST is configured, only listed
 * emails may complete the Google OAuth path.
 */

import * as AccountActions from '@nia/prism/core/actions/account-actions';
import * as GlobalSettingsActions from '@nia/prism/core/actions/globalSettings-actions';
import * as UserActions from '@nia/prism/core/actions/user-actions';
import {
  createAuthOptions,
  parseGoogleSignInAllowlistEnabledEnv,
  parseGoogleSignInAllowlistEnv,
} from '@nia/prism/core/auth/authOptions';
import { IGlobalSettings, DefaultGlobalSettings } from '@nia/prism/core/blocks/globalSettings.block';
import { v4 as uuidv4 } from 'uuid';

const ACCESS_DENIED_REDIRECT = '/login?error=AccessDenied';

process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';

describe('parseGoogleSignInAllowlistEnv', () => {
  it('returns undefined for null, undefined, or blank', () => {
    expect(parseGoogleSignInAllowlistEnv(undefined)).toBeUndefined();
    expect(parseGoogleSignInAllowlistEnv(null)).toBeUndefined();
    expect(parseGoogleSignInAllowlistEnv('')).toBeUndefined();
    expect(parseGoogleSignInAllowlistEnv('  \n  ')).toBeUndefined();
  });

  it('parses comma-separated emails and lowercases', () => {
    expect(parseGoogleSignInAllowlistEnv('A@X.com,b@y.com')).toEqual(['a@x.com', 'b@y.com']);
  });

  it('parses newline-separated emails', () => {
    expect(parseGoogleSignInAllowlistEnv('one@test.com\ntwo@test.com')).toEqual([
      'one@test.com',
      'two@test.com',
    ]);
  });
});

describe('parseGoogleSignInAllowlistEnabledEnv', () => {
  it('defaults to enabled', () => {
    expect(parseGoogleSignInAllowlistEnabledEnv(undefined)).toBe(true);
    expect(parseGoogleSignInAllowlistEnabledEnv(null)).toBe(true);
    expect(parseGoogleSignInAllowlistEnabledEnv('')).toBe(true);
  });

  it('treats false-like values as disabled', () => {
    expect(parseGoogleSignInAllowlistEnabledEnv('false')).toBe(false);
    expect(parseGoogleSignInAllowlistEnabledEnv('0')).toBe(false);
    expect(parseGoogleSignInAllowlistEnabledEnv('off')).toBe(false);
    expect(parseGoogleSignInAllowlistEnabledEnv('disabled')).toBe(false);
  });
});

describe('Google sign-in allowlist (processSignIn)', () => {
  let mockGetGlobalSettings: jest.SpyInstance;

  beforeEach(() => {
    mockGetGlobalSettings = jest.spyOn(GlobalSettingsActions, 'getGlobalSettings');
    mockGetGlobalSettings.mockImplementation(async (): Promise<IGlobalSettings> => ({
      ...DefaultGlobalSettings,
      denyListEmails: [],
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const testGoogleAccount = {
    provider: 'google',
    type: 'oauth' as const,
    providerAccountId: `google-${uuidv4()}`,
    access_token: 'mock-access-token',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    id_token: 'mock-id-token',
    scope: 'email profile',
  };

  it('denies Google sign-in when email is not in allowlist', async () => {
    const authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: { clientId: 'id', clientSecret: 'sec' },
      googleSignInAllowlistEmails: ['allowed@example.com'],
      cookiePrefix: 'interface-auth',
      pages: { signIn: '/login' },
    });

    const result = await authOptions.callbacks?.signIn?.({
      user: {
        id: 't',
        email: 'other@example.com',
        name: 'Other',
        sessionId: uuidv4(),
      },
      account: testGoogleAccount,
      profile: undefined,
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(ACCESS_DENIED_REDIRECT);
  });

  it('allows Google sign-in when email is in allowlist (existing user)', async () => {
    const email = 'allowed@example.com';
    jest.spyOn(UserActions, 'getUserByEmail').mockResolvedValue({
      _id: 'user-1',
      email,
      name: 'Allowed',
      emailVerified: new Date(),
    } as any);
    jest.spyOn(UserActions, 'updateUser').mockResolvedValue(undefined as any);
    jest.spyOn(AccountActions, 'getUserAccountByProvider').mockResolvedValue({
      _id: 'acc-1',
      userId: 'user-1',
      provider: 'google',
    } as any);
    jest.spyOn(AccountActions, 'updateAccount').mockResolvedValue(undefined as any);

    const authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: { clientId: 'id', clientSecret: 'sec' },
      googleSignInAllowlistEmails: [email],
      cookiePrefix: 'interface-auth',
      pages: { signIn: '/login' },
    });

    const result = await authOptions.callbacks?.signIn?.({
      user: {
        id: 'temp',
        email,
        name: 'Allowed',
        sessionId: uuidv4(),
      },
      account: testGoogleAccount,
      profile: { name: 'Allowed' },
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(true);
  });

  it('skips Google allowlist checks when allowlist enforcement is disabled', async () => {
    const email = 'outside@example.com';
    jest.spyOn(GlobalSettingsActions, 'getGoogleSignInAllowList').mockRejectedValue(
      new Error('allowlist should not be read'),
    );
    jest.spyOn(UserActions, 'getUserByEmail').mockResolvedValue({
      _id: 'user-outside',
      email,
      name: 'Outside',
      emailVerified: new Date(),
    } as any);
    jest.spyOn(UserActions, 'updateUser').mockResolvedValue(undefined as any);
    jest.spyOn(AccountActions, 'getUserAccountByProvider').mockResolvedValue({
      _id: 'acc-outside',
      userId: 'user-outside',
      provider: 'google',
    } as any);
    jest.spyOn(AccountActions, 'updateAccount').mockResolvedValue(undefined as any);

    const authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: { clientId: 'id', clientSecret: 'sec' },
      googleSignInAllowlistEmails: ['allowed@example.com'],
      googleSignInAllowlistEnabled: false,
      cookiePrefix: 'interface-auth',
      pages: { signIn: '/login' },
    });

    const result = await authOptions.callbacks?.signIn?.({
      user: {
        id: 'temp',
        email,
        name: 'Outside',
        sessionId: uuidv4(),
      },
      account: testGoogleAccount,
      profile: { name: 'Outside' },
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(GlobalSettingsActions.getGoogleSignInAllowList).not.toHaveBeenCalled();
  });

  it('does not apply allowlist to credentials provider', async () => {
    const authOptions = createAuthOptions({
      appType: 'interface',
      baseUrl: 'http://localhost:3000',
      googleCredentials: { clientId: 'id', clientSecret: 'sec' },
      googleSignInAllowlistEmails: ['only-google@example.com'],
      cookiePrefix: 'interface-auth',
      pages: { signIn: '/login' },
    });

    jest.spyOn(UserActions, 'getUserByEmail').mockResolvedValue({
      _id: 'u2',
      email: 'creds@example.com',
      name: 'C',
      password: 'hashed',
    } as any);

    const signInCallback = authOptions.callbacks?.signIn;
    const result = await signInCallback!({
      user: {
        id: 'u2',
        email: 'creds@example.com',
        name: 'C',
        sessionId: uuidv4(),
      },
      account: {
        provider: 'credentials',
        type: 'credentials' as const,
        providerAccountId: 'u2',
      },
      profile: undefined,
      email: undefined,
      credentials: { email: 'creds@example.com', password: 'x' } as any,
    });

    expect(result).toBe(true);
  });
});
