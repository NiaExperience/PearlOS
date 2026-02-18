/* eslint-disable @typescript-eslint/no-explicit-any */
import { isValidUUID } from '@nia/prism/core/utils';

import { getLogger } from '../logger';

import { GmailAuthRecoveryService } from './gmail-auth-recovery.service';
import { refreshGoogleAccessToken } from './google-token-refresh';

const log = getLogger('prism:gmail');

interface GmailMessage {
  id: string;
  snippet: string;
  labelIds: string[];
  payload: {
    headers: Array<{
      name: string;
      value: string;
    }>;
    body?: {
      data?: string;
      size?: number;
    };
    parts?: Array<{
      mimeType: string;
      body?: {
        data?: string;
        size?: number;
      };
      parts?: any[];
    }>;
    mimeType?: string;
  };
  internalDate: string;
}

interface GmailListResponse {
  messages: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

interface EmailSummary {
  total: number;
  unread: number;
  important: number;
  recentEmails: Array<{
    from: string;
    subject: string;
    snippet: string;
    isUnread: boolean;
    isImportant: boolean;
    receivedTime: string;
    fullContent?: string; // Add full email content for important emails
  }>;
}

/**
 * Format token expiry time in a human-readable format
 */
function formatTokenExpiry(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diffSeconds = expiresAt - now;
  
  if (diffSeconds <= 0) {
    const expiredSeconds = Math.abs(diffSeconds);
    if (expiredSeconds < 60) {
      return `expired ${expiredSeconds} seconds ago`;
    } else if (expiredSeconds < 3600) {
      const minutes = Math.floor(expiredSeconds / 60);
      return `expired ${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
    } else if (expiredSeconds < 86400) {
      const hours = Math.floor(expiredSeconds / 3600);
      const minutes = Math.floor((expiredSeconds % 3600) / 60);
      return `expired ${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''} ago`;
    } else {
      const days = Math.floor(expiredSeconds / 86400);
      const hours = Math.floor((expiredSeconds % 86400) / 3600);
      return `expired ${days} day${days !== 1 ? 's' : ''}${hours > 0 ? ` ${hours} hour${hours !== 1 ? 's' : ''}` : ''} ago`;
    }
  } else {
    if (diffSeconds < 60) {
      return `expires in ${diffSeconds} seconds`;
    } else if (diffSeconds < 3600) {
      const minutes = Math.floor(diffSeconds / 60);
      return `expires in ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else if (diffSeconds < 86400) {
      const hours = Math.floor(diffSeconds / 3600);
      const minutes = Math.floor((diffSeconds % 3600) / 60);
      return `expires in ${hours} hour${hours !== 1 ? 's' : ''}${minutes > 0 ? ` ${minutes} minute${minutes !== 1 ? 's' : ''}` : ''}`;
    } else {
      const days = Math.floor(diffSeconds / 86400);
      const hours = Math.floor((diffSeconds % 86400) / 3600);
      return `expires in ${days} day${days !== 1 ? 's' : ''}${hours > 0 ? ` ${hours} hour${hours !== 1 ? 's' : ''}` : ''}`;
    }
  }
}

export class GmailApiService {
  private accessToken: string;
  private userId?: string;
  private session: any;

  constructor(session: any) {
    this.session = session;
    this.accessToken = (session as any).google_access_token;
    this.userId = (session as any).user.id;
    log.info('GmailApiService initialized for user', { userId: this.userId });
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<string | null> {
    if (!this.userId || !isValidUUID(this.userId)) {
      log.error('No userId available for token refresh');
      return null;
    }

    try {
      log.info('Attempting direct token refresh for user', { userId: this.userId });

      const result = await refreshGoogleAccessToken(this.userId);

      if (!result.success) {
        log.error('Token refresh failed', {
          error: result.error,
          code: result.code,
          userId: this.userId,
        });

        // Check for specific error codes
        if (result.code === 'REFRESH_TOKEN_EXPIRED') {
          log.error('Refresh token has expired - need full re-authorization', { userId: this.userId });
        }

        throw new Error(`Failed to refresh token: ${result.error}`);
      }
      
      // Log token expiry information if available
      if (result.expiresIn) {
        const expiresAt = Math.floor(Date.now() / 1000) + result.expiresIn;
        const expiryInfo = formatTokenExpiry(expiresAt);
        log.info('Token refresh successful', { expiryInfo, userId: this.userId });
      } else {
        log.info('Token refresh successful', { userId: this.userId });
      }
      
      this.accessToken = result.accessToken!;
      this.session.google_access_token = this.accessToken;
      return result.accessToken!;
    } catch (error) {
      log.error('Error refreshing access token', { error, userId: this.userId });
      return null;
    }
  }

  /**
   * Make an authenticated request to Gmail API with automatic token refresh
   */
  private async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    const headers = {
      'Authorization': `Bearer ${this.accessToken}`,
      ...options.headers,
    };

    let response = await fetch(url, {
      ...options,
      headers,
    });

    // If we get a 401, try to refresh the token and retry once
    if (response.status === 401 && this.userId) {
      log.warn('Access token expired, attempting refresh', { userId: this.userId });
      
      // First try the explicit token refresh approach
      try {
        const recoveryResult = await GmailAuthRecoveryService.refreshTokenOnly();
        
        if (recoveryResult.success) {
          log.info('Token refresh successful via explicit refresh, retrying original request', { userId: this.userId });
          // Get a new token from the session (should be updated by the refresh endpoint)
          const newAccessToken = await this.refreshAccessToken();
          
          if (newAccessToken) {
            // Retry the request with the new token
            headers['Authorization'] = `Bearer ${newAccessToken}`;
            response = await fetch(url, {
              ...options,
              headers,
            });
            return response;
          }
        }
      } catch (refreshError) {
        log.error('Explicit token refresh failed', { error: refreshError, userId: this.userId });
      }
      
      // Fall back to the original refresh method if explicit refresh fails
      const newAccessToken = await this.refreshAccessToken();
      
      if (newAccessToken) {
        // Retry the request with the new token
        log.info('Token refresh successful via original method, retrying original request', { userId: this.userId });
        headers['Authorization'] = `Bearer ${newAccessToken}`;
        response = await fetch(url, {
          ...options,
          headers,
        });
      } else {
        // Token refresh failed - scope is no longer available
        log.error('Token refresh failed - Gmail scope may no longer be available', { userId: this.userId });
        log.info('Triggering Gmail re-authorization workflow', { userId: this.userId });
        
        // Use the dedicated recovery service
        const recoveryResult = await GmailAuthRecoveryService.triggerGmailReauthorization();
        log.info('Gmail recovery result', { userId: this.userId, recoveryResult });
        
        // Return the original 401 response since we couldn't recover
        return response;
      }
    }

    return response;
  }

  async scanInbox(): Promise<EmailSummary> {
    try {
      // Get list of messages (up to 50 most recent)
      const listResponse = await this.listMessages('in:inbox', 50);
      
      const total = listResponse.resultSizeEstimate;
      
      // Get unread count
      const unreadResponse = await this.listMessages('in:inbox is:unread', 50);
      const unread = unreadResponse.resultSizeEstimate;

      // Get detailed info for recent messages (first 25)
      const recentMessageIds = listResponse.messages?.slice(0, 25) || [];
      const recentEmails = [];
      let important = 0;

      for (const messageRef of recentMessageIds) {
        try {
          const message = await this.getMessage(messageRef.id);
          const emailInfo = this.extractEmailInfo(message);
          
          if (emailInfo.isImportant) {
            important++;
          }
          
          recentEmails.push(emailInfo);
        } catch (error) {
          log.error('Failed to get message', { messageId: messageRef.id, error });
        }
      }

      return {
        total,
        unread,
        important,
        recentEmails
      };
    } catch (error) {
      log.error('Error scanning inbox', { error, userId: this.userId });
      
      // Check if this is an authentication error
      if (error instanceof Error && error.message.includes('401')) {
        throw new Error('Gmail access has expired. Please re-authorize Gmail access to continue.');
      }
      
      throw new Error('Failed to scan Gmail inbox');
    }
  }

  /**
   * List messages with optional query
   */
  private async listMessages(query: string = '', maxResults: number = 10): Promise<GmailListResponse> {
    const params = new URLSearchParams({
      maxResults: maxResults.toString(),
      ...(query && { q: query })
    });

    const response = await this.makeAuthenticatedRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Get a specific message by ID
   */
  private async getMessage(id: string): Promise<GmailMessage> {
    const response = await this.makeAuthenticatedRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Extract relevant information from a Gmail message
   */
  private extractEmailInfo(message: GmailMessage) {
    const headers = message.payload.headers;
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
    const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
    
    // Extract just the email/name from the from field
    const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/) || fromHeader.match(/^(.+)$/);
    const from = fromMatch ? (fromMatch[1] || fromMatch[0]).trim() : fromHeader;

    const isUnread = message.labelIds.includes('UNREAD');
    const isImportant = message.labelIds.includes('IMPORTANT') || 
                       message.labelIds.includes('CATEGORY_PRIMARY') ||
                       this.isEmailImportant(fromHeader, subjectHeader, message.snippet);

    const receivedTime = new Date(parseInt(message.internalDate)).toLocaleString();

    // Extract full content for important emails
    let fullContent: string | undefined;
    if (isImportant) {
      fullContent = this.extractEmailBody(message);
    }

    return {
      from,
      subject: this.basicTextCleanup(subjectHeader),
      snippet:  this.basicTextCleanup(message.snippet || ''),
      isUnread,
      isImportant,
      receivedTime,
      fullContent: fullContent ? this.basicTextCleanup(fullContent) : undefined
    };
  }

  /**
   * Extract the text content from a Gmail message body
   */
  private extractEmailBody(message: GmailMessage): string {
    try {
      // Try to get text from the message payload
      let textContent = '';

      // Function to decode base64url encoded data
      const decodeBase64Url = (data: string): string => {
        try {
          // Gmail uses base64url encoding, convert to base64
          const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
          // Add padding if needed
          const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
          
          // Use appropriate base64 decoder for environment
          if (typeof window !== 'undefined') {
            return atob(padded);
          } else if (typeof Buffer !== 'undefined') {
            return Buffer.from(padded, 'base64').toString('utf-8');
          } else {
            log.warn('No base64 decoder available');
            return '';
          }
        } catch (error) {
          log.warn('Failed to decode base64 data', { error });
          return '';
        }
      };

      // Function to extract text from parts recursively
      const extractTextFromParts = (parts: any[]): string => {
        let text = '';
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            text += decodeBase64Url(part.body.data) + '\n';
          } else if (part.mimeType === 'text/html' && part.body?.data && !text) {
            // Use HTML as fallback if no plain text
            const htmlContent = decodeBase64Url(part.body.data);
            // Basic HTML stripping (simple approach)
            text += htmlContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ') + '\n';
          } else if (part.parts) {
            text += extractTextFromParts(part.parts);
          }
        }
        return text;
      };

      // Check if message has parts (multipart)
      if (message.payload.parts) {
        textContent = extractTextFromParts(message.payload.parts);
      } else if (message.payload.body?.data) {
        // Single part message
        if (message.payload.mimeType === 'text/plain') {
          textContent = decodeBase64Url(message.payload.body.data);
        } else if (message.payload.mimeType === 'text/html') {
          const htmlContent = decodeBase64Url(message.payload.body.data);
          textContent = htmlContent.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
        }
      }

      // Clean up the text content
      textContent = textContent
        .replace(/\n\s*\n/g, '\n') // Remove multiple newlines
        .replace(/^\s+|\s+$/g, '') // Trim whitespace
        .substring(0, 2000); // Limit to 2000 characters to avoid overwhelming LLM

      return textContent || message.snippet || '';
    } catch (error) {
      log.warn('Failed to extract email body', { error });
      return message.snippet || '';
    }
  }

  /**
   * Basic text cleanup before NLP processing
   */
  private basicTextCleanup(text: string): string {
    return text
      // Remove HTML entities
      .replace(/&[a-zA-Z0-9#]+;/g, ' ')
      // Remove email headers
      .replace(/^(From|To|Subject|Date|Reply-To|CC|BCC):\s*.+$/gm, '')
      // Remove obvious email artifacts
      .replace(/^\s*Sent from .+$/gm, '')
      .replace(/^\s*Get Outlook for .+$/gm, '')
      .replace(/^--\s*$/gm, '')
      // Remove excessive whitespace
      .replace(/\s{3,}/g, ' ')
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  /**
   * Determine if an email looks important based on content analysis
   */
  private isEmailImportant(from: string, subject: string, snippet: string): boolean {
    const importantKeywords = [
      'urgent', 'important', 'asap', 'deadline', 'meeting', 'interview',
      'contract', 'payment', 'invoice', 'security', 'verification',
      'confirm', 'action required', 'please respond', 'follow up'
    ];

    const text = `${from} ${subject} ${snippet}`.toLowerCase();
    
    return importantKeywords.some(keyword => text.includes(keyword));
  }
}
