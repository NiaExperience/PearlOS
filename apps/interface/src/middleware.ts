import { authMiddleware } from '@nia/prism/core/auth/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { getClientLogger } from '@interface/lib/client-logger';

const PUBLIC_ROUTES = [
  '/login',
  '/signup',
  // Accept invite flow (and its subpaths like /accept-invite/google-complete)
  '/accept-invite',
  // Health check endpoints
  '/health',
  // NextAuth endpoints
  '/api/auth',
  '/auth',
  // E2E test harness
  '/__tests-e2e__',
  // Shared resources
  '/share',
  // Recovery shell must stay reachable when the main app is failing
  '/recovery',
  // Public compliance / consent pages
  '/privacy-policy',
  '/sms-opt-in',
  // SMS webhook (Vonage inbound)
  '/api/sms',
  // Native Agency room view
  '/the-agency',
  // Native Council room view
  '/council',
];

const middleware = authMiddleware({
  // Note: authMiddleware treats entries as exact path or prefix (startsWith(route + '/')).
  // Do NOT use regex-like patterns here.
  publicRoutes: PUBLIC_ROUTES,
  signInPath: '/login',
  cookiePrefix: 'interface-auth',
});

function getAssistantFromPath(pathname: string): string | null {
  const [assistant] = pathname.split("/").filter(Boolean);
  return assistant ?? null;
}

// REMOVED — security: test mode bypass disabled by Blair 2026-04-27
// Auth must always be enforced in production. This function previously
// allowed TEST_MODE env vars or X-Test-Mode headers to bypass auth.
// function isTestMode(request: NextRequest): boolean { ... }
function isTestMode(_request: NextRequest): boolean {
  return false;
}

function isPearlosOnlyEnabled(): boolean {
  return (process.env.PEARLOS_ONLY ?? '').toLowerCase() === 'true';
}

