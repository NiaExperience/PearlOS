import { getLogger } from '../logger';

/**
 * Gmail Authentication Recovery Service
 * 
 * Handles recovery when Gmail access tokens fail, including triggering
 * the incremental authorization workflow for re-approval of Gmail scope.
 */

export class GmailAuthRecoveryService {
  /**
   * Get the appropriate base URL for server-side requests
   */
  private static getServerBaseUrl(): string {
    if (typeof window !== 'undefined') {
      // Client-side: use relative URLs
      return '';
    }
    
    // Server-side: construct proper localhost URL
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    if (envUrl) {
      // If environment URL uses HTTPS with 127.0.0.1, convert to HTTP with localhost
      return envUrl.replace('https://127.0.0.1', 'http://localhost');
    }
    
    // Fallback to HTTP localhost
    return 'http://localhost:3000';
  }

  /**
   * Trigger Gmail re-authorization when refresh token fails
   */
  static async triggerGmailReauthorization(): Promise<{
    success: boolean;
    authUrl?: string;
    message: string;
  }> {
    try {
      getLogger('prism:gmail').info('Triggering Gmail re-authorization workflow');
      
      // Check current scope status and request re-authorization if needed
      const baseUrl = this.getServerBaseUrl();
      const scopeCheckUrl = `${baseUrl}/api/google/incremental-scope?scopes=https://www.googleapis.com/auth/gmail.readonly`;
      
      const response = await fetch(scopeCheckUrl);
      
      if (!response.ok) {
        getLogger('prism:gmail').error('Failed to check Gmail scope status', { status: response.status, statusText: response.statusText });
        return {
          success: false,
          message: 'Failed to check Gmail authorization status. Please try again later.'
        };
      }
      
      const data = await response.json();
      getLogger('prism:gmail').info('Gmail scope check result', { data });
      
      if (data.hasScope) {
        // User already has the scope, but tokens might be invalid
        return {
          success: true,
          message: 'Gmail access is authorized but tokens may need refresh. Please try again.'
        };
      } else if (data.authUrl) {
        // User needs to re-authorize Gmail access
        return {
          success: true,
          authUrl: data.authUrl,
          message: 'Gmail access requires re-authorization. Please follow the authorization link.'
        };
      } else {
        return {
          success: false,
          message: 'Unable to determine Gmail authorization status. Please try again later.'
        };
      }
    } catch (error) {
      getLogger('prism:gmail').error('Error during Gmail re-authorization', { error });
      return {
        success: false,
        message: 'An error occurred while trying to re-authorize Gmail access. Please try again later.'
      };
    }
  }

  /**
   * Check if Gmail scope is currently available
   */
  static async checkGmailAccess(): Promise<{
    hasAccess: boolean;
    needsReauth: boolean;
    authUrl?: string;
  }> {
    try {
      const baseUrl = this.getServerBaseUrl();
      const scopeCheckUrl = `${baseUrl}/api/google/incremental-scope?scopes=https://www.googleapis.com/auth/gmail.readonly`;
      const response = await fetch(scopeCheckUrl);
      
      if (!response.ok) {
        return {
          hasAccess: false,
          needsReauth: true
        };
      }
      
      const data = await response.json();
      
      return {
        hasAccess: data.hasScope || false,
        needsReauth: !data.hasScope,
        authUrl: data.authUrl
      };
    } catch (error) {
      getLogger('prism:gmail').error('Error checking Gmail access', { error });
      return {
        hasAccess: false,
        needsReauth: true
      };
    }
  }

  /**
   * Attempt to refresh the access token without requiring re-authorization
   * This is useful when the token is expired but the user still has the scope granted
   */
  static async refreshTokenOnly(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      getLogger('prism:gmail').info('Attempting explicit token refresh');
      
      const baseUrl = this.getServerBaseUrl();
      const refreshUrl = `${baseUrl}/api/google/refresh-token`;
      
      // Add a timestamp to prevent caching
      const uniqueUrl = `${refreshUrl}?_=${Date.now()}`;
      
      const response = await fetch(uniqueUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });
      
      if (!response.ok) {
        getLogger('prism:gmail').error('Token refresh failed', { status: response.status, statusText: response.statusText });
        return {
          success: false,
          message: 'Failed to refresh access token. You may need to re-authorize.'
        };
      }
      
      const data = await response.json();
      getLogger('prism:gmail').info('Token refresh result', { data });
      
      return {
        success: true,
        message: 'Access token refreshed successfully.'
      };
    } catch (error) {
      getLogger('prism:gmail').error('Error during token refresh', { error });
      return {
        success: false,
        message: 'An error occurred while refreshing the access token.'
      };
    }
  }
}
