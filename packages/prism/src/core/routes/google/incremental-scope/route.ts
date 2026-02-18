import { getSessionSafely } from '@nia/prism/core/auth';
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';
import { NextAuthOptions } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../logger';

const log = getLogger('prism:auth:incremental');

/**
 * API route to handle incremental authorization requests
 * POST /api/google/incremental-scope
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

    const body = await request.json();
    const { scopes, reason } = body;

    if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
      return NextResponse.json(
        { error: 'Invalid scopes provided' },
        { status: 400 }
      );
    }

    log.info('Incremental auth request', {
      userId: session.user.id,
      scopes,
      reason,
    });

    const authService = createIncrementalAuthService('interface', session);

    // Convert scopes to ScopeRequest format
    const scopeRequests = scopes.map((scope: string) => ({
      scope,
      reason: reason || 'Additional permissions required',
      required: true
    }));

    const authResult = await authService.requestScopes(
      session.user.id,
      scopeRequests
    );

    log.info('Generated auth URL for incremental scopes', { userId: session.user.id, state: authResult.state });

    return NextResponse.json({
      success: true,
      authUrl: authResult.authUrl,
      state: authResult.state
    });

  } catch (error) {
    log.error('Error in incremental auth request', { error });

    if (error instanceof Error) {
      return NextResponse.json(
        {
          error: 'Failed to generate authorization URL',
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

/**
 * API route to check current granted scopes
 * GET /api/google/incremental-scope?scopes=scope1,scope2
 */
export async function GET_impl(request: NextRequest, authOptions: NextAuthOptions) {
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

    const authService = createIncrementalAuthService('interface', session);

    // Check if specific scopes are being queried
    const { searchParams } = new URL(request.url);
    const scopesParam = searchParams.get('scopes');

    if (scopesParam) {
      // Check specific scopes
      const requestedScopes = scopesParam.split(',').map(s => s.trim());
      const hasScopes = await authService.hasScopes(session.user.id, requestedScopes);
      const missingScopes = await authService.getMissingScopes(session.user.id, requestedScopes);
      const scopeStatus = await authService.getUserScopeStatus(session.user.id);

      return NextResponse.json({
        success: true,
        hasScopes,
        grantedScopes: scopeStatus?.grantedScopes || [],
        missingScopes,
        requestedScopes
      });
    } else {
      // Return all scope status
      const scopeStatus = await authService.getUserScopeStatus(session.user.id);

      return NextResponse.json({
        success: true,
        scopeStatus
      });
    }

  } catch (error) {
    log.error('Error getting granted scopes', { error });

    return NextResponse.json(
      { error: 'Failed to retrieve granted scopes' },
      { status: 500 }
    );
  }
}
