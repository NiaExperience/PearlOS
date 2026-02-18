import { NextRequest } from 'next/server';

/**
 * Determines if authentication should be bypassed for local development.
 * 
 * This function provides a consistent way to check if auth should be disabled
 * across all apps (dashboard, interface, etc.) to avoid inconsistencies.
 * 
 * @param req - The Next.js request object (optional, for hostname checking)
 * @returns true if auth should be bypassed, false otherwise
 */
export function shouldDisableAuth(req?: NextRequest | { nextUrl?: { hostname?: string } }): boolean {
  // Check environment variable first (explicit override)
  if (process.env.DISABLE_DASHBOARD_AUTH === 'true') {
    return true;
  }

  // In development, also check if we're on localhost
  if (process.env.NODE_ENV === 'development') {
    // Check hostname from request if available
    const hostname = req?.nextUrl?.hostname || 
                     (typeof window !== 'undefined' ? window.location.hostname : null);
    
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return true;
    }

    // Fallback: check NEXTAUTH_URL
    if (process.env.NEXTAUTH_URL?.includes('localhost')) {
      return true;
    }
  }

  return false;
}

