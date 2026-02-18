/* eslint-disable @typescript-eslint/no-explicit-any */
import type { NextRequest } from 'next/server';
import { getUserAccountByProvider } from '@nia/prism/core/actions/account-actions';
import { GmailApiService } from '@nia/prism/core/services/gmail-api.service';

// Mock only the account lookup & service; rely on real getSessionSafely test-mode header behavior
jest.mock('@nia/prism/core/actions/account-actions');
jest.mock('@nia/prism/core/services/gmail-api.service');
jest.mock('@interface/lib/auth-config', () => ({ interfaceAuthOptions: { mock: 'auth-options' } }));
// Mock incremental auth service factory so we can simulate token refresh
const mockRefreshAccessToken = jest.fn();
jest.mock('@nia/prism/core/oauth/incremental-auth.service', () => ({
  createIncrementalAuthService: () => ({ refreshAccessToken: mockRefreshAccessToken })
}));

const mockGetUserAccountByProvider = getUserAccountByProvider as jest.MockedFunction<typeof getUserAccountByProvider>;
const MockGmailApiService = GmailApiService as jest.MockedClass<typeof GmailApiService>;

describe('Gmail POST_impl (feature tests)', () => {
  let POST_impl: any; // lazy import
  let mockGmailService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGmailService = { scanInbox: jest.fn() };
    MockGmailApiService.mockImplementation(() => mockGmailService);
    if (!POST_impl) {
      ({ POST_impl } = require('../routes/scanInbox'));
    }
  });

  const buildRequest = (headersObj: Record<string, string> = {}): NextRequest => ({
    url: 'http://localhost:3000/api/gmail/scan-inbox',
    headers: new Headers(headersObj)
  }) as unknown as NextRequest;

  const authHeaders = {
    'x-test-user-id': 'user123',
    'x-test-google-access-token': 'valid_access_token'
  };

  describe('Authentication', () => {
    const originalRequire = process.env.TEST_REQUIRE_AUTH_HEADER;
    afterEach(() => {
      if (originalRequire !== undefined) process.env.TEST_REQUIRE_AUTH_HEADER = originalRequire; else delete process.env.TEST_REQUIRE_AUTH_HEADER;
    });
    it('returns 401 when auth header required but missing user header', async () => {
      process.env.TEST_REQUIRE_AUTH_HEADER = 'true';
      const res = await POST_impl(buildRequest());
      const data = await res.json();
      expect(res.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });
  });

  describe('Google account validation', () => {
    it('returns 404 when no Google account found', async () => {
      mockGetUserAccountByProvider.mockResolvedValue(null);
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(404);
      expect(data.error).toBe('No Google account found. Please connect your Google account.');
      expect(mockGetUserAccountByProvider).toHaveBeenCalledWith('user123', 'google');
    });

    it('returns 401 when Gmail scope not granted', async () => {
      mockGetUserAccountByProvider.mockResolvedValue({
        _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth',
        scope: 'https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email'
      });
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(401);
      expect(data.error).toBe('Gmail access not granted. Please authorize Gmail permissions.');
    });
  });

  describe('Successful Gmail scanning', () => {
    const baseAccount = {
      _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth',
      scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email'
    };
    beforeEach(() => { mockGetUserAccountByProvider.mockResolvedValue(baseAccount); });

    it('scans inbox and returns analysis', async () => {
      const mockAnalysis = {
        totalEmails: 150,
        unreadCount: 12,
        recentEmails: [
          { id: '123', threadId: 'thread_123', subject: 'Test Email 1', from: 'sender1@example.com', date: '2025-01-15T10:00:00Z', snippet: 'This is a test email...' },
          { id: '124', threadId: 'thread_124', subject: 'Test Email 2', from: 'sender2@example.com', date: '2025-01-15T09:30:00Z', snippet: 'Another test email...' }
        ],
        categories: { primary: 100, social: 30, promotions: 20 }
      };
      mockGetUserAccountByProvider.mockResolvedValue({ ...baseAccount, scope: baseAccount.scope + ' https://www.googleapis.com/auth/userinfo.profile' });
      mockGmailService.scanInbox.mockResolvedValue(mockAnalysis);
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.analysis).toEqual(mockAnalysis);
      expect(data.scannedEmails).toBe(2);
      expect(data.timestamp).toBeDefined();
      expect(MockGmailApiService).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: 'user123', google_access_token: 'valid_access_token' }) }));
    });

    it('handles empty inbox', async () => {
      mockGmailService.scanInbox.mockResolvedValue({ totalEmails: 0, unreadCount: 0, recentEmails: [], categories: { primary: 0, social: 0, promotions: 0 } });
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.scannedEmails).toBe(0);
      expect(data.analysis.recentEmails).toEqual([]);
    });

    it('handles large inbox', async () => {
      const recentEmails = Array.from({ length: 50 }, (_, i) => ({
        id: `email_${i + 1}`,
        threadId: `thread_${i + 1}`,
        subject: `Email ${i + 1}`,
        from: `sender${i + 1}@example.com`,
        date: new Date(Date.now() - i * 3600000).toISOString(),
        snippet: `Email content ${i + 1}...`
      }));
      const mockAnalysis = { totalEmails: 5000, unreadCount: 234, recentEmails, categories: { primary: 3000, social: 1500, promotions: 500 } };
      mockGmailService.scanInbox.mockResolvedValue(mockAnalysis);
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.scannedEmails).toBe(50);
      expect(data.analysis.totalEmails).toBe(5000);
    });

    it('refreshes access token when missing and account has refresh_token', async () => {
      // Arrange: account with required scope & refresh token
      mockGetUserAccountByProvider.mockResolvedValue({
        _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth',
        scope: 'https://www.googleapis.com/auth/gmail.readonly', refresh_token: 'refresh-xyz'
      } as any);
      // Simulate refresh flow producing new token
      mockRefreshAccessToken.mockResolvedValue({ success: true, newTokens: { access_token: 'refreshed_token' } });
      const mockAnalysis = { totalEmails: 2, unreadCount: 0, recentEmails: [], categories: { primary: 2, social: 0, promotions: 0 } };
      mockGmailService.scanInbox.mockResolvedValue(mockAnalysis);
      // Use null header value to trigger refresh path
      const headersWithoutAccess = { 'x-test-user-id': 'user123', 'x-test-google-access-token': 'null' };
      const res = await POST_impl(buildRequest(headersWithoutAccess));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.scannedEmails).toBe(0);
      expect(data.tokenRefreshed).toBe(true);
      expect(mockRefreshAccessToken).toHaveBeenCalledWith('user123');
      // Ensure GmailApiService constructed with refreshed token
      expect(MockGmailApiService).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ google_access_token: 'refreshed_token' }) }));
    });
  });

  describe('Error handling', () => {
    const account = { _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth', scope: 'https://www.googleapis.com/auth/gmail.readonly' };
    beforeEach(() => { mockGetUserAccountByProvider.mockResolvedValue(account); });

    it('handles Gmail API errors', async () => {
      mockGmailService.scanInbox.mockRejectedValue(new Error('Gmail API rate limit exceeded'));
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to scan Gmail inbox: Gmail API rate limit exceeded');
    });
    it('handles authentication errors', async () => {
      mockGmailService.scanInbox.mockRejectedValue(new Error('Invalid credentials'));
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to scan Gmail inbox: Invalid credentials');
    });
    it('handles network errors', async () => {
      mockGmailService.scanInbox.mockRejectedValue(new Error('Network timeout'));
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to scan Gmail inbox: Network timeout');
    });
    it('handles non-Error throws', async () => {
      mockGmailService.scanInbox.mockRejectedValue('Unknown error');
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to scan Gmail inbox');
    });
    it('handles account lookup errors', async () => {
      mockGetUserAccountByProvider.mockRejectedValue(new Error('Database connection failed'));
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(500);
      expect(data.error).toBe('Failed to scan Gmail inbox: Database connection failed');
    });
  });

  describe('Edge cases', () => {
    it('handles account with multiple Gmail scopes', async () => {
      mockGetUserAccountByProvider.mockResolvedValue({
        _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth',
        scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email'
      });
      mockGmailService.scanInbox.mockResolvedValue({ totalEmails: 10, unreadCount: 1, recentEmails: [], categories: { primary: 10, social: 0, promotions: 0 } });
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });
    it('handles account with Gmail compose scope only', async () => {
      mockGetUserAccountByProvider.mockResolvedValue({
        _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth',
        scope: 'https://www.googleapis.com/auth/gmail.compose'
      });
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(401);
      expect(data.error).toBe('Gmail access not granted. Please authorize Gmail permissions.');
    });
    it('handles undefined scope field', async () => {
      mockGetUserAccountByProvider.mockResolvedValue({
        _id: 'account123', userId: 'user123', provider: 'google', providerAccountId: 'google123', type: 'oauth', scope: undefined
      });
      const res = await POST_impl(buildRequest(authHeaders));
      const data = await res.json();
      expect(res.status).toBe(401);
      expect(data.error).toBe('Gmail access not granted. Please authorize Gmail permissions.');
    });
  });
});
