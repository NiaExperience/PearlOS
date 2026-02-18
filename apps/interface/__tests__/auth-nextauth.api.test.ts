/* eslint-disable @typescript-eslint/no-explicit-any */
import { UserActions } from '@nia/prism/core/actions';
import { getAccounts } from '@nia/prism/core/actions/account-actions';
import { getAnonymousUserById } from '@nia/prism/core/actions/anonymous-user-actions';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { v4 as uuidv4 } from 'uuid';

// Mock environment variables
process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.GOOGLE_INTERFACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_INTERFACE_CLIENT_SECRET = 'test-client-secret';

// Set environment variables needed for tests
process.env.GOOGLE_INTERFACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_INTERFACE_CLIENT_SECRET = 'test-client-secret';
process.env.NEXTAUTH_SECRET = 'test-auth-secret';

// Create auth options for testing
const testAuthConfig = {
  appType: 'interface' as const,
  baseUrl: 'http://localhost:3000',
  googleCredentials: {
    clientId: process.env.GOOGLE_INTERFACE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_INTERFACE_CLIENT_SECRET!,
  },
  cookiePrefix: 'interface',
  pages: { signIn: '/login' },
};
const authOptions = createAuthOptions(testAuthConfig);

describe('NextAuth Configuration', () => {

  describe('Providers', () => {
    it('should have credentials provider configuration', () => {
      expect(authOptions.providers).toBeDefined();
      const credentialsProvider = authOptions.providers.find(
        (provider) => provider.id === 'credentials'
      );
      expect(credentialsProvider).toBeDefined();
    });

    it('should have Google provider configuration', () => {
      expect(authOptions.providers).toBeDefined();
      const googleProvider = authOptions.providers.find(
        (provider) => provider.id === 'google'
      );
      expect(googleProvider).toBeDefined();
    });
  });

  describe('SignIn Callback', () => {
    it('should create anonymous user when user has no email', async () => {

      const user = { id: 'temp-id', is_anonymous: false, email: 'anon@example.com', emailVerified: null, sessionId: uuidv4() };

      let anonymousUser = await getAnonymousUserById(user.sessionId);
      expect(anonymousUser).toBeNull();
      
      await authOptions.callbacks?.signIn?.({ 
        user,
        account: null,
        profile: undefined,
        email: undefined,
        credentials: undefined 
      });
      
      anonymousUser = await getAnonymousUserById(user.sessionId);
      expect(anonymousUser).toBeDefined();
    });

    it('should create a new user for Google auth if user doesn\'t exist', async () => {
      const mockUser = { 
        email: 'google-user@example.com',
        name: 'Google User',
        image: 'https://example.com/google-profile.jpg',
        id: 'google-user-id',
        emailVerified: null,
        sessionId: uuidv4(),
        is_anonymous: false
      };
      
      const mockAccount = {
        provider: 'google',
        providerAccountId: 'google-account-id',
        type: 'oauth' as const,
        access_token: 'access-token',
        token_type: 'Bearer'
      };

      // Simulate Google sign-in, which should create both user and account
      await authOptions.callbacks?.signIn?.({
        user: {
          id: uuidv4(),
          email: mockUser.email,
          name: mockUser.name,
          image: mockUser.image,
          is_anonymous: false,
          emailVerified: null,
          sessionId: uuidv4()
        },
        account: mockAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined
      });

      // Find the user by email
      const createdUser = await UserActions.getUserByEmail(mockUser.email);
      expect(createdUser).toBeDefined();
      // Find the account linked to the user
      const anyAccount = (await getAccounts(createdUser!._id!)).find(a => a.provider === mockAccount.provider && a.providerAccountId === mockAccount.providerAccountId);
      expect(anyAccount).toBeDefined();
    });
  });

  describe('JWT Callback', () => {
    it('should add user properties to token', async () => {
      const token = {};
      const user = { id: 'user-id', is_anonymous: true, email: 'anon@example.com', emailVerified: null, sessionId: uuidv4() };

      const result = await authOptions.callbacks?.jwt?.({
        token,
        user,
        account: null,
        profile: undefined,
        trigger: undefined,
        session: undefined,
        isNewUser: false
      });
      
      expect(result).toEqual(expect.objectContaining({
        userId: 'user-id',
        is_anonymous: true,
        sessionId: expect.any(String)
      }));
    });
  });

  describe('Session Callback', () => {
    it('should add user ID and anonymous status from token to session', async () => {
      const session = { 
        user: { name: 'Test User' } 
      } as any;
      
      const token = { 
        userId: 'user-id', 
        is_anonymous: true,
        sessionId: uuidv4()
      };
      
      const result = await authOptions.callbacks?.session?.({
        session,
        token,
        user: undefined as any,
        newSession: undefined,
        trigger: undefined as any
      });
      
      expect(result?.user).toEqual(expect.objectContaining({
        name: 'Test User',
        id: 'user-id',
        is_anonymous: true,
        sessionId: expect.any(String)
      }));
    });
  });

  describe('Redirect Callback', () => {
    it('should redirect to base URL when signin URL is present', async () => {
      const baseUrl = 'https://example.com';
      const url = 'https://example.com/login?callbackUrl=dashboard';
      
      const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });
      
      expect(result).toBe(baseUrl);
    });

    it('should redirect to original URL when not signin URL', async () => {
      const baseUrl = 'https://example.com';
      const url = 'https://example.com/dashboard';
      
      const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });
      
      expect(result).toBe(url);
    });

    it('should redirect to base URL when URL is external', async () => {
      const baseUrl = 'https://example.com';
      const url = 'https://malicious.com';
      
      const result = await authOptions.callbacks?.redirect?.({ url, baseUrl });
      
      expect(result).toBe(baseUrl);
    });
  });
});
