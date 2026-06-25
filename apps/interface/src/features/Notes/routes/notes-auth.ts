import type { NextRequest } from 'next/server';

import { getSessionSafely } from '@nia/prism/core/auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

/**
 * Notes API auth helper.
 *
 * In local dev / test mode we sometimes render assistant pages with a mock session,
 * but API routes still need a user context to function. For Notes routes only,
 * we allow a safe fallback test session when explicitly in test mode.
 *
 * SECURITY: Fallback is disabled in production unconditionally.
 */

type SessionLike = Awaited<ReturnType<typeof getSessionSafely>>;

const TEST_FALLBACK_USER_ID = '00000000-0000-0000-0000-000000000099';

function isNotesTestMode(request: NextRequest): boolean {
  // Never allow fallback in production
  if (process.env.NODE_ENV === 'production') return false;

  // REMOVED — security: test mode bypass disabled by Blair 2026-04-27
  return false;
}

export async function getNotesSession(request: NextRequest): Promise<SessionLike> {
  try {
    const session = await getSessionSafely(request, interfaceAuthOptions);
    if (session?.user?.id) return session;
  } catch {
    // fall through to test fallback
  }

  if (!isNotesTestMode(request)) return null;

  // Fall back to a stable UUID so downstream content writes pass UUID validation.
  return {
    user: {
      id: TEST_FALLBACK_USER_ID,
      name: 'Test Guest',
      email: null,
      image: null,
      is_anonymous: true,
      sessionId: 'test-session',
    } as any,
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  } as any;
}

