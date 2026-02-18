import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getUserAccountByProvider } from '@nia/prism/core/actions/account-actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { IAccount } from '@nia/prism/core/blocks/account.block';
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';
import { GmailApiService } from '@nia/prism/core/services/gmail-api.service';
import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@interface/lib/logger';

const logger = getLogger('GmailScanInboxRoute');

/**
 * Core inbox scan implementation (POST_impl style) decoupled from app/api route.
 */
export async function POST_impl(request: NextRequest): Promise<NextResponse> {
  try {
    const rawSession = await getSessionSafely(request, interfaceAuthOptions);
    // Normalize to Session shape (add minimal expires if missing) so downstream services expecting Session don't type-error
    const session = rawSession && !(rawSession as any).expires
      ? { ...(rawSession as any), expires: new Date(Date.now() + 3600_000).toISOString() }
      : rawSession;
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const account: IAccount | null = (await getUserAccountByProvider(session.user.id, 'google')) as IAccount | null;
    if (!account) {
      // Expanded guidance message expected by tests
      return NextResponse.json({ error: 'No Google account found. Please connect your Google account.' }, { status: 404 });
    }

    const READ_ONLY_EMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
    if (!account.scope?.includes(READ_ONLY_EMAIL_SCOPE)) {
      return NextResponse.json({ error: 'Gmail access not granted. Please authorize Gmail permissions.', needsAuthorization: true }, { status: 401 });
    }

    const accessToken = (session.user as any).google_access_token as string | undefined;
    if (!accessToken || accessToken.trim() === '' || accessToken === 'null') {
      // Attempt a refresh if we have a stored refresh token
      if (account.refresh_token) {
        try {
          const authService = createIncrementalAuthService('interface', session);
          const refreshResult = await authService.refreshAccessToken(session.user.id);
          if (refreshResult.success && refreshResult.newTokens?.access_token) {
            const updatedSession = { ...session, user: { ...session.user, google_access_token: refreshResult.newTokens.access_token } };
            const gmailService = new GmailApiService(updatedSession);
            const emailAnalysis = await gmailService.scanInbox();
            return NextResponse.json({ success: true, analysis: emailAnalysis, scannedEmails: emailAnalysis.recentEmails.length, timestamp: new Date().toISOString(), tokenRefreshed: true });
          }
        } catch (e) {
          logger.error('Token refresh failed during scanInbox', { error: e });
          // fall through to 401 response below
        }
      }
      return NextResponse.json({ error: 'No access token available', needsAuthorization: true }, { status: 401 });
    }

    const gmailService = new GmailApiService(session);
    const emailAnalysis = await gmailService.scanInbox();
    return NextResponse.json({ success: true, analysis: emailAnalysis, scannedEmails: emailAnalysis.recentEmails.length, timestamp: new Date().toISOString() });
  } catch (error: any) {
    if (error instanceof Error) {
      return NextResponse.json({ error: `Failed to scan Gmail inbox: ${error.message}` }, { status: 500 });
    }
    // Non-Error thrown values -> generic message (expected by tests)
    return NextResponse.json({ error: 'Failed to scan Gmail inbox' }, { status: 500 });
  }
}
