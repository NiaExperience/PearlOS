import { getServerSession, NextAuthOptions, Session } from "next-auth";
import { NextRequest } from "next/server";
import { SUPERADMIN_USER_ID } from "./auth.middleware";
import { getLogger } from "../logger";

const log = getLogger('prism:auth');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSessionSafely(req: NextRequest | undefined, authOptions?: NextAuthOptions) {
  // Hard override: allow forcing a superadmin session for profiling / tooling without creating a DB user
  if (process.env.FORCE_SUPERADMIN_SESSION === 'true') {
    return {
      user: {
        id: SUPERADMIN_USER_ID,
        is_anonymous: false,
        // inject plausible ancillary fields expected downstream
        sessionId: 'forced-superadmin-session',
        google_access_token: undefined,
        mustSetPassword: false,
        emailVerified: new Date().toISOString(),
      }
    } as unknown as Session;
  }
  // Check if we're in a test environment
  const isTest = process.env.NODE_ENV === 'test';

  if (isTest) {
    // For test / development, we'll extract info from the request headers or return a mock user
    const headerUserId = req?.headers?.get?.('x-test-user-id');
    if (process.env.TEST_REQUIRE_AUTH_HEADER === 'true' && !headerUserId) {
      return null; // Simulate unauthorized when explicit header required
    }
    // If headerUserId is explicitly empty string, treat as no user ID
    if (headerUserId === '') {
      return {
        user: {
          id: '',
          is_anonymous: req?.headers?.get?.('x-test-anonymous') === 'true',
          google_access_token: req?.headers?.get?.('x-test-google-access-token') || 'test-access-token',
        }
      };
    }
    return {
      user: {
        id: headerUserId || SUPERADMIN_USER_ID,
        is_anonymous: req?.headers?.get?.('x-test-anonymous') === 'true',
        google_access_token: req?.headers?.get?.('x-test-google-access-token') || 'test-access-token',
      }
    };
  }
  
  try {
    if (!authOptions) {
      // For server actions without request context, create default auth options
      log.error('No auth options provided to getSessionSafely');
      throw new Error('No auth options provided to getSessionSafely');
    }
    return await getServerSession(authOptions);
  } catch (error) {
    log.error('Error getting session', { error });
    return null;
  }
} 