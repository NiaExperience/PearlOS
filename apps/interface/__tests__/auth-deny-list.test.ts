/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @fileoverview Tests for email deny list authentication blocking
 * 
 * These tests validate that users on the global email deny list are
 * prevented from signing in to any Nia application (interface, dashboard).
 * 
 * When a user on the deny list attempts to sign in, the signIn callback
 * returns '/login?error=AccessDenied' which NextAuth interprets as a
 * redirect to the error page.
 * 
 * Note: These tests focus on the deny list blocking functionality.
 * Tests for users NOT on the deny list require full database setup
 * and are covered in the integration test suite.
 */

import * as GlobalSettingsActions from '@nia/prism/core/actions/globalSettings-actions';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { IGlobalSettings, DefaultGlobalSettings } from '@nia/prism/core/blocks/globalSettings.block';
import { v4 as uuidv4 } from 'uuid';

// Deny redirect URL returned when user is on deny list
const ACCESS_DENIED_REDIRECT = '/login?error=AccessDenied';

// Setup test environment
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

// Create auth options for testing (interface app)
const testAuthConfig = {
  appType: 'interface' as const,
  baseUrl: 'http://localhost:3000',
  googleCredentials: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  cookiePrefix: 'interface-auth',
  pages: { signIn: '/login', error: '/unauthorized' },
};
const authOptions = createAuthOptions(testAuthConfig);

// Create auth options for dashboard app
const dashboardAuthConfig = {
  appType: 'dashboard' as const,
  baseUrl: 'http://localhost:4000',
  googleCredentials: {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
  },
  cookiePrefix: 'dashboard-auth',
  pages: { signIn: '/login', error: '/unauthorized' },
};
const dashboardAuthOptions = createAuthOptions(dashboardAuthConfig);

