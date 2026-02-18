/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from '@jest/globals';
import { dashboardAuthOptions } from '../src/lib/auth-config';

// Mock environment variables
process.env.NEXTAUTH_SECRET = 'test-secret';
process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-client-secret';

// Set environment variables needed for tests
process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-client-secret';
process.env.NEXTAUTH_SECRET = 'test-auth-secret';

describe('Dashboard NextAuth Configuration', () => {
  beforeEach(() => {
    // Set up environment variables for testing
    process.env.NEXTAUTH_SECRET = 'test-secret';
    process.env.GOOGLE_DASHBOARD_CLIENT_ID = 'test-dashboard-client-id';
    process.env.GOOGLE_DASHBOARD_CLIENT_SECRET = 'test-dashboard-client-secret';
  });

  it('should have providers configured', () => {
    expect(dashboardAuthOptions.providers).toBeDefined();
    const credentialsProvider = dashboardAuthOptions.providers.find(
      (provider) => provider.id === 'credentials'
    );
    expect(credentialsProvider).toBeDefined();
  });

  it('should have Google OAuth provider configured', () => {
    expect(dashboardAuthOptions.providers).toBeDefined();
    const googleProvider = dashboardAuthOptions.providers.find(
      (provider) => provider.id === 'google'
    );
    expect(googleProvider).toBeDefined();
  });

  it('should handle anonymous user sign-in', async () => {
    await dashboardAuthOptions.callbacks?.signIn?.({
      user: { id: 'anonymous', email: null, name: 'Guest', is_anonymous: true, emailVerified: null, sessionId: 'test-session' },
      account: null,
      profile: undefined,
    });
    // Should not throw an error
  });

  it('should handle regular user sign-in', async () => {
    await dashboardAuthOptions.callbacks?.signIn?.({
      user: { id: 'user123', email: 'test@example.com', name: 'Test User', is_anonymous: false, emailVerified: null, sessionId: 'test-session' },
      account: null,
      profile: undefined,
    });
    // Should not throw an error
  });

  it('should handle JWT callback', async () => {
    const result = await dashboardAuthOptions.callbacks?.jwt?.({
      token: { userId: 'user123' },
      user: { id: 'user123', email: 'test@example.com', name: 'Test User', emailVerified: null, sessionId: 'test-session' },
      account: null,
      profile: undefined,
    });
    expect(result).toBeDefined();
  });

  it('should handle session callback', async () => {
    const result = await dashboardAuthOptions.callbacks?.session?.({
      session: { user: { id: 'user123', email: 'test@example.com', name: 'Test User', sessionId: 'test-session' }, expires: '2024-01-01' },
      token: { userId: 'user123', is_anonymous: false },
    } as any);
    expect(result).toBeDefined();
  });

  it('should handle redirect callback for dashboard', async () => {
    const result = await dashboardAuthOptions.callbacks?.redirect?.({ 
      url: 'http://localhost:4000/auth/signin', 
      baseUrl: 'http://localhost:4000' 
    });
    expect(result).toBe('http://localhost:4000/dashboard');
  });

  it('should handle redirect callback for login page', async () => {
    const result = await dashboardAuthOptions.callbacks?.redirect?.({ 
      url: 'http://localhost:4000/login', 
      baseUrl: 'http://localhost:4000' 
    });
    expect(result).toBe('http://localhost:4000/dashboard');
  });

  it('should handle redirect callback for other URLs', async () => {
    const result = await dashboardAuthOptions.callbacks?.redirect?.({ 
      url: 'http://localhost:4000/dashboard', 
      baseUrl: 'http://localhost:4000' 
    });
    expect(result).toBe('http://localhost:4000/dashboard');
  });
}); 