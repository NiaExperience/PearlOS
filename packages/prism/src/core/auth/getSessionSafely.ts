import { getServerSession, NextAuthOptions, Session } from "next-auth";
import { NextRequest } from "next/server";
import { SUPERADMIN_USER_ID } from "./auth.middleware";
import { getLogger } from "../logger";

const log = getLogger('prism:auth');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getSessionSafely(req: NextRequest | undefined, authOptions?: NextAuthOptions) {
  // Hard override: allow forcing a superadmin session for profiling / tooling without creating a DB user
  // 🔒 MULTITENANCY GATE: requires secondary env var AND blocked in production
  if (process.env.FORCE_SUPERADMIN_SESSION === 'true') {
    if (process.env.NODE_ENV === 'production') {
      const msg = 'FORCE_SUPERADMIN_SESSION is forbidden in production';
      log.error(msg);
      throw new Error(msg);
    }
    if (process.env.PEARL_ALLOW_SUPERADMIN_BYPASS !== '1') {
      const msg = 'FORCE_SUPERADMIN_SESSION requires PEARL_ALLOW_SUPERADMIN_BYPASS=1';
      log.error(msg);
      throw new Error(msg);
    }
    log.warn('FORCE_SUPERADMIN_SESSION active — all requests authenticated as superadmin');
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
    const session = await getServerSession(authOptions);
    // Hard guard: a session is only valid when it carries an authenticated user id.
    // next-auth can return half-formed session objects (e.g. `{ user: {} }` or
    // `{ expires: ... }` with no user) in some edge cases; treat those as
    // unauthenticated so callers that do `if (!session)` still redirect to /login.
    if (!session || !session.user || !(session.user as { id?: string }).id) {
      return null;
    }
    return session;
  } catch (error) {
    log.error('Error getting session', { error });
    return null;
  }
} 