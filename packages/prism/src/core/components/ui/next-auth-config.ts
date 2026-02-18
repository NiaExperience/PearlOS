import { getBaseUrl } from './utils';
import { getLogger } from '../../logger';

const logger = getLogger('prism:auth:next-auth-config');

// Declare __NEXTAUTH property on Window interface
declare global {
  interface Window {
    __NEXTAUTH?: {
      basePath?: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [key: string]: any;
    };
  }
}

// Configure NextAuth.js Client to use custom base path
if (typeof window !== 'undefined') {
  try {
    window.__NEXTAUTH = window.__NEXTAUTH || {};
    window.__NEXTAUTH.basePath = '/api/auth';
  } catch (error) {
    logger.error('Failed to configure NextAuth client', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const createAuthConfig = (port: number = 3000) => ({
  basePath: '/api/auth',
  baseUrl: getBaseUrl(port),
}); 