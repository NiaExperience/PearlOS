import { authMiddleware } from '@nia/prism/core/auth/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
// Always import from the app's own next/server

const adminPaths = ['/secret', '/dashboard/users'];
const publicRoutes = ['/', '/login', '/api/auth', '/unauthorized', '/auth/(.*)', '/api/google/(.*)','/api/google/auth/(.*)', '/health'];

const middleware = authMiddleware({
  publicRoutes,
  signInPath: '/login',
  cookiePrefix: 'dashboard-auth',
});

export default async function dashboardMiddleware(request: NextRequest): Promise<NextResponse | Response | void> {
  // Skip auth for local development if DISABLE_DASHBOARD_AUTH is set
  // Check both env var and hostname for localhost
  const disableAuth = 
    process.env.DISABLE_DASHBOARD_AUTH === 'true' || 
    (process.env.NODE_ENV === 'development' && 
     (request.nextUrl.hostname === 'localhost' || 
      request.nextUrl.hostname === '127.0.0.1' ||
       request.nextUrl.hostname.includes('runpod.net') ||
      process.env.NEXTAUTH_URL?.includes('localhost')));
  
  if (disableAuth) {
    console.log('🔓 Dashboard auth disabled for local development');
    // If trying to access /login, redirect to /dashboard instead
    if (request.nextUrl.pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', request.nextUrl));
    }
    const enrichedHeaders = new Headers(request.headers);
    if (!enrichedHeaders.get('x-forwarded-host')) {
      enrichedHeaders.set('x-forwarded-host', request.nextUrl.host);
    }
    if (!enrichedHeaders.get('x-forwarded-proto')) {
      enrichedHeaders.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
    }
    return NextResponse.next({ request: { headers: enrichedHeaders } });
  }

  // Ensure forwarded headers are present for downstream (NextAuth, URL building)
  const enrichedHeaders = new Headers(request.headers);
  if (!enrichedHeaders.get('x-forwarded-host')) {
    enrichedHeaders.set('x-forwarded-host', request.nextUrl.host);
  }
  if (!enrichedHeaders.get('x-forwarded-proto')) {
    enrichedHeaders.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
  }

  // Run shared session enforcement with a properly constructed NextRequest
  const forwardedReq = new NextRequest(request.url, { headers: enrichedHeaders });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseResult = await middleware(forwardedReq as any);
  console.log('🔍 Dashboard middleware - result:', baseResult?.status, baseResult?.headers?.get('location'));

  // If auth middleware returned a redirect (e.g., to login), return NextResponse.redirect with the correct location
  if (baseResult && (baseResult.status === 302 || baseResult.status === 307 || baseResult.status === 308)) {
    const location = baseResult.headers?.get('location');
    // Fix: Ensure NextResponse.redirect uses a URL object, not a string, and base on trusted origin
    if (location) {
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const headerBase = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
  const envBase = process.env.NEXTAUTH_URL || '';
  const base = headerBase || envBase || request.url;
      return NextResponse.redirect(new URL(location, base), { status: baseResult.status });
    }
  }

  if (baseResult && baseResult.status !== 200) {
    return baseResult;
  }

  const path = request.nextUrl.pathname;
  const token = await getToken({ 
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req: request as any, 
    secret: process.env.NEXTAUTH_SECRET,
    cookieName: process.env.NODE_ENV === "production" 
      ? `__Secure-dashboard-auth.session-token` 
      : `dashboard-auth.session-token`
  });

  // If token is missing (expired/invalid), only redirect to login if not already on a public route
  if (!token) {
    try {
      const cookieHeader = request.headers.get('cookie') || '';
      const sessionCookiePattern = process.env.NODE_ENV === "production"
        ? /(__Secure-dashboard-auth\.session-token|dashboard-auth\.(session-token|callback-url))/
        : /dashboard-auth\.(session-token|callback-url)/;
      const hasSessionCookie = sessionCookiePattern.test(cookieHeader);
      console.log('🔐 [dashboardMiddleware] No token for path', path, { hasSessionCookie, cookieLength: cookieHeader.length });
    } catch {
      // ignore
    }
    if (publicRoutes.includes(path)) {
      // Allow access to public routes even if not authenticated
      return NextResponse.next({ request: { headers: enrichedHeaders } });
    }
    const response = NextResponse.redirect(new URL('/login', request.nextUrl));
    const cookieNames = [
      'dashboard-auth.session-token',
      '__Secure-dashboard-auth.session-token',
      'dashboard-auth.callback-url',
      '__Secure-dashboard-auth.callback-url',
      'dashboard-auth.csrf-token',
      '__Secure-dashboard-auth.csrf-token',
      'dashboard-auth.pkce.code_verifier',
      '__Secure-dashboard-auth.pkce.code_verifier',
      'dashboard-auth.state',
      '__Secure-dashboard-auth.state',
      'dashboard-auth.nonce',
      '__Secure-dashboard-auth.nonce',
    ];
    cookieNames.forEach(cookieName => {
      response.cookies.set(cookieName, '', { maxAge: 0, expires: new Date(0), path: '/' });
    });
    return response;
  }

  // If token is anonymous, sign out and redirect to login
  if (token.is_anonymous) {
    const response = NextResponse.redirect(new URL('/login', request.nextUrl));
    const cookieNames = [
      'dashboard-auth.session-token',
      '__Secure-dashboard-auth.session-token',
      'dashboard-auth.callback-url',
      '__Secure-dashboard-auth.callback-url',
      'dashboard-auth.csrf-token',
      '__Secure-dashboard-auth.csrf-token',
      'dashboard-auth.pkce.code_verifier',
      '__Secure-dashboard-auth.pkce.code_verifier',
      'dashboard-auth.state',
      '__Secure-dashboard-auth.state',
      'dashboard-auth.nonce',
      '__Secure-dashboard-auth.nonce',
    ];
    cookieNames.forEach(cookieName => {
      response.cookies.set(cookieName, '', { maxAge: 0, expires: new Date(0), path: '/' });
    });
    return response;
  }

  // If user is authenticated and trying to access /login, redirect to dashboard
  if (path === '/login' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl));
  }

  // Block anonymous users from dashboard
  if (token?.is_anonymous) {
    return NextResponse.redirect(new URL('/unauthorized', request.nextUrl));
  }

  // For admin paths, check if user has admin access to any tenant
  if (adminPaths.includes(path)) {
    try {
      const baseUrl = request.nextUrl.origin;
      const rolesResponse = await fetch(`${baseUrl}/api/users/me/tenant-roles`, {
        headers: {
          'Cookie': request.headers.get('cookie') || '',
        },
      });
      if (rolesResponse.ok) {
        const data = await rolesResponse.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const hasAdminAccess = data.roles?.some((role: any) => 
          role.role === 'admin' || role.role === 'owner'
        ) || false;
        if (!hasAdminAccess) {
          return NextResponse.redirect(new URL('/unauthorized', request.nextUrl));
        }
      } else {
        return NextResponse.redirect(new URL('/unauthorized', request.nextUrl));
      }
    } catch (error) {
      return NextResponse.redirect(new URL('/unauthorized', request.nextUrl));
    }
  }

  // Redirect root to dashboard only if user is authenticated
  if (path === '/' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.nextUrl));
  }

  return NextResponse.next({ request: { headers: enrichedHeaders } });
}

export const config = {
  matcher: ['/', '/login', '/dashboard', '/dashboard/tools-marketplace', '/dashboard/tools', '/secret', '/dashboard/users', '/unauthorized'],
};
