export { cn, getBaseUrl, handleError } from '@nia/prism/core/components/ui/utils';
import { NextRequest } from 'next/server';

/**
 * Check if we should bypass auth for local development
 */
export function shouldBypassAuth(req: NextRequest): boolean {
  const disableAuth = process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1') &&
    process.env.NODE_ENV !== 'production';
  return disableAuth;
}
