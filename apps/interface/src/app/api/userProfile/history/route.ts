import { UserProfileActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getLogger, setLogContext } from '@interface/lib/logger';

const log = getLogger('[api_user_profile_history]');

/**
 * GET /api/userProfile/history
 * Retrieves recent session history for the current user
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const sessionId =
      'sessionId' in session.user && typeof session.user.sessionId === 'string'
        ? session.user.sessionId
        : session.user.id;
    setLogContext({
      sessionId: sessionId ?? undefined,
      userId: session.user.id ?? undefined,
      userName:
        'name' in session.user && typeof session.user.name === 'string'
          ? session.user.name
          : 'email' in session.user && typeof session.user.email === 'string'
            ? session.user.email
            : undefined,
      tag: '[api_user_profile_history]',
    });

    // Get count from query params, default to 5
    const { searchParams } = new URL(request.url);
    const count = parseInt(searchParams.get('count') || '5', 10);

    const history = await UserProfileActions.getRecentSessionHistory(
      session.user.id,
      count
    );

    return NextResponse.json({ history });
  } catch (error) {
    log.error('Failed to get session history', { error });
    return NextResponse.json(
      { error: 'Failed to retrieve session history' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/userProfile/history
 * Adds a new session history entry for the current user
 * 
 * Body: {
 *   action: string,
 *   refIds?: Array<{ type: string, id: string }>
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(undefined, interfaceAuthOptions);
    if (session?.user) {
      const sessionId =
        'sessionId' in session.user && typeof session.user.sessionId === 'string'
          ? session.user.sessionId
          : session.user.id;
      setLogContext({
        sessionId: sessionId ?? undefined,
        userId: session.user.id ?? undefined,
        userName:
          'name' in session.user && typeof session.user.name === 'string'
            ? session.user.name
            : 'email' in session.user && typeof session.user.email === 'string'
              ? session.user.email
              : undefined,
        tag: '[api_user_profile_history]',
      });
    }
    const { action, refIds } = await request.json();

    const result = await UserProfileActions.addSessionHistoryEntry(
      interfaceAuthOptions,
      action,
      refIds
    );
    if (result && result.action) {
      return NextResponse.json({ success: true });
    }
    return NextResponse.json(
      { error: 'Failed to add session history entry' },
      { status: 500 }
    );
  } catch (error) {
    log.error('Failed to add session history entry', { error });
    return NextResponse.json(
      { error: 'Failed to add session history entry' },
      { status: 500 }
    );
  }
}
