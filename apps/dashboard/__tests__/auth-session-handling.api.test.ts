/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';

// Mock environment variables
process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-client-secret';

// Create auth options for testing dashboard
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

describe('NextAuth Session Handling', () => {

  describe('Cookie Configuration', () => {
    it('should configure session token cookie correctly', () => {
      const sessionCookie = authOptions.cookies?.sessionToken;
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie?.name).toBe('dashboard-auth.session-token');
      expect(sessionCookie?.options).toEqual(expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 30 * 24 * 60 * 60 // 30 days
      }));
    });
  });

  describe('Session Strategy', () => {
    it('should use JWT strategy for session management', () => {
      expect(authOptions.session?.strategy).toBe('jwt');
      expect(authOptions.session?.maxAge).toBe(30 * 24 * 60 * 60); // 30 days
    });
  });

  describe('JWT Callback', () => {
    it('should handle JWT callback for regular users', async () => {
      const token = {};
      const user = { 
        id: 'user-id', 
        email: 'user@example.com',
        name: 'Regular User',
        is_anonymous: false,
        sessionId: uuidv4(),
      };
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
        is_anonymous: false,
        sessionId: expect.any(String)
      }));
    });
    
    it('should handle JWT callback for anonymous users', async () => {
      const token = {};
      const user = { 
        id: 'anon-id', 
        is_anonymous: true,
        email: null,
        emailVerified: null,
        sessionId: uuidv4()
      };
      
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
        userId: 'anon-id',
        is_anonymous: true,
        sessionId: expect.any(String)
      }));
    });
    
    it('should return existing token when no user is provided', async () => {
      const token = { 
        userId: 'existing-user-id',
        is_anonymous: false,
        someExtraData: 'value'
      };
      
      const result = await authOptions.callbacks?.jwt?.({
        token,
        user: undefined as any,
        account: null,
        profile: undefined,
        trigger: undefined,
        session: undefined,
        isNewUser: false
      });
      
      // Should just return existing token unchanged
      expect(result).toEqual(token);
    });
  });

  describe('Session Callback', () => {
    it('should handle session callback for regular users', async () => {
      const session = {
        user: {
          name: 'Regular User',
          email: 'user@example.com'
        }
      } as any;
      
      const token = {
        userId: 'user-id',
        is_anonymous: false
      };

      const user = {
        name: 'Regular User',
        email: 'user@example.com',
        id: 'user-id',
        emailVerified: new Date(),
        sessionId: uuidv4(),
        is_anonymous: false
      };
      
      const result = await authOptions.callbacks?.session?.({
        session,
        token,
        user: user,
        newSession: undefined,
        trigger: undefined as any,
      });
      
      expect(result?.user).toEqual(expect.objectContaining({
        name: 'Regular User',
        email: 'user@example.com',
        id: 'user-id',
        is_anonymous: false,
        sessionId: expect.any(String)
      }));
    });
    
    it('should handle session callback for anonymous users', async () => {
      const session = {
        user: {
          name: 'Guest'
        }
      } as any;
      
      const token = {
        userId: 'anon-id',
        is_anonymous: true,
        sessionId: 'test-anon-session-id'
      };
      
      const result = await authOptions.callbacks?.session?.({
        session,
        token,
        user: undefined as any,
        newSession: undefined,
        trigger: undefined as any,
      });
      
      expect(result?.user).toEqual(expect.objectContaining({
        name: 'Guest',
        id: 'anon-id',
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