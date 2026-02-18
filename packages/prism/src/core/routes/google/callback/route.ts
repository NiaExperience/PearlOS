// Lazy import inside handler for getSessionSafely to ensure Jest mocks applied after
// performance instrumentation still intercept the call (static import caused stale reference)
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';
import { NextAuthOptions } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '../../../logger';

const log = getLogger('prism:auth:incremental');

/**
 * Helper function to create a self-closing popup response
 */
function createPopupResponse(type: 'success' | 'error', message: string, data?: any): NextResponse {
  const isError = type === 'error';
  const icon = isError ? '❌' : '✅';
  const color = isError ? '#ef4444' : '#22c55e';
  const title = isError ? 'Authorization Error' : 'Authorization Complete';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center; padding: 50px; }
          .status { color: ${color}; font-size: 24px; margin-bottom: 10px; }
          .message { color: #64748b; }
        </style>
      </head>
      <body>
        <div class="status">${icon} ${title}</div>
        <div class="message">${message}</div>
        <script>
          // Communicate result to parent window if it exists
          if (window.opener && !window.opener.closed) {
            try {
              window.opener.postMessage({
                type: 'OAUTH_${type.toUpperCase()}',
                ${isError ? `error: '${message}'` : `grantedScopes: ${JSON.stringify(data?.grantedScopes || [])}`},
                timestamp: Date.now()
              }, window.location.origin);
            } catch (error) {
              
            }
          }
          
          // Close popup after brief delay (longer for errors to show message)
          setTimeout(() => {
            try {
              window.close();
            } catch (error) {
              ${!isError ? `
              // Fallback for success: hide content and try again
              document.body.innerHTML = '<div style="text-align:center;padding:50px;color:#22c55e;">✅ Authorization Complete</div>';
              setTimeout(() => window.close(), 100);
              ` : ''}
            }
          }, ${isError ? '2000' : '500'});
        </script>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}

/**
 * API route to handle Google OAuth incremental authorization callback
 * GET /api/google/callback
 * 
 * Now redirects to minimal communication pages instead of HTML popup response
 */
export async function GET_impl(request: NextRequest, authOptions: NextAuthOptions) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    log.info('Google OAuth callback', { codePresent: !!code, statePresent: !!state, error });

    // Handle OAuth errors - redirect to error page
    if (error) {
      log.error('OAuth error', { error });
      const errorMessage = searchParams.get('error_description') || error;
      return createPopupResponse('error', errorMessage);
    }

    if (!code || !state) {
      return createPopupResponse('error', 'Invalid authorization response');
    }

    // Extract user ID from state
    if (!state.startsWith('incremental_auth_')) {
      return createPopupResponse('error', 'Invalid state parameter');
    }

    const stateParts = state.split('_');
    const userId = stateParts[2];

    if (!userId) {
      return createPopupResponse('error', 'Invalid user session');
    }

    // Verify that the current session matches the user ID
  const { getSessionSafely } = require('../../../auth/getSessionSafely');
  const rawSession = await getSessionSafely(request, authOptions);
    const session = rawSession && !(rawSession as any).expires
      ? { ...(rawSession as any), expires: new Date(Date.now() + 3600_000).toISOString() }
      : rawSession;
    if (!session?.user?.id || session.user.id !== userId) {
      return createPopupResponse('error', 'Session mismatch');
    }

    const authService = createIncrementalAuthService('interface', session);

    // Handle the callback and update user tokens
    const result = await authService.handleIncrementalCallback(code, state, userId);

    if (!result.success) {
      log.error('Incremental auth callback failed', { error: result.error });
      return createPopupResponse('error', result.error || 'Authorization failed');
    }

    // Success! Return self-closing popup with success message
    return createPopupResponse('success', 'Closing window...', { grantedScopes: result.grantedScopes });

  } catch (error) {
    log.error('Error in incremental auth callback', { error });
    return createPopupResponse('error', 'Internal server error');
  }
}
