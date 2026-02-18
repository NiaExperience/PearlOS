
import { NextRequest } from 'next/server';

import interfaceMiddleware from '../src/middleware';

// Mock dependencies
jest.mock('@nia/prism/core/auth/middleware', () => ({
  authMiddleware: jest.fn().mockImplementation(() => {
    return () => {
      // Return a 401 redirect to login to simulate auth middleware blocking the request
      // We need to require NextResponse here because jest.mock is hoisted
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { NextResponse } = require('next/server');
      return NextResponse.redirect(new URL('http://localhost:3000/login'));
    };
  }),
}));

// Helper to create a request
function createRequest(path: string, headers: Record<string, string> = {}) {
  const url = new URL(path, 'http://localhost:3000');
  const req = new NextRequest(url);
  Object.entries(headers).forEach(([key, value]) => {
    req.headers.set(key, value);
  });
  return req;
}

describe('Middleware Security - Auth Bypass', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules(); // This is crucial to re-import middleware with new env vars
    process.env = { ...originalEnv }; // Restore env after each test
  });

  afterAll(() => {
    process.env = originalEnv; // Ensure original env is restored at the end
  });

  // Helper to set NODE_ENV
  const setNodeEnv = (value: string) => {
    Object.defineProperty(process, 'env', {
      value: { ...originalEnv, NODE_ENV: value },
      configurable: true, // Allow re-defining property
    });
  };

  it('should BYPASS auth in NON-production when X-Test-Mode header is present', async () => {
    // Setup environment
    setNodeEnv('development');
    
    const req = createRequest('/pearlos', {
      'X-Test-Mode': 'true'
    });

    const res = await interfaceMiddleware(req);

    // If bypassed, we expect a rewrite (not a redirect to login)
    expect(res.status).not.toBe(307);
    // NextResponse.rewrite adds this header to indicate the destination
    expect(res.headers.get('x-middleware-rewrite')).toBeTruthy();
  });

  it('should ENFORCE auth in PRODUCTION even if X-Test-Mode header is present', async () => {
    // Setup environment
    setNodeEnv('production');
    
    const req = createRequest('/pearlos', {
      'X-Test-Mode': 'true'
    });

    const res = await interfaceMiddleware(req);

    // If NOT bypassed, it should fall through to authMiddleware which we mocked to redirect
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('should ENFORCE auth in PRODUCTION when X-Test-Mode header is missing', async () => {
    setNodeEnv('production');
    
    const req = createRequest('/pearlos');
    const res = await interfaceMiddleware(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('should BYPASS auth if NODE_ENV is test (regardless of header)', async () => {
    setNodeEnv('test');
    
    const req = createRequest('/pearlos');
    const res = await interfaceMiddleware(req);

    expect(res.status).not.toBe(307);
    expect(res.headers.get('x-middleware-rewrite')).toBeTruthy();
  });
});
