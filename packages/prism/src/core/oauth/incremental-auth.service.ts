import { Session } from 'next-auth';

import { getUserAccountByProvider, updateAccount } from '../actions/account-actions';
import { ContentData } from '../content/types';
import { isValidUUID } from '../utils';
import { getLogger } from '../logger';

import {
  AuthorizationResult,
  GOOGLE_SCOPES,
  IncrementalAuthConfig,
  ScopeRequest,
  UserScopeStatus
} from './incremental-auth.types';

/**
 * Core service for handling incremental OAuth authorization
 * Implements Google's best practices for requesting additional scopes in context
 */
export class IncrementalAuthService {
  private readonly baseAuthUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly log = getLogger('prism:auth:incremental');
  
  constructor(private config: IncrementalAuthConfig) {}

  /**
   * Check what scopes a user has already granted
   */
  async getUserScopeStatus(userId: string, provider: string = 'google'): Promise<UserScopeStatus | null> {
    try {
      const account = await getUserAccountByProvider(userId, provider);
      if (!account || !account.scope) {
        return null;
      }

      const grantedScopes = account.scope.split(' ').filter((scope: string) => scope.trim());
      
      return {
        userId,
        provider,
        grantedScopes,
        requestedScopes: [], // Will be populated when needed
        lastUpdated: new Date(),
      };
    } catch (error) {
      this.log.error('Error getting user scope status', { error, userId, provider });
      return null;
    }
  }

  /**
   * Check if user has specific scopes
   */
  async hasScopes(userId: string, requiredScopes: string[], provider: string = 'google'): Promise<boolean> {
    const status = await this.getUserScopeStatus(userId, provider);
    if (!status) return false;

    return requiredScopes.every(scope => status.grantedScopes.includes(scope));
  }

  /**
   * Get missing scopes for a user
   */
  async getMissingScopes(userId: string, requiredScopes: string[], provider: string = 'google'): Promise<string[]> {
    const status = await this.getUserScopeStatus(userId, provider);
    if (!status) return requiredScopes;

    return requiredScopes.filter(scope => !status.grantedScopes.includes(scope));
  }

  /**
   * Generate authorization URL for incremental scope request
   */
  generateIncrementalAuthUrl(
    userId: string,
    newScopes: string[],
    state?: string,
    loginHint?: string
  ): string {
    this.log.info('Generating incremental auth URL', { baseUrl: this.config.baseUrl, userId, scopes: newScopes });
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: `${this.config.baseUrl}/api/google/callback`,
      response_type: 'code',
      scope: newScopes.join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true', // This is the key for incremental auth!
      state: state || `incremental_auth_${userId}_${Date.now()}`,
      prompt: 'consent', // Always show consent screen for new scopes
    });

    if (loginHint) {
      params.set('login_hint', loginHint);
    }

    const incrementalAuthUrl = `${this.baseAuthUrl}?${params.toString()}`;
    this.log.info('Generated incremental auth URL', {
      userId,
      hasState: Boolean(state),
      redirectUri: `${this.config.baseUrl}/api/google/callback`,
    });
    return incrementalAuthUrl;
  }

  /**
   * Request additional scopes for a user
   */
  async requestScopes(
    userId: string, 
    scopeRequests: ScopeRequest[],
    userEmail?: string
  ): Promise<{ authUrl: string; state: string }> {
    const newScopes = scopeRequests.map(req => req.scope);
    const missingScopes = await this.getMissingScopes(userId, newScopes);
    
    if (missingScopes.length === 0) {
      throw new Error('User already has all requested scopes');
    }

    const state = `incremental_auth_${userId}_${Date.now()}`;
    const authUrl = this.generateIncrementalAuthUrl(
      userId,
      missingScopes,
      state,
      userEmail
    );

    return { authUrl, state };
  }

  /**
   * Handle the callback from incremental authorization
   */
  async handleIncrementalCallback(
    code: string,
    state: string,
    userId: string
  ): Promise<AuthorizationResult> {
    try {
      // Extract userId from state if not provided
      if (!userId && state.startsWith('incremental_auth_')) {
        const parts = state.split('_');
        userId = parts[2];
      }

      if (!userId || !isValidUUID(userId)) {
        throw new Error(`Invalid state parameter or missing user ID: ${state}`);
      }

      // Exchange code for tokens
      const tokenResponse = await this.exchangeCodeForTokens(code);
      
      if (!tokenResponse.success || !tokenResponse.newTokens) {
        return {
          success: false,
          error: 'Failed to exchange code for tokens'
        };
      }

      // Update user account with new tokens and scopes
      await this.updateUserTokens(userId, tokenResponse.newTokens);

      // Parse granted scopes
      const grantedScopes = tokenResponse.newTokens.scope.split(' ').filter(s => s.trim());

      return {
        success: true,
        grantedScopes,
        newTokens: tokenResponse.newTokens
      };

    } catch (error) {
      this.log.error('Error handling incremental callback', { error, userId, state });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Exchange authorization code for access tokens
   */
  private async exchangeCodeForTokens(code: string): Promise<AuthorizationResult> {
    try {
      // Get the appropriate client secret based on app type
      const clientSecret = this.config.clientId.includes('dashboard') 
        ? process.env.GOOGLE_DASHBOARD_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
        : process.env.GOOGLE_INTERFACE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: clientSecret || '',
          code,
          grant_type: 'authorization_code',
          redirect_uri: `${this.config.baseUrl}/api/google/callback`,
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token exchange failed: ${errorData}`);
      }

      const tokenData = await response.json();

      return {
        success: true,
        newTokens: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: tokenData.expires_in ? Math.floor(Date.now() / 1000) + tokenData.expires_in : undefined,
          scope: tokenData.scope,
        }
      };

    } catch (error) {
      this.log.error('Error exchanging code for tokens', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token exchange failed'
      };
    }
  }

  /**
   * Update user account with new tokens
   */
  private async updateUserTokens(
    userId: string,
    tokens: NonNullable<AuthorizationResult['newTokens']>
  ): Promise<void> {
    const account = await getUserAccountByProvider(userId, 'google');
    if (!account) {
      throw new Error('User Google account not found');
    }

    // Merge the new scopes with existing scopes and deduplicate
    const existingScopes = account.scope ? account.scope.split(' ').filter((s: string) => s.trim()) : [];
    const newScopes = tokens.scope ? tokens.scope.split(' ').filter(s => s.trim()) : [];
    const allScopes = [...new Set([...existingScopes, ...newScopes])];

    const updatedAccount: ContentData = {
      ...account,
      refresh_token: tokens.refresh_token || account.refresh_token,
      expires_at: tokens.expires_at || account.expires_at,
      scope: allScopes.join(' '),
    };

    // Add access token to session
    if (this.config.session) {
      (this.config.session as any).user.google_access_token = tokens.access_token;
    }
    

    await updateAccount(updatedAccount._id, updatedAccount);
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(userId: string, provider: string = 'google'): Promise<AuthorizationResult> {
    try {
      const account = await getUserAccountByProvider(userId, provider);
      if (!account || !account.refresh_token) {
        return {
          success: false,
          error: 'No refresh token available'
        };
      }

      // Get the appropriate client secret based on app type
      const clientSecret = this.config.clientId.includes('dashboard') 
        ? process.env.GOOGLE_DASHBOARD_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
        : process.env.GOOGLE_INTERFACE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;

      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          client_secret: clientSecret || '',
          refresh_token: account.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Token refresh failed: ${errorData}`);
      }

      const tokenData = await response.json();

      const newTokens = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || account.refresh_token,
        expires_at: tokenData.expires_in ? Math.floor(Date.now() / 1000) + tokenData.expires_in : undefined,
        scope: tokenData.scope || account.scope,
      };

      await this.updateUserTokens(userId, newTokens);

      return {
        success: true,
        newTokens
      };

    } catch (error) {
      this.log.error('Error refreshing access token', { error, userId, provider });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed'
      };
    }
  }

  /**
   * Get valid access token for user (refresh if needed)
   */
  async getValidAccessToken(userId: string, provider: string = 'google'): Promise<string | null> {
    const account = await getUserAccountByProvider(userId, provider);
    if (!account) {
      return null;
    }

    // Check if token is expired (with 5 minute buffer)
    const now = Math.floor(Date.now() / 1000);
    const isExpired = account.expires_at && (account.expires_at - 300) < now;

    if (isExpired && account.refresh_token) {
      const refreshResult = await this.refreshAccessToken(userId, provider);
      if (refreshResult.success && refreshResult.newTokens) {
        return refreshResult.newTokens.access_token;
      }
      return null;
    }

    return account.access_token;
  }
}

/**
 * Factory function to create incremental auth service for different apps
 */
export function createIncrementalAuthService(
  appType: 'interface' | 'dashboard',
  session: Session
): IncrementalAuthService {
  const clientId = appType === 'dashboard' 
    ? process.env.GOOGLE_DASHBOARD_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!
    : process.env.GOOGLE_INTERFACE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!;

  const baseUrl = appType === 'dashboard' 
    ? process.env.NEXTAUTH_DASHBOARD_URL || 'http://localhost:4000'
    : process.env.NEXTAUTH_INTERFACE_URL || 'http://localhost:3000';

  return new IncrementalAuthService({
    clientId,
    baseUrl,
    scopes: [], // Will be populated per request
    session
  });
}

// Predefined scope request templates
export const SCOPE_TEMPLATES = {
  GMAIL_READ: {
    scope: GOOGLE_SCOPES.GMAIL_READONLY,
    reason: 'Access your Gmail messages to provide email integration features',
    required: true,
  },
  GMAIL_SEND: {
    scope: GOOGLE_SCOPES.GMAIL_SEND,
    reason: 'Send emails on your behalf through Gmail',
    required: true,
  },
  DRIVE_READ: {
    scope: GOOGLE_SCOPES.DRIVE_READONLY,
    reason: 'Access your Google Drive files to provide document integration',
    required: true,
  },
  CALENDAR_READ: {
    scope: GOOGLE_SCOPES.CALENDAR_READONLY,
    reason: 'Access your Google Calendar to show upcoming events',
    required: false,
  },
} as const;
