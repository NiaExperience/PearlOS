import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { NextAuthOptions } from 'next-auth';

// Set the NEXTAUTH_URL for the interface
const defaultUrl = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_INTERFACE_URL || defaultUrl;

// Create auth options for interface with app-specific configuration
const authConfig = {
  appType: 'interface' as const,
  baseUrl: process.env.NEXTAUTH_INTERFACE_URL || defaultUrl,
  googleCredentials: {
    clientId: process.env.GOOGLE_INTERFACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_INTERFACE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET!,
  },
  cookiePrefix: 'interface-auth',
  pages: {
    signIn: '/login',
  },
  redirectHandler: (url: string, baseUrl: string) => {
    // Get interface base URL
    const interfaceUrl = process.env.NEXTAUTH_INTERFACE_URL || defaultUrl;
    const iface = new URL(interfaceUrl);
    
    try {
      // Normalize to an absolute URL for inspection
      const current = new URL(url, baseUrl);
      // If a callbackUrl is provided, prefer it (and keep it same-origin)
      const cb = current.searchParams.get('callbackUrl');
      if (cb) {
        const target = new URL(cb, interfaceUrl);
        if (target.origin === iface.origin) {
          return target.toString();
        }
      }
      // Avoid landing on raw auth pages; send to interface home when no callback provided
      if (current.pathname.includes('/auth/signin') || current.pathname === '/login') {
        return interfaceUrl;
      }
      // Same-origin safe redirect
      if (current.origin === iface.origin) {
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