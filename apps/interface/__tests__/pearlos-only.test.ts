import { NextRequest, NextResponse } from 'next/server';
import interfaceMiddleware from '../src/middleware';

// Mock NextResponse
jest.mock('next/server', () => {
  const actual = jest.requireActual('next/server');
  return {
    ...actual,
    NextResponse: {
      next: jest.fn().mockImplementation(() => ({ status: 200, headers: new Headers() })),
      redirect: jest.fn().mockImplementation((url: URL) => ({ status: 307, headers: new Headers({ location: url.toString() }), cookies: { set: jest.fn() } })),
      rewrite: jest.fn().mockImplementation((url: URL) => ({ status: 200, headers: new Headers({ 'x-middleware-rewrite': url.toString() }) })),
    },
  };
});

// Mock auth middleware
jest.mock('@nia/prism/core/auth/middleware', () => ({
  authMiddleware: () => jest.fn().mockImplementation(() => Promise.resolve(null)),
}));

describe('PEARLOS_ONLY Middleware Logic', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const createRequest = (path: string, host = 'localhost') => {
    const url = `http://${host}${path}`;
    return new NextRequest(new URL(url), {
      headers: new Headers({ host, 'x-forwarded-proto': 'http' }),
    });
  };

  it('should redirect to niaxp.com when PEARLOS_ONLY is false and no assistant in path (production)', async () => {
    process.env.PEARLOS_ONLY = 'false';
    (process.env as any).NODE_ENV = 'production';
    process.env.NEXTAUTH_URL = 'https://example.com';
    
    const req = createRequest('/', 'example.com');
    await interfaceMiddleware(req);
    
    expect(NextResponse.redirect).toHaveBeenCalledWith(
        expect.objectContaining({
            href: 'https://www.niaxp.com/'
        })
    );
  });

  it('should rewrite to pearlos assistant when PEARLOS_ONLY is true', async () => {
    process.env.PEARLOS_ONLY = 'true';
    (process.env as any).NODE_ENV = 'production';
    
    const req = createRequest('/', 'example.com');
    await interfaceMiddleware(req);
    
    expect(NextResponse.rewrite).toHaveBeenCalledWith(
        expect.objectContaining({
            pathname: '/pearlos'
        }),
        expect.anything()
    );
  });

  it('should rewrite to pearlos assistant when PEARLOS_ONLY is true and path is subpath', async () => {
    process.env.PEARLOS_ONLY = 'true';
    
    const req = createRequest('/some-page', 'example.com');
    await interfaceMiddleware(req);
    
    expect(NextResponse.rewrite).toHaveBeenCalledWith(
        expect.objectContaining({
            pathname: '/pearlos/some-page'
        }),
        expect.anything()
    );
  });

  it('should NOT redirect to niaxp.com when localhost even if PEARLOS_ONLY is false', async () => {
    process.env.PEARLOS_ONLY = 'false';
    (process.env as any).NODE_ENV = 'production'; // Simulate prod env locally? Or dev.
    
    const req = createRequest('/', 'localhost');
    await interfaceMiddleware(req);
    
    expect(NextResponse.rewrite).toHaveBeenCalledWith(
        expect.objectContaining({
            pathname: '/'
        })
    );
    expect(NextResponse.redirect).not.toHaveBeenCalled();
  });

  it('should respect existing assistant in path over PEARLOS_ONLY', async () => {
    process.env.PEARLOS_ONLY = 'true';
    
    const req = createRequest('/other/page', 'example.com');
    await interfaceMiddleware(req);
    
    expect(NextResponse.rewrite).toHaveBeenCalledWith(
        expect.objectContaining({
            pathname: '/pearlos/other/page'
        }),
        expect.anything()
    );
  });

  it('should NOT rewrite /share routes when PEARLOS_ONLY is true', async () => {
    process.env.PEARLOS_ONLY = 'true';
    
    const req = createRequest('/share/some-key', 'example.com');
    await interfaceMiddleware(req);
    
    expect(NextResponse.rewrite).toHaveBeenCalledWith(
        expect.objectContaining({
            pathname: '/share/some-key'
        }),
        expect.anything()
    );
  });
});
