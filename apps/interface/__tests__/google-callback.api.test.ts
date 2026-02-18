/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { GET } from '../src/app/api/google/callback/route';

// Mock the auth module
jest.mock('@nia/prism/core/auth/getSessionSafely', () => ({
  getSessionSafely: jest.fn()
}));
jest.mock('@nia/prism/core/oauth/incremental-auth.service', () => ({
  createIncrementalAuthService: jest.fn(() => ({
    handleIncrementalCallback: jest.fn(),
  })),
}));

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;

describe('/api/google/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSessionSafely.mockReset();
  });

  describe('Error handling', () => {
    it('should return HTML popup response when OAuth error is present', async () => {
      const request = new NextRequest('http://localhost:3000/api/google/callback?error=access_denied&error_description=User denied access');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      const html = await response.text();
      expect(html).toContain('Authorization Error');
      expect(html).toContain('User denied access');
      expect(html).toContain('OAUTH_ERROR');
    });

    it('should handle unexpected errors gracefully', async () => {
      mockGetSessionSafely.mockRejectedValue(new Error('Database connection failed'));
      
      const request = new NextRequest('http://localhost:3000/api/google/callback?code=auth_code_123&state=incremental_auth_user123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      const html = await response.text();
      expect(html).toContain('Authorization Error');
      expect(html).toContain('Internal server error');
      expect(html).toContain('OAUTH_ERROR');
    });
  });

  describe('Success flow', () => {
    beforeEach(() => {
      mockGetSessionSafely.mockResolvedValue({
        user: { id: 'user123' },
        expires: new Date(Date.now() + 3600000).toISOString(),
      } as any);
    });

    it('should return HTML popup response when authorization succeeds', async () => {
      const { createIncrementalAuthService } = require('@nia/prism/core/oauth/incremental-auth.service');
      const mockAuthService = {
        handleIncrementalCallback: jest.fn().mockResolvedValue({
          success: true,
          grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
        }),
      };
      createIncrementalAuthService.mockReturnValue(mockAuthService);

      const request = new NextRequest('http://localhost:3000/api/google/callback?code=auth_code_123&state=incremental_auth_user123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      const html = await response.text();
      expect(html).toContain('Authorization Complete');
      expect(html).toContain('Closing window...');
      expect(html).toContain('OAUTH_SUCCESS');
      expect(html).toContain('https://www.googleapis.com/auth/gmail.readonly');
      
      expect(mockAuthService.handleIncrementalCallback).toHaveBeenCalledWith(
        'auth_code_123',
        'incremental_auth_user123',
        'user123'
      );
    });

    it('should handle multiple granted scopes', async () => {
      const { createIncrementalAuthService } = require('@nia/prism/core/oauth/incremental-auth.service');
      const mockAuthService = {
        handleIncrementalCallback: jest.fn().mockResolvedValue({
          success: true,
          grantedScopes: [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/drive.readonly'
          ],
        }),
      };
      createIncrementalAuthService.mockReturnValue(mockAuthService);

      const request = new NextRequest('http://localhost:3000/api/google/callback?code=auth_code_123&state=incremental_auth_user123');
      const response = await GET(request);
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      const html = await response.text();
      expect(html).toContain('Authorization Complete');
      expect(html).toContain('Closing window...');
      expect(html).toContain('OAUTH_SUCCESS');
      expect(html).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(html).toContain('https://www.googleapis.com/auth/drive.readonly');
    });
  });
});
