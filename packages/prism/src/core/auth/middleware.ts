import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from 'next-auth/jwt';
import { getLogger } from '../logger';

const log = getLogger('prism:auth');

interface AuthMiddlewareConfig {
  publicRoutes?: string[];
  signInPath?: string;
  cookiePrefix?: string;
}

function buildLoginRedirect(request: NextRequest, signInPath: string, cookiePrefix: string) {
  try {
    const path = request.nextUrl.pathname;
    const cookieHeader = request.headers.get('cookie') || '';
    const sessionCookiePattern = process.env.NODE_ENV === "production"
      ? new RegExp(`__Secure-${cookiePrefix}\.session-token|${cookiePrefix}\.(session-token|callback-url)`)
      : new RegExp(`${cookiePrefix}\.(session-token|callback-url)`);
    const hasSessionCookie = sessionCookiePattern.test(cookieHeader);
    log.info('Auth middleware: no token in request', {
      path,
      hasSessionCookie,
      cookieLength: cookieHeader.length,
      cookiePrefix,
    });
  } catch (e) {
    // best-effort logging only
  }

  // Build a trusted absolute URL for redirects when behind proxies
  // Prefer the actual request host (via forwarded headers), then fall back to NEXTAUTH_URL, then request.url
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
  const headerBase = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
  const envBase = process.env.NEXTAUTH_URL || '';
  const base = headerBase || envBase || request.url;
  const loginUrl = new URL(signInPath, base);
  // Preserve original destination so app can send the user back after login
  try {
    const original = new URL(request.nextUrl.pathname + request.nextUrl.search, base).toString();
    loginUrl.searchParams.set('callbackUrl', original);
  } catch {}
  return NextResponse.redirect(loginUrl);
}

export function authMiddleware({
  publicRoutes = ['/auth', '/api/auth'],
  signInPath = '/login',
  cookiePrefix = 'next-auth',
}: AuthMiddlewareConfig = {}) {
  return async function middleware(request: NextRequest) {
    // CORS and preflight handling (always allow OPTIONS)
    if (request.method === 'OPTIONS') {
      const response = NextResponse.next();
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Origin', request.headers.get('origin') || '*');
      response.headers.set('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
      response.headers.set('Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
      return new NextResponse(null, { status: 200, headers: response.headers });
    }

    // Allow public routes
    const isPublic = publicRoutes.some((route) =>
      request.nextUrl.pathname === route || request.nextUrl.pathname.startsWith(route + '/')
    );
    if (isPublic) {
      return NextResponse.next();
    }

    // Check for session
    const token = await getToken({ 
      req: request as any, 
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: process.env.NODE_ENV === "production" 
        ? `__Secure-${cookiePrefix}.session-token` 
        : `${cookiePrefix}.session-token`
    });
    if (!token) {
      return buildLoginRedirect(request, signInPath, cookiePrefix);
    }

    return NextResponse.next();
  };
} 