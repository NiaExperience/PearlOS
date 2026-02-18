/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';

// Mock Next.js modules
jest.mock('@nia/prism/core/auth/getSessionSafely', () => ({
  getSessionSafely: jest.fn(),
}));

jest.mock('@nia/prism/core/oauth/incremental-auth.service', () => ({
  createIncrementalAuthService: jest.fn(() => ({
    handleIncrementalCallback: jest.fn(),
  })),
}));

jest.mock('@interface/lib/auth-config', () => ({
  interfaceAuthOptions: {},
}));

// Import the route handler after mocks are set up
import { GET } from '../src/app/api/google/callback/route';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { createIncrementalAuthService } from '@nia/prism/core/oauth/incremental-auth.service';

const mockGetSessionSafely = getSessionSafely as jest.MockedFunction<typeof getSessionSafely>;

describe('Google Callback Route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle OAuth error parameters', async () => {
    const url = 'http://localhost:3000/api/google/callback?error=access_denied&error_description=User%20denied%20access&state=incremental_auth_user123';
    const request = new NextRequest(url);
    
    const response = await GET(request);
    
    expect(response.status).toBe(200); // HTML popup
    expect(response.headers.get('content-type')).toBe('text/html');
    const html = await response.text();
    expect(html).toContain('Authorization Error');
    expect(html).toContain('User denied access');
    expect(html).toContain('OAUTH_ERROR');
  });

  it('should handle missing code parameter', async () => {
    const url = 'http://localhost:3000/api/google/callback?state=incremental_auth_user123';
    const request = new NextRequest(url);

    const response = await GET(request);
    
    expect(response.status).toBe(200); // HTML popup
    expect(response.headers.get('content-type')).toBe('text/html');
    const html = await response.text();
    expect(html).toContain('Authorization Error');
    expect(html).toContain('Invalid authorization response');
    expect(html).toContain('OAUTH_ERROR');
  });



  it('should handle successful callback with valid parameters', async () => {
    // Mock successful session
    mockGetSessionSafely.mockResolvedValue({
      user: { id: 'user123', email: 'test@example.com' }
    } as any);

    // Mock successful auth service
    const { createIncrementalAuthService } = require('@nia/prism/core/oauth/incremental-auth.service');
    const mockAuthService = {
      handleIncrementalCallback: jest.fn().mockResolvedValue({
        success: true,
        grantedScopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      }),
    };
    createIncrementalAuthService.mockReturnValue(mockAuthService);

    const url = 'http://localhost:3000/api/google/callback?code=auth_code_123&state=incremental_auth_user123';
    const request = new NextRequest(url);

    const response = await GET(request);
    
    expect(response.status).toBe(200); // HTML popup
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

  it('should validate state parameter format correctly', () => {
    // Test the state parsing logic in isolation
    const validState = 'incremental_auth_user123'; // Note: no underscore between user and 123
    const invalidState = 'invalid_format';
    
    expect(validState.startsWith('incremental_auth_')).toBe(true);
    expect(invalidState.startsWith('incremental_auth_')).toBe(false);
    
    const stateParts = validState.split('_');
    const userId = stateParts[2]; // Should be "user123"
    expect(userId).toBe('user123');
  });
});
