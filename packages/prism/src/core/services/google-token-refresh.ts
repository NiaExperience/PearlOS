import { getUserAccountByProvider, updateAccount } from '@nia/prism/core/actions/account-actions';
import { getLogger } from '../logger';

const log = getLogger('prism:gmail');

/**
 * Refreshes Google access token using refresh token
 * @param userId - The user ID to refresh tokens for
 * @returns Object with success status and new access token, or error details
 */
export async function refreshGoogleAccessToken(userId: string): Promise<{
  success: boolean;
  accessToken?: string;
  expiresIn?: number;
  error?: string;
  code?: string;
}> {
  try {
    log.info('Refreshing Google access token', { userId });

    // Get the user's Google account with refresh token
    const account = await getUserAccountByProvider(userId, 'google');

    if (!account) {
      log.warn('No Google account found for user', { userId });
      return {
        success: false,
        error: 'No Google account found',
        code: 'NO_ACCOUNT'
      };
    }

    if (!account.refresh_token) {
      log.warn('No refresh token available for user', { userId });
      return {
        success: false,
        error: 'No refresh token available. Re-authorization required.',
        code: 'NO_REFRESH_TOKEN'
      };
    }

    // Use refresh token to get new access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_INTERFACE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_INTERFACE_CLIENT_SECRET!,
        refresh_token: account.refresh_token,
        grant_type: 'refresh_token',
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      log.error('Token refresh failed', { errorData });
      
      // Check if this is an invalid refresh token error
      if (errorData.includes('invalid_grant') || tokenResponse.status === 400) {
        return {
          success: false,
          error: 'Refresh token has expired or been revoked. Please re-authorize Gmail access.',
          code: 'REFRESH_TOKEN_EXPIRED'
        };
      }
      
      return {
        success: false,
        error: 'Failed to refresh token. Re-authorization may be required.',
        code: 'REFRESH_FAILED'
      };
    }

    const tokenData = await tokenResponse.json();

    // Update the account with the new access token
    const updatedAccount = {
      ...account,
      access_token: tokenData.access_token,
      expires_at: Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600),
      // Keep the existing refresh_token if a new one isn't provided
      ...(tokenData.refresh_token && { refresh_token: tokenData.refresh_token }),
    };

    await updateAccount(account._id, updatedAccount);

    log.info('Successfully refreshed Google access token', { userId });

    return {
      success: true,
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
    };

  } catch (error) {
    log.error('Error refreshing Google access token', { error, userId });
    
    return {
      success: false,
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    };
  }
}
