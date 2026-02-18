/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAnonymousUserById } from '@nia/prism/core/actions/anonymous-user-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';
import { getAccounts } from '@nia/prism/core/actions/account-actions';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { v4 as uuidv4 } from 'uuid';

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

// Set up test environment variables
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
process.env.GOOGLE_INTERFACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_INTERFACE_CLIENT_SECRET = 'test-client-secret';

describe('NextAuth Integration Tests', () => {

  describe('SignIn Callback', () => {
    it('should create anonymous user when user has no email', async () => {
      const user = { id: 'temp-id', is_anonymous: false, email: null, emailVerified: null, sessionId: uuidv4() };
      
      const signInResult = await authOptions.callbacks?.signIn?.({ 
        user,
        account: null,
        profile: undefined,
        email: undefined,
        credentials: undefined 
      });
      
      expect(signInResult).toBe(true);
      expect(user.is_anonymous).toBe(true);
      
      // Check if the anonymous user was actually created in the database
      const anonymousUserResponse = await getAnonymousUserById(user.id);
      expect(anonymousUserResponse).toBeTruthy();
    });

    it('should create a new user for Google auth if user doesn\'t exist', async () => {
      const email = `google-user-${uuidv4()}@test.com`;
      const mockUser = { 
        id: uuidv4(), 
        email: email,
        name: 'Google User',
        image: 'https://example.com/google-profile.jpg',
        sessionId: uuidv4(),
        emailVerified: null
      };
      
      const mockAccount = {
        provider: 'google',
        providerAccountId: `google-${uuidv4()}`,
        type: 'oauth' as const,
        access_token: 'access-token',
        token_type: 'Bearer'
      };
      
      const signInResult = await authOptions.callbacks?.signIn?.({
        user: mockUser,
        account: mockAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined
      });
      
      expect(signInResult).toBe(true);
      expect(mockUser.id).not.toBe('temp-id');
      
      // Verify the user was created in the database
      const userResponse = await getUserById(mockUser.id);
      expect(userResponse).toBeTruthy();
      if (userResponse) {
        expect(userResponse.email).toBe(email);
      }
      
      // Verify account was created
      const accountResponse = await getAccounts(mockUser.id);
      expect(accountResponse).toBeTruthy();
      expect(accountResponse?.length).toBe(1);
      if (accountResponse && accountResponse[0]) {
        expect(accountResponse[0].provider).toBe('google');
      }
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
        email: 'anon@example.com',
        emailVerified: null,
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