export default async function interfaceMiddleware(request: NextRequest): Promise<NextResponse> {
  const log = getClientLogger('Middleware');

  // Force no-cache on all HTML page responses to prevent CDN stale content
  // This overrides Next.js's internal s-maxage for static pages
  const noCacheHeaders = {
    'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
    'CDN-Cache-Control': 'no-store',
    'Surrogate-Control': 'no-store',
    'Pragma': 'no-cache',
    'Expires': '0',
  };

  // Ensure forwarded headers are present
  const newRequestHeaders = new Headers(request.headers);
  if (!newRequestHeaders.get('x-forwarded-host')) {
    newRequestHeaders.set('x-forwarded-host', request.nextUrl.host);
  }
  if (!newRequestHeaders.get('x-forwarded-proto')) {
    newRequestHeaders.set('x-forwarded-proto', request.nextUrl.protocol.replace(':', ''));
  }
  // Handle test routes at the very top
  if (request.nextUrl.pathname.startsWith('/__tests-e2e__/') || request.nextUrl.pathname.startsWith('/test-e2e/')) {
    if (isTestMode(request)) {
      const testHeaders = new Headers(newRequestHeaders);
      newRequestHeaders.set('X-Test-Mode', 'true');
      if (process.env.NODE_ENV !== 'production') {
        log.info('Test mode: Serving test route directly');
      }
      return NextResponse.next({ request: { headers: testHeaders } });
    } else {
      const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
      const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
      const headerBase = forwardedHost ? `${forwardedProto}://${forwardedHost}` : '';
      const envBase = process.env.NEXTAUTH_URL || '';
      const base: string | URL = headerBase || envBase || request.nextUrl;
      return NextResponse.redirect(new URL('/login', base));
    }
  }

  // Determine language from 'Accept-Language' header
  const acceptLanguageHeader = request.headers.get("accept-language");
  let clientLanguage = 'en'; // Default to English
  const supportedLanguages = ['en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl'];

  if (acceptLanguageHeader) {
    try {
      const languages = acceptLanguageHeader.split(',');
      for (const langEntry of languages) {
        const langTag = langEntry.split(';')[0].trim();
        if (langTag) {
          const primaryLang = langTag.split('-')[0].toLowerCase();
          if (supportedLanguages.includes(primaryLang)) {
            clientLanguage = primaryLang;
            break;
          }
        }
      }
    } catch (error) {
      log.error('Error parsing Accept-Language header', { acceptLanguageHeader, error });
    }
  }
  // 🌐 Language detection
  if (process.env.NODE_ENV !== 'production') {
    log.debug('Determined Client Language', { clientLanguage });
  }

  newRequestHeaders.set('X-Client-Language', clientLanguage);

  // Skip public files and next internal routes
  const PUBLIC_FILE = /\.(.*)$/;
  if (
    PUBLIC_FILE.test(request.nextUrl.pathname) ||
    request.nextUrl.pathname.startsWith("/_next/") ||
    request.nextUrl.pathname.startsWith("/static/")
  ) {
    return NextResponse.next();
  }

  const originalPath = request.nextUrl.pathname;
  if (
    originalPath === '/pearls-house' ||
    originalPath.startsWith('/pearls-house/') ||
    originalPath === '/star-office' ||
    originalPath.startsWith('/star-office/')
  ) {
    return new NextResponse('Gone', {
      status: 410,
      headers: noCacheHeaders,
    });
  }

  const pearlosOnly = isPearlosOnlyEnabled();

  const isGlobalRoute = pearlosOnly && PUBLIC_ROUTES.some(route => {
    if (route === '/') return false;
    return originalPath === route || originalPath.startsWith(route + '/');
  });

  let assistant: string | null;
  let withoutAssistant: string;

  if (pearlosOnly && !isGlobalRoute) {
    assistant = 'pearlos';
    withoutAssistant =
      originalPath === '/' ? '' :
      originalPath === '/pearlos' ? '' :
      originalPath.startsWith('/pearlos/') ? originalPath.slice('/pearlos'.length) :
      originalPath;
  } else {
    const assistantFromPath = getAssistantFromPath(originalPath);
    assistant = assistantFromPath ?? (pearlosOnly ? 'pearlos' : null);
    withoutAssistant = originalPath.replace(/^\/[^/]+/, "") || "/";
  }

  if (!assistant) {
    // If running locally, serve the local home page instead of redirecting to niacxp.com
    if (request.nextUrl.hostname === 'localhost' || request.nextUrl.hostname === '127.0.0.1') {
      // Serve the local root page
      return NextResponse.rewrite(new URL('/', request.nextUrl));
    } else {
      // In production, redirect to niacxp.com
      return NextResponse.redirect(new URL("https://www.niaxp.com", request.nextUrl));
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${assistant}${withoutAssistant}`;              // idempotent rewrite
  if (process.env.NODE_ENV !== 'production') {
    log.debug('Rewriting assistant path', { originalPath, rewrittenPath: url.pathname });
  }

  // In test mode, bypass authentication for assistant pages
  if (isTestMode(request) && assistant) {
    if (process.env.NODE_ENV !== 'production') {
      log.info('Test mode: Bypassing authentication for assistant page', { assistant });
    }
    // Add test headers to indicate this is a test session
    newRequestHeaders.set('X-Test-Mode', 'true');
    newRequestHeaders.set('X-Test-Assistant', assistant);
    return NextResponse.rewrite(url, { request: { headers: newRequestHeaders } });
  }

  // Call shared auth middleware for auth/public route handling with enriched forwarded headers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await middleware(new NextRequest(request.url, { headers: newRequestHeaders }) as any);
  if (process.env.NODE_ENV !== 'production') {
    log.debug('Interface middleware result', { status: result?.status, location: result?.headers?.get('location') });
  }

  // If auth middleware returned a redirect (e.g., to login), preserve it as-is.
  // DO NOT clear cookies here — the auth middleware / login page manages cookie lifecycle.
  // Aggressive cookie clearing was breaking NextAuth CSRF flow: the middleware would
  // nuke the CSRF token cookie on every redirect, making the login page unable to
  // complete the sign-in handshake.
  //
  // Stale cookie cleanup (if needed) should happen client-side after a successful
  // sign-out, not server-side on redirect to the login page.
  if (result && (result.status === 302 || result.status === 307 || result.status === 308)) {
    return result;
  }
  // Otherwise, proceed with the rewrite
  const response = NextResponse.rewrite(url, { request: { headers: newRequestHeaders } });
  // Apply no-cache headers to prevent CDN from caching stale HTML
  Object.entries(noCacheHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images (public images)
     * - __tests-e2e__ (test routes)
     * - test-e2e (test routes)
     */
    '/((?!api|bot-api|gateway|gateway-ws|_next/static|_next/image|favicon.ico|images|__tests-e2e__|test-e2e).*)',
  ],
};
