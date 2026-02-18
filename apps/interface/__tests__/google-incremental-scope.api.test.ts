/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server';
// Route POST imported dynamically after mocks
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';

// Only mock the service we explicitly control; use real getSessionSafely behavior
jest.mock('@nia/prism/core/oauth/incremental-auth.service');
jest.mock('@interface/lib/auth-config', () => ({
  interfaceAuthOptions: { mock: 'auth-options' }
}));

const mockCreateIncrementalAuthService = createIncrementalAuthService as jest.MockedFunction<typeof createIncrementalAuthService>;

// Shared headers simulating an authenticated test user
const authHeaders = { 'x-test-user-id': 'user123', 'x-test-google-access-token': 'test-access-token' };

describe('/api/google/incremental-scope', () => {
  let POST: any;
  let mockAuthService: any;

  beforeEach(() => {
    // Preserve original mocked module instances (avoid jest.resetModules which invalidates references)
    jest.clearAllMocks();

    mockAuthService = {
      requestScopes: jest.fn(),
      checkUserScopes: jest.fn()
    };

    mockCreateIncrementalAuthService.mockReturnValue(mockAuthService);

    // (Re)import route lazily only once; subsequent calls just reuse same exported function
    if (!POST) {
      ({ POST } = require('@interface/app/api/google/incremental-scope/route'));
    }
  });

  const buildRequest = (body: any, headers: Record<string,string> = {}): NextRequest => {
    // NextRequest constructor requires a full init; we can approximate with casting
    return {
      json: jest.fn().mockResolvedValue(body),
      headers: new Headers(headers),
      url: 'http://localhost:3000/api/google/incremental-scope'
    } as unknown as NextRequest;
  };

  describe('Authentication', () => {
    it('should return 401 when no session exists (missing header with TEST_REQUIRE_AUTH_HEADER=true)', async () => {
      const prev = process.env.TEST_REQUIRE_AUTH_HEADER;
      process.env.TEST_REQUIRE_AUTH_HEADER = 'true';
      const request = buildRequest({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] });
      const response = await POST(request);
      const data = await response.json();
      process.env.TEST_REQUIRE_AUTH_HEADER = prev;
      
      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });

    it('should return 401 when session has no user ID (empty header)', async () => {
      const request = buildRequest({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }, { 'x-test-user-id': '' });
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(401);
      expect(data.error).toBe('Authentication required');
    });
  });

  describe('Request validation', () => {

    it('should return 400 when scopes are missing', async () => {
  const request = buildRequest({}, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid scopes provided');
    });

    it('should return 400 when scopes are not an array', async () => {
  const request = buildRequest({
        scopes: 'https://www.googleapis.com/auth/gmail.readonly'
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid scopes provided');
    });

    it('should return 400 when scopes array is empty', async () => {
  const request = buildRequest({
        scopes: []
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid scopes provided');
    });

    it('should return 400 when scopes is null', async () => {
  const request = buildRequest({
        scopes: null
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid scopes provided');
    });
  });

  describe('Scope request flow', () => {
    // uses shared authHeaders

    it('should successfully request single scope with default reason', async () => {
      mockAuthService.requestScopes.mockResolvedValue({
        authUrl: 'https://accounts.google.com/oauth/authorize?...',
        state: 'incremental_auth_user123_1234567890'
      });
      
  const request = buildRequest({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.authUrl).toBe('https://accounts.google.com/oauth/authorize?...');
      expect(data.state).toBe('incremental_auth_user123_1234567890');
      
      expect(mockAuthService.requestScopes).toHaveBeenCalledWith(
        'user123',
        [{
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          reason: 'Additional permissions required',
          required: true
        }]
      );
    });

    it('should successfully request multiple scopes with custom reason', async () => {
      mockAuthService.requestScopes.mockResolvedValue({
        authUrl: 'https://accounts.google.com/oauth/authorize?...',
        state: 'incremental_auth_user123_1234567890'
      });
      
  const request = buildRequest({
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/drive.readonly'
        ],
        reason: 'Access Gmail and Drive for enhanced features'
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.authUrl).toBe('https://accounts.google.com/oauth/authorize?...');
      expect(data.state).toBe('incremental_auth_user123_1234567890');
      
      expect(mockAuthService.requestScopes).toHaveBeenCalledWith(
        'user123',
        [
          {
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            reason: 'Access Gmail and Drive for enhanced features',
            required: true
          },
          {
            scope: 'https://www.googleapis.com/auth/drive.readonly',
            reason: 'Access Gmail and Drive for enhanced features',
            required: true
          }
        ]
      );
    });

    it('should return error when user already has all scopes', async () => {
      mockAuthService.requestScopes.mockRejectedValue(new Error('User already has all requested scopes'));
      
  const request = buildRequest({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to generate authorization URL');
      expect(data.details).toBe('User already has all requested scopes');
    });

    it('should handle auth service failures', async () => {
      mockAuthService.requestScopes.mockRejectedValue(new Error('Failed to generate auth URL'));
      
  const request = buildRequest({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to generate authorization URL');
      expect(data.details).toBe('Failed to generate auth URL');
    });

    it('should handle unexpected errors gracefully', async () => {
  // Force unexpected error by making the service throw before requestScopes (simulate by replacing factory)
  mockCreateIncrementalAuthService.mockImplementationOnce(() => { throw new Error('Database connection failed'); });
  const request = buildRequest({ scopes: ['https://www.googleapis.com/auth/gmail.readonly'] }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to generate authorization URL');
    });
  });

  describe('Service interaction', () => {
    // uses shared authHeaders

    it('should create auth service correctly', async () => {
      mockAuthService.requestScopes.mockResolvedValue({
        authUrl: 'https://accounts.google.com/oauth/authorize?...',
        state: 'incremental_auth_user123_1234567890'
      });
      
  const request = buildRequest({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  }, authHeaders);
      
      await POST(request);
      
      expect(mockCreateIncrementalAuthService).toHaveBeenCalledWith(
        'interface',
        expect.objectContaining({ user: expect.objectContaining({ id: 'user123' }) })
      );
    });

    it('should handle different scope formats correctly', async () => {
      mockAuthService.requestScopes.mockResolvedValue({
        authUrl: 'https://accounts.google.com/oauth/authorize?...',
        state: 'incremental_auth_user123_1234567890'
      });
      
  const request = buildRequest({
        scopes: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/calendar.readonly',
          'https://www.googleapis.com/auth/drive.file'
        ],
        reason: 'Multi-service integration'
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      expect(mockAuthService.requestScopes).toHaveBeenCalledWith(
        'user123',
        [
          {
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            reason: 'Multi-service integration',
            required: true
          },
          {
            scope: 'https://www.googleapis.com/auth/calendar.readonly',
            reason: 'Multi-service integration',
            required: true
          },
          {
            scope: 'https://www.googleapis.com/auth/drive.file',
            reason: 'Multi-service integration',
            required: true
          }
        ]
      );
    });

    it('should handle requests without reason parameter', async () => {
      mockAuthService.requestScopes.mockResolvedValue({
        authUrl: 'https://accounts.google.com/oauth/authorize?...',
        state: 'incremental_auth_user123_1234567890'
      });
      
  const request = buildRequest({
        scopes: ['https://www.googleapis.com/auth/gmail.readonly']
  }, authHeaders);
      
      const response = await POST(request);
      const data = await response.json();
      
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      
      expect(mockAuthService.requestScopes).toHaveBeenCalledWith(
        'user123',
        [{
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          reason: 'Additional permissions required',
          required: true
        }]
      );
    });
  });
});
