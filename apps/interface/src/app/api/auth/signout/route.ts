import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_auth_signout]');

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);

    if (process.env.NODE_ENV !== 'production' && session?.user) {
      log.info('User signed out (non-production)', {
        userId: session.user.id,
        isAnonymous: session.user.is_anonymous,
      });
    }

    // Try to honor a provided callbackUrl (prefer same-origin)
    let redirectUrl = '/login';
    try {
      const base = process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || '';
      const url = new URL(request.url);
      const cb = url.searchParams.get('callbackUrl');
      if (cb && base) {
        const verified = new URL(cb, base);
        const baseUrl = new URL(base);
        if (verified.origin === baseUrl.origin) {
          redirectUrl = verified.pathname + verified.search + verified.hash;
        }
      }
    } catch { /* ignore */ }

    // Helper to clear cookies on a response object
    const clearCookies = (res: NextResponse) => {
      // Clear all NextAuth cookies comprehensively
      // Include __Secure- and __Host- variants and conservative fallbacks to next-auth.*
      const baseNames = [
        'session-token',
        'csrf-token',
        'callback-url',
        'pkce.code_verifier',
        'state',
        'nonce',
      ];
      const prefixes = [
        'interface-auth.',
        '__Secure-interface-auth.',
        '__Host-interface-auth.',
        // fallbacks in case defaults were used at any point
        'next-auth.',
        '__Secure-next-auth.',
        '__Host-next-auth.',
      ];

      const names: string[] = [];
      prefixes.forEach((p) => {
        baseNames.forEach((b) => names.push(`${p}${b}`));
      });

      // Delete for both '/' and '/api/auth' paths to cover PKCE/state cookies
      const deleteCookieEverywhere = (name: string) => {
        // default path '/'
        res.cookies.delete(name);
        // explicit '/api/auth' path
        res.cookies.set(name, '', {
          value: '',
          maxAge: 0,
          expires: new Date(0),
          path: '/api/auth',
        });
      };

      names.forEach(deleteCookieEverywhere);

      // Additionally, remove any chunked cookies (e.g., ".0", ".1") or unexpected variants
      // by inspecting incoming request cookies and deleting anything starting with known prefixes.
      const knownStarts = [
        'interface-auth.',
        '__Secure-interface-auth.',
        '__Host-interface-auth.',
        'next-auth.',
        '__Secure-next-auth.',
        '__Host-next-auth.',
        // Future-proofing for Auth.js v5 naming
        'authjs.'
      ];
      try {
        const incoming = request.cookies.getAll?.() ?? [];
        for (const c of incoming) {
          if (knownStarts.some((p) => c.name.startsWith(p))) {
            deleteCookieEverywhere(c.name);
          }
        }
      } catch {
        // best-effort cleanup only
      }
    };

    // Create response that clears the session and always returns JSON
    const response = NextResponse.json({ success: true, redirect: redirectUrl }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    });
    
    clearCookies(response);

    return response;
  } catch (error) {
    log.error('Error during sign-out', { error });
    return NextResponse.json({ success: false, error: 'Signout error', redirect: '/login' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Handle GET requests by redirecting to login (or callbackUrl) instead of returning JSON
  // This allows server-side redirects to this route to effectively log the user out and send them to login.
  try {
    let redirectUrl = '/login';
    try {
      const base = process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || '';
      const url = new URL(request.url);
      const cb = url.searchParams.get('callbackUrl');
      if (cb && base) {
        const verified = new URL(cb, base);
        const baseUrl = new URL(base);
        if (verified.origin === baseUrl.origin) {
          redirectUrl = verified.pathname + verified.search + verified.hash;
        }
      }
    } catch { /* ignore */ }

    const publicBase = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_API_URL || request.url;
    const response = NextResponse.redirect(new URL(redirectUrl, publicBase));
    
    // Duplicate cookie clearing logic for GET (since we can't easily share the inner function without refactoring the whole file)
    // Ideally this should be a shared utility, but for now we inline it to match POST behavior.
    const clearCookies = (res: NextResponse) => {
      const baseNames = ['session-token', 'csrf-token', 'callback-url', 'pkce.code_verifier', 'state', 'nonce'];
      const prefixes = ['interface-auth.', '__Secure-interface-auth.', '__Host-interface-auth.', 'next-auth.', '__Secure-next-auth.', '__Host-next-auth.'];
      const names: string[] = [];
      prefixes.forEach((p) => baseNames.forEach((b) => names.push(`${p}${b}`)));
      const deleteCookieEverywhere = (name: string) => {
        res.cookies.delete(name);
        res.cookies.set(name, '', { value: '', maxAge: 0, expires: new Date(0), path: '/api/auth' });
      };
      names.forEach(deleteCookieEverywhere);
      const knownStarts = ['interface-auth.', '__Secure-interface-auth.', '__Host-interface-auth.', 'next-auth.', '__Secure-next-auth.', '__Host-next-auth.', 'authjs.'];
      try {
        const incoming = request.cookies.getAll?.() ?? [];
        for (const c of incoming) {
          if (knownStarts.some((p) => c.name.startsWith(p))) deleteCookieEverywhere(c.name);
        }
      } catch { /* best-effort */ }
    };

    clearCookies(response);
    return response;
  } catch (error) {
    log.error('Error during sign-out (GET)', { error });
    const publicBase = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_API_URL || request.url;
    return NextResponse.redirect(new URL('/login', publicBase));
  }
}