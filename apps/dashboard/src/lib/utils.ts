export { cn, getBaseUrl, handleError } from '@nia/prism/core/components/ui/utils';
import { NextRequest } from 'next/server';

/**
 * Check if we should bypass auth for local development
 */
export function shouldBypassAuth(_req: NextRequest): boolean {
  return process.env.DISABLE_DASHBOARD_AUTH === 'true';
}
