import { getSessionSafely } from '@nia/prism/core/auth';
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';
import { NextAuthOptions } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../logger';

const log = getLogger('prism:auth:incremental');

/**
 * API route to handle token refresh requests
 * POST /api/google/refresh-token
 */
export async function POST_impl(request: NextRequest, authOptions: NextAuthOptions) {
  try {
    const rawSession = await getSessionSafely(request, authOptions);
    const session = rawSession && !(rawSession as any).expires
      ? { ...(rawSession as any), expires: new Date(Date.now() + 3600_000).toISOString() }
      : rawSession;

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    log.info('Token refresh request', { userId: session.user.id });

    // Get the incremental auth service for handling OAuth operations
    const authService = createIncrementalAuthService('interface', session);

    // Attempt to refresh the access token
    const refreshResult = await authService.refreshAccessToken(session.user.id, 'google');

    if (!refreshResult.success) {
      log.error('Token refresh failed', { error: refreshResult.error, userId: session.user.id });
      return NextResponse.json(
        {
          error: 'Failed to refresh token',
          details: refreshResult.error
        },
        { status: 401 }
      );
    }

    log.info('Token refresh successful', { userId: session.user.id });

    // We need to tell the client to reload the session to get the new access token
    const response = NextResponse.json({
      success: true,
      message: 'Token refreshed successfully',
      tokenExpiry: refreshResult.newTokens?.expires_at ?
        new Date(refreshResult.newTokens.expires_at * 1000).toISOString() :
        undefined,
      reloadSession: true
    });

    return response;

  } catch (error) {
    log.error('Error in token refresh request', { error });

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to refresh token',
          details: error.message
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