describe('Email Deny List Authentication Blocking', () => {
  // Mock GlobalSettingsActions.getGlobalSettings
  let mockGetGlobalSettings: jest.SpyInstance;
  let testDenyList: string[];

  beforeEach(() => {
    // Reset deny list for each test
    testDenyList = [];
    
    // Mock getGlobalSettings to return our test deny list
    mockGetGlobalSettings = jest.spyOn(GlobalSettingsActions, 'getGlobalSettings');
    mockGetGlobalSettings.mockImplementation(async (): Promise<IGlobalSettings> => ({
      ...DefaultGlobalSettings,
      denyListEmails: testDenyList,
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Google OAuth Sign-In Blocking', () => {
    function createTestGoogleUser(email?: string) {
      return {
        id: 'temp-google-id',
        email: email || `googleuser-${uuidv4()}@example.com`,
        name: 'Google Test User',
        image: 'https://example.com/avatar.jpg',
        sessionId: uuidv4(),
        emailVerified: null,
      };
    }

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

    it('should deny sign-in for user on deny list (interface)', async () => {
      const bannedEmail = 'banned-user@example.com';
      testDenyList = [bannedEmail];

      const googleUser = createTestGoogleUser(bannedEmail);

      const signInCallback = authOptions.callbacks?.signIn;
      expect(signInCallback).toBeDefined();

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      // Access denied returns redirect URL string
      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should deny sign-in for user on deny list (dashboard)', async () => {
      const bannedEmail = 'banned-dashboard@example.com';
      testDenyList = [bannedEmail];

      const googleUser = createTestGoogleUser(bannedEmail);

      const signInCallback = dashboardAuthOptions.callbacks?.signIn;
      expect(signInCallback).toBeDefined();

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should perform case-insensitive email matching (lowercase deny list)', async () => {
      // Deny list has lowercase email
      testDenyList = ['banned-case@example.com'];

      // User signs in with different casing
      const googleUser = createTestGoogleUser('BANNED-CASE@EXAMPLE.COM');

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should perform case-insensitive matching when deny list has uppercase', async () => {
      // Deny list has uppercase email
      testDenyList = ['BANNED-UPPER@EXAMPLE.COM'];

      // User signs in with lowercase
      const googleUser = createTestGoogleUser('banned-upper@example.com');

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should handle multiple emails in deny list', async () => {
      testDenyList = [
        'banned1@example.com',
        'banned2@example.com',
        'banned3@example.com',
      ];

      // Try second email in list
      const googleUser = createTestGoogleUser('banned2@example.com');

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should block first email in deny list', async () => {
      testDenyList = [
        'first-banned@example.com',
        'second-banned@example.com',
      ];

      const googleUser = createTestGoogleUser('first-banned@example.com');

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should block last email in deny list', async () => {
      testDenyList = [
        'first-banned@example.com',
        'last-banned@example.com',
      ];

      const googleUser = createTestGoogleUser('last-banned@example.com');

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });
  });

  describe('Credentials Sign-In Blocking', () => {
    it('should deny credentials sign-in for user on deny list', async () => {
      const bannedEmail = `banned-creds-${uuidv4()}@example.com`;
      const userId = `user-${uuidv4()}`;
      testDenyList = [bannedEmail];

      const credentialsAccount = {
        provider: 'credentials',
        type: 'credentials' as const,
        providerAccountId: userId,
      };

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: {
          id: userId,
          email: bannedEmail,
          name: 'Banned Creds User',
          sessionId: uuidv4(),
        },
        account: credentialsAccount,
        profile: undefined,
        email: undefined,
        credentials: { email: bannedEmail, password: 'password123' } as any,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });
  });

  describe('Anonymous User Sign-In', () => {
    it('should allow anonymous sign-in (no email to check)', async () => {
      testDenyList = ['banned@example.com'];

      const anonymousUser = {
        id: `anon-${uuidv4()}`,
        name: 'Anonymous User',
        email: null, // Anonymous users don't have email
        sessionId: uuidv4(),
        is_anonymous: true,
      };

      const anonymousAccount = {
        provider: 'anonymous',
        type: 'credentials' as const,
        providerAccountId: anonymousUser.id,
      };

      const signInCallback = authOptions.callbacks?.signIn;

      // Should not block - anonymous users have no email to check
      const result = await signInCallback!({
        user: anonymousUser as any,
        account: anonymousAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      // Anonymous sign-in should succeed (no email to deny)
      expect(result).toBe(true);
    });
  });

  describe('Redirect URL Format', () => {
    it('should return proper redirect URL format when user is on deny list', async () => {
      const bannedEmail = 'redirect-test@example.com';
      testDenyList = [bannedEmail];

      const googleUser = {
        id: 'temp-google-id',
        email: bannedEmail,
        name: 'Banned User',
        image: null,
        sessionId: uuidv4(),
        emailVerified: null,
      };

      const testGoogleAccount = {
        provider: 'google',
        type: 'oauth' as const,
        providerAccountId: `google-${uuidv4()}`,
        access_token: 'mock-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      // Should return redirect URL, not throw
      expect(result).toBe(ACCESS_DENIED_REDIRECT);
      expect(typeof result).toBe('string');
      expect(result).toContain('error=AccessDenied');
    });
  });

  describe('Edge Cases - Blocking', () => {
    it('should handle special characters in email addresses on deny list', async () => {
      const specialEmail = 'user+tag@example.com';
      testDenyList = [specialEmail];

      const googleUser = {
        id: 'temp-google-id',
        email: specialEmail,
        name: 'Special Char User',
        sessionId: uuidv4(),
        emailVerified: null,
      };

      const testGoogleAccount = {
        provider: 'google',
        type: 'oauth' as const,
        providerAccountId: `google-${uuidv4()}`,
        access_token: 'mock-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });

    it('should block email with mixed case special characters', async () => {
      const specialEmail = 'User.Name+TAG@Example.COM';
      testDenyList = ['user.name+tag@example.com'];

      const googleUser = {
        id: 'temp-google-id',
        email: specialEmail,
        name: 'Mixed Case User',
        sessionId: uuidv4(),
        emailVerified: null,
      };

      const testGoogleAccount = {
        provider: 'google',
        type: 'oauth' as const,
        providerAccountId: `google-${uuidv4()}`,
        access_token: 'mock-token',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };

      const signInCallback = authOptions.callbacks?.signIn;

      const result = await signInCallback!({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(ACCESS_DENIED_REDIRECT);
    });
  });

  describe('isEmailDenied Helper Function', () => {
    // Note: The isEmailDenied function uses getGlobalSettings internally.
    // Due to ESM module scoping, jest.spyOn doesn't intercept internal calls
    // within the same module. These tests verify the function signature
    // and behavior with null/undefined inputs which don't require the mock.
    // The deny list blocking behavior is fully tested in the signIn callback
    // tests above, which use a dynamic require() that the mock can intercept.

    it('should return false for null email', async () => {
      // This test works because null email short-circuits before calling getGlobalSettings
      const result = await GlobalSettingsActions.isEmailDenied(null);
      expect(result).toBe(false);
    });

    it('should return false for undefined email', async () => {
      // This test works because undefined email short-circuits before calling getGlobalSettings
      const result = await GlobalSettingsActions.isEmailDenied(undefined);
      expect(result).toBe(false);
    });

    it('should be exported as a function', () => {
      expect(typeof GlobalSettingsActions.isEmailDenied).toBe('function');
    });
  });
});
