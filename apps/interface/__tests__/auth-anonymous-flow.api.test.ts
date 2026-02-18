/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';

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

// Mock environment variables
process.env.GOOGLE_INTERFACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_INTERFACE_CLIENT_SECRET = 'test-client-secret';

describe('Anonymous User Authentication Flow', () => {

  it('should create anonymous user during sign in when user has no email', async () => {
    const user = { 
      id: 'anonymous', // This is the temporary ID set by the authorize callback
      name: 'Guest',
      is_anonymous: true,
      sessionId: uuidv4(), // Generate a new session ID
      email: null,
      emailVerified: null
    };
    
    const result = await authOptions.callbacks?.signIn?.({ 
      user,
      account: null,
      profile: undefined,
      email: undefined,
      credentials: undefined 
    });
    
    // The temporary ID should be replaced with the real anonymous user ID
    expect(user.id).not.toBe('anonymous');
    expect(user.is_anonymous).toBe(true);
    expect(user.sessionId).toEqual(expect.any(String));
    expect(result).toBe(true);
  });
});
