import {
  createAuthOptions,
  parseGoogleSignInAllowlistEnabledEnv,
  parseGoogleSignInAllowlistEnv,
} from '@nia/prism/core/auth/authOptions';
import { NextAuthOptions } from 'next-auth';

const isProduction = process.env.NODE_ENV === 'production';

function tryGetOrigin(urlLike?: string): string | null {
  if (!urlLike) return null;
  try {
    return new URL(urlLike).origin;
  } catch {
    return null;
  }
}

function resolveInterfaceUrl(): string {
  // Prefer stable interface URLs only.
  const configured =
    process.env.NEXT_PUBLIC_INTERFACE_URL ||
    process.env.NEXTAUTH_INTERFACE_URL ||
    process.env.NEXTAUTH_URL;

  if (configured) return configured;

  if (!isProduction) return 'http://localhost:3000';

  throw new Error(
    'Missing interface base URL configuration. Set NEXTAUTH_INTERFACE_URL (or NEXTAUTH_URL) in production.',
  );
}

function isUnsafePostLoginPath(pathname: string): boolean {
  const firstSegment = pathname.split('/').filter(Boolean)[0] || '';
  return [
    'login',
    'signup',
    'accept-invite',
    'reset-password',
    'recovery',
    'health',
    'api',
    'auth',
  ].includes(firstSegment);
}

// Set the NEXTAUTH_URL for the interface.
// Keep this stable in production.
const defaultUrl = resolveInterfaceUrl();
process.env.NEXTAUTH_URL =
  process.env.NEXT_PUBLIC_INTERFACE_URL ||
  process.env.NEXTAUTH_INTERFACE_URL ||
  process.env.NEXTAUTH_URL ||
  defaultUrl;

// Create auth options for interface with app-specific configuration
const authConfig = {
  appType: 'interface' as const,
  baseUrl: process.env.NEXTAUTH_INTERFACE_URL || defaultUrl,
  googleCredentials: {
    clientId: process.env.GOOGLE_INTERFACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_INTERFACE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET!,
  },
  enableCredentialsProvider: process.env.ENABLE_CREDENTIALS_AUTH === 'true',
  cookiePrefix: 'interface-auth',
  // Optional: when set, only these emails can use Google sign-in. Matches GCP test users manually; not read from Google.
  googleSignInAllowlistEmails: parseGoogleSignInAllowlistEnv(process.env.GOOGLE_SIGNIN_ALLOWLIST),
  googleSignInAllowlistEnabled: parseGoogleSignInAllowlistEnabledEnv(
    process.env.GOOGLE_SIGNIN_ALLOWLIST_ENABLED,
  ),
  pages: {
    signIn: '/login',
  },
  redirectHandler: (url: string, baseUrl: string) => {
    // Prefer runtime request origin, then stable configured origin.
    const runtimeOrigin = tryGetOrigin(baseUrl);
    const configuredOrigin =
      tryGetOrigin(process.env.NEXT_PUBLIC_INTERFACE_URL) ||
      tryGetOrigin(process.env.NEXTAUTH_INTERFACE_URL) ||
      tryGetOrigin(process.env.NEXTAUTH_URL) ||
      tryGetOrigin(defaultUrl);
    const effectiveOrigin = runtimeOrigin || configuredOrigin || 'http://localhost:3000';
    const interfaceUrl = `${effectiveOrigin}/`;
    
    try {
      // Normalize to an absolute URL for inspection
      const current = new URL(url, interfaceUrl);
      // If a callbackUrl is provided, prefer it (and keep it same-origin)
      const cb = current.searchParams.get('callbackUrl');
      if (cb) {
        const target = new URL(cb, interfaceUrl);
        if (target.origin === effectiveOrigin && !isUnsafePostLoginPath(target.pathname)) {
          return target.toString();
        }
      }
      // Avoid landing on raw auth pages; send to interface home when no callback provided
      if (current.pathname.includes('/auth/signin') || isUnsafePostLoginPath(current.pathname)) {
        return interfaceUrl;
      }
      // Same-origin safe redirect
      if (current.origin === effectiveOrigin && !isUnsafePostLoginPath(current.pathname)) {
        return current.toString();
      }
    } catch {
      // fall through to default
    }
    // Default: go home on interface
    return interfaceUrl;
  }
};

const baseAuthOptions = createAuthOptions(authConfig);

// Interface-specific auth configuration
export const interfaceAuthOptions: NextAuthOptions = {
  ...baseAuthOptions,
}; 
