/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import * as AccountActions from '@nia/prism/core/actions/account-actions';
import * as UserActions from '@nia/prism/core/actions/user-actions';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { createTestAccount, createTestUser } from '@nia/prism/testing/testlib';

// Create auth options for testing
const testAuthConfig = {
  appType: 'dashboard' as const,
  baseUrl: 'http://localhost:4000',
  googleCredentials: {
    clientId: process.env.GOOGLE_DASHBOARD_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_DASHBOARD_CLIENT_SECRET!,
  },
  cookiePrefix: 'dashboard-auth',
  pages: { signIn: '/login', error: '/unauthorized' },
};
const authOptions = createAuthOptions(testAuthConfig); 

// Set up test environment variables
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-client-secret';

// Mock environment variables
process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-client-secret';

describe('Google OAuth Authentication Flow', () => {
  // Setup test data
  function testGoogleUser() {
    return {
      id: 'temp-google-id',
      email: `googleuser@${uuidv4()}.example.com`,
      name: 'Google User',
      image: 'https://example.com/google-avatar.jpg',
      sessionId: uuidv4(),
    emailVerified: null
  }};

  const testGoogleAccount = {
    provider: 'google',
    type: 'oauth' as const,
    providerAccountId: 'google-123456',
    access_token: 'mock-access-token',
    expires_at: 1234567890,
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    id_token: 'mock-id-token',
    scope: 'email profile',
    session_state: 'mock-session-state'
  };


  describe('Google OAuth Provider Configuration', () => {
    it('should have correct Google provider configuration', () => {
      const googleProvider = authOptions.providers.find(p => p.id === 'google');

      expect(googleProvider).toBeDefined();
      expect(googleProvider?.id).toBe('google');
      expect(googleProvider?.type).toBe('oauth');
    });
  });

  describe('SignIn callback for Google OAuth', () => {
    it('should use existing user when Google user already exists', async () => {
      // Create user
      const googleUser = testGoogleUser();
      const existingUser = {
        email: googleUser.email,
        name: googleUser.name,
        image: googleUser.image
      };
      const user = await createTestUser(existingUser, 'password123');
      const account = await createTestAccount({
        userId: user._id,
        provider: 'google',
        providerAccountId: testGoogleAccount.providerAccountId,
        type: 'oauth' as const
      });
      expect(account).toBeDefined();
      
      jest.spyOn(UserActions, 'getUserByEmail'); // Tracks calls to the real function
      jest.spyOn(UserActions, 'createUser'); // Tracks calls to the real function

      const result = await authOptions.callbacks?.signIn?.({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined
      });

      expect (UserActions.getUserByEmail).toHaveBeenCalledWith(googleUser.email);
      expect(UserActions.createUser).not.toHaveBeenCalled(); // Should not create a new

      expect(result).toBe(true);
    });

    it('should create new user when Google user does not exist', async () => {
      jest.spyOn(UserActions, 'getUserByEmail'); // Tracks calls to the real function
      jest.spyOn(UserActions, 'createUser'); // Tracks calls to the real function
      jest.spyOn(AccountActions, 'createAccount'); // Tracks calls to the real function
      const googleUser = testGoogleUser();
      const user = { ...googleUser };
      const result = await authOptions.callbacks?.signIn?.({
        user,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined
      });

      expect(result).toBe(true);

      expect(UserActions.getUserByEmail).toHaveBeenCalledWith(googleUser.email);
      // Verify user creation
      expect(UserActions.createUser).toHaveBeenCalledWith(expect.objectContaining({
        email: googleUser.email,
        name: googleUser.name,
        image: googleUser.image,
        emailVerified: expect.anything(),
      }));

      // Verify account creation
      expect(AccountActions.createAccount).toHaveBeenCalledWith(expect.objectContaining({
        provider: 'google',
        providerAccountId: 'google-123456',
        refresh_token: 'mock-refresh-token',
      }));

    });

    it('should fail gracefully when user creation fails', async () => {
      // Mock no existing user
      (UserActions.getUserByEmail as jest.Mock).mockResolvedValue(null);

      // Mock user creation failure
      (UserActions.createUser as jest.Mock).mockRejectedValue(new Error('Database error'));
      const googleUser = testGoogleUser();
      const result = await authOptions.callbacks?.signIn?.({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined
      });

      expect(UserActions.getUserByEmail).toHaveBeenCalledWith(googleUser.email);
      expect(UserActions.createUser).toHaveBeenCalled();
      expect(AccountActions.createAccount).not.toHaveBeenCalled();
      expect(result).toBe(false); // Sign-in should be prevented on error
    });
  });

  describe('JWT and Session handling for Google OAuth users', () => {
    it('should add correct data to JWT token for Google user', async () => {
      const token = {};
      const googleUser = testGoogleUser();
      const user = {
        id: 'google-user-id',
        email: googleUser.email,
        name: googleUser.name,
        is_anonymous: false,
        sessionId: googleUser.sessionId,
        emailVerified: null
      };

      const result = await authOptions.callbacks?.jwt?.({
        token,
        user: user,
        account: testGoogleAccount,
        profile: undefined,
        trigger: undefined,
        session: undefined,
        isNewUser: false
      });

      expect(result).toEqual(expect.objectContaining({
        userId: 'google-user-id',
        is_anonymous: false,
        sessionId: expect.any(String)
      }));
    });

    it('should add Google user data from token to session', async () => {
      const session = {
        user: {
          name: 'Google User',
          email: 'googleuser@example.com',
          image: 'https://example.com/google-avatar.jpg'
        }
      } as any;

      const token = {
        userId: 'google-user-id',
        is_anonymous: false
      };

      const result = await authOptions.callbacks?.session?.({
        session,
        token,
        user: undefined as any,
        newSession: undefined,
        trigger: undefined as any
      });

      expect(result?.user).toEqual(expect.objectContaining({
        name: 'Google User',
        email: 'googleuser@example.com',
        image: 'https://example.com/google-avatar.jpg',
        id: 'google-user-id',
        is_anonymous: false,
        sessionId: expect.any(String)
      }));
    });
  });
});
