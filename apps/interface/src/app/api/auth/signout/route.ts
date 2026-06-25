import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_auth_signout]');

const COOKIE_BASE_NAMES = [
  'session-token',
  'csrf-token',
  'callback-url',
  'pkce.code_verifier',
  'state',
  'nonce',
];

const COOKIE_PREFIXES = [
  'interface-auth.',
  '__Secure-interface-auth.',
  '__Host-interface-auth.',
  'next-auth.',
  '__Secure-next-auth.',
  '__Host-next-auth.',
];

const KNOWN_COOKIE_STARTS = [
  ...COOKIE_PREFIXES,
  'authjs.',
];

function buildAllCookieNames(): string[] {
  const names: string[] = [];
  for (const p of COOKIE_PREFIXES) {
    for (const b of COOKIE_BASE_NAMES) {
      names.push(`${p}${b}`);
    }
  }
  return names;
}

/**
 * Appends raw Set-Cookie headers to nuke a cookie at both Path=/ and Path=/api/auth.
 *
 * We cannot use the Next.js response.cookies API here because it deduplicates
 * by cookie name: setting the same name twice (with different paths) causes the
 * second call to overwrite the first. That left the Path=/ cookie alive, which
 * is exactly the bug we are fixing.
 */
function appendDeleteHeaders(response: NextResponse, name: string) {
  const expired = 'Thu, 01 Jan 1970 00:00:00 GMT';
  // __Secure- and __Host- prefixed cookies REQUIRE the Secure attribute
  // or the browser silently ignores the Set-Cookie header.
  const needsSecure = name.startsWith('__Secure-') || name.startsWith('__Host-');
  const secureSuffix = needsSecure ? '; Secure' : '';
  response.headers.append(
    'Set-Cookie',
    `${name}=; Path=/; Expires=${expired}; Max-Age=0; HttpOnly; SameSite=Lax${secureSuffix}`,
  );
  response.headers.append(
    'Set-Cookie',
    `${name}=; Path=/api/auth; Expires=${expired}; Max-Age=0; HttpOnly; SameSite=Lax${secureSuffix}`,
  );
}

function clearAllAuthCookies(response: NextResponse, request: NextRequest) {
  const names = new Set(buildAllCookieNames());

  try {
    const incoming = request.cookies.getAll?.() ?? [];
    for (const c of incoming) {
      if (KNOWN_COOKIE_STARTS.some((p) => c.name.startsWith(p))) {
        names.add(c.name);
      }
    }
  } catch {
    // best-effort
  }

  for (const name of names) {
    appendDeleteHeaders(response, name);
  }
}

function resolveRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = forwardedProto || request.nextUrl.protocol.replace(':', '') || 'https';
    return `${proto}://${forwardedHost}`;
  }
  return request.nextUrl.origin;
}

function resolveAllowedOrigins(request: NextRequest): Set<string> {
  const allowed = new Set<string>();
  const candidates = [
    process.env.NEXTAUTH_INTERFACE_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_INTERFACE_URL,
    resolveRequestOrigin(request),
  ].filter(Boolean) as string[];

  for (const value of candidates) {
    try {
      allowed.add(new URL(value).origin);
    } catch {
      // ignore malformed values
    }
  }
  return allowed;
}

function resolveCallbackUrl(request: NextRequest): string {
  try {
    const url = new URL(request.url);
    const cb = url.searchParams.get('callbackUrl');
    if (!cb) return '/login';

    // Allow relative callback paths directly.
    if (cb.startsWith('/')) {
      return cb;
    }

    const allowedOrigins = resolveAllowedOrigins(request);
    const verified = new URL(cb);
    if (allowedOrigins.has(verified.origin)) {
      return verified.pathname + verified.search + verified.hash;
    }
  } catch { /* ignore */ }
  return '/login';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);

    if (process.env.NODE_ENV !== 'production' && session?.user) {
      log.info('User signed out (non-production)', {
        userId: session.user.id,
        isAnonymous: session.user.is_anonymous,
      });
    }

    const redirectUrl = resolveCallbackUrl(request);

    const response = NextResponse.json({ success: true, redirect: redirectUrl }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });

    clearAllAuthCookies(response, request);

    return response;
  } catch (error) {
    log.error('Error during sign-out', { error });
    return NextResponse.json({ success: false, error: 'Signout error', redirect: '/login' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const redirectUrl = resolveCallbackUrl(request);
    const response = NextResponse.redirect(new URL(redirectUrl, resolveRequestOrigin(request)));

    clearAllAuthCookies(response, request);

    return response;
  } catch (error) {
    log.error('Error during sign-out (GET)', { error });
    return NextResponse.redirect(new URL('/login', resolveRequestOrigin(request)));
  }
}