/**
 * @jest-environment node
 * 
 * Comprehensive test suite for Prism Auth Middleware
 * 
 * Tests the core authentication and authorization middleware functions
 * that secure API access across the platform.
 */

import { NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import {
  requireAuth,
  requireTenantAccess,
  requireTenantAdmin,
  requireOrgAccess
} from '../src/core/auth/auth.middleware';
import * as getSessionSafelyModule from '../src/core/auth/getSessionSafely';

// Mock NextResponse
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((data, init) => ({ 
      data, 
      init,
      status: init?.status || 200,
      json: () => Promise.resolve(data)
    }))
  }
}));

// Mock getSessionSafely
jest.mock('../src/core/auth/getSessionSafely');

const mockGetSessionSafely = getSessionSafelyModule.getSessionSafely as jest.MockedFunction<typeof getSessionSafelyModule.getSessionSafely>;

describe('Auth Middleware', () => {
  const mockAuthOptions: NextAuthOptions = {
    providers: [],
    secret: 'test-secret'
  };

  const mockRequest = {
    headers: new Map([
      ['x-test-user-id', 'test-user-123'],
      ['authorization', 'Bearer test-token']
    ])
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('requireAuth', () => {
    it('should return null when user is authenticated', async () => {
      // Mock authenticated session
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          email: 'test@example.com',
          is_anonymous: false
        } as any
      });

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).toBeNull();
      expect(mockGetSessionSafely).toHaveBeenCalledWith(mockRequest, mockAuthOptions);
    });

    it('should return 401 when session is null', async () => {
      mockGetSessionSafely.mockResolvedValue(null);

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Unauthorized" },
        { status: 401 }
      );
    });

    it('should return 401 when session user is null', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: null
      } as any);

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 401 when session user is undefined', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: undefined
      } as any);

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 401 when user is anonymous', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'anon-user-123',
          is_anonymous: true
        } as any
      });

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Unauthorized" },
        { status: 401 }
      );
    });

    it('should work without authOptions parameter', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireAuth(mockRequest);

      expect(result).toBeNull();
      expect(mockGetSessionSafely).toHaveBeenCalledWith(mockRequest, undefined);
    });

    it('should work without request parameter', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireAuth();

      expect(result).toBeNull();
      expect(mockGetSessionSafely).toHaveBeenCalledWith(undefined, undefined);
    });

    it('should handle getSessionSafely throwing an error', async () => {
      mockGetSessionSafely.mockRejectedValue(new Error('Session error'));

      // The function should propagate the error since it doesn't have try/catch
      await expect(requireAuth(mockRequest, mockAuthOptions)).rejects.toThrow('Session error');
    });
  });

  describe('requireTenantAccess', () => {
    const tenantId = 'tenant-123';

    it('should return 401 when user is not authenticated', async () => {
      mockGetSessionSafely.mockResolvedValue(null);

      const result = await requireTenantAccess(tenantId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Unauthorized" },
        { status: 401 }
      );
    });

    it('should return 401 when user is anonymous', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'anon-user-123',
          is_anonymous: true
        } as any
      });

      const result = await requireTenantAccess(tenantId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 403 when user has no tenant access (TODO implementation)', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireTenantAccess(tenantId, mockRequest, mockAuthOptions);

      // Currently always returns 403 due to TODO implementation
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Forbidden: User has no access to this tenant" },
        { status: 403 }
      );
    });

    it('should work with different tenant IDs', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result1 = await requireTenantAccess('tenant-456', mockRequest, mockAuthOptions);
      const result2 = await requireTenantAccess('tenant-789', mockRequest, mockAuthOptions);

      expect(result1!.status).toBe(403);
      expect(result2!.status).toBe(403);
    });

    it('should handle empty tenant ID', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireTenantAccess('', mockRequest, mockAuthOptions);

      expect(result!.status).toBe(403);
    });
  });

  describe('requireTenantAdmin', () => {
    const tenantId = 'tenant-123';

    it('should return 401 when user is not authenticated', async () => {
      mockGetSessionSafely.mockResolvedValue(null);

      const result = await requireTenantAdmin(tenantId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Unauthorized" },
        { status: 401 }
      );
    });

    it('should return 401 when user is anonymous', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'anon-user-123',
          is_anonymous: true
        } as any
      });

      const result = await requireTenantAdmin(tenantId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 403 when user is not admin (TODO implementation)', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireTenantAdmin(tenantId, mockRequest, mockAuthOptions);

      // Currently always returns 403 due to TODO implementation
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Forbidden: Admin access required" },
        { status: 403 }
      );
    });

    it('should work with different tenant IDs', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result1 = await requireTenantAdmin('admin-tenant-1', mockRequest, mockAuthOptions);
      const result2 = await requireTenantAdmin('admin-tenant-2', mockRequest, mockAuthOptions);

      expect(result1!.status).toBe(403);
      expect(result2!.status).toBe(403);
    });
  });

  describe('requireOrgAccess', () => {
    const organizationId = 'org-123';

    it('should return 401 when user is not authenticated', async () => {
      mockGetSessionSafely.mockResolvedValue(null);

      const result = await requireOrgAccess(organizationId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Unauthorized" },
        { status: 401 }
      );
    });

    it('should return 401 when user is anonymous', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'anon-user-123',
          is_anonymous: true
        } as any
      });

      const result = await requireOrgAccess(organizationId, mockRequest, mockAuthOptions);

      expect(result).not.toBeNull();
      expect(result!.status).toBe(401);
    });

    it('should return 403 when user has no organization access (TODO implementation)', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireOrgAccess(organizationId, mockRequest, mockAuthOptions);

      // Currently always returns 403 due to TODO implementation
      expect(result).not.toBeNull();
      expect(result!.status).toBe(403);
      expect(NextResponse.json).toHaveBeenCalledWith(
        { error: "Forbidden: No access to this organization" },
        { status: 403 }
      );
    });

    it('should work with different organization IDs', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result1 = await requireOrgAccess('org-456', mockRequest, mockAuthOptions);
      const result2 = await requireOrgAccess('org-789', mockRequest, mockAuthOptions);

      expect(result1!.status).toBe(403);
      expect(result2!.status).toBe(403);
    });

    it('should handle empty organization ID', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const result = await requireOrgAccess('', mockRequest, mockAuthOptions);

      expect(result!.status).toBe(403);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed session objects', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          // Missing id, but has email which is standard
          email: 'test@example.com',
          is_anonymous: false
        }
      } as any);

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).toBeNull(); // Should still pass auth since user exists and is not anonymous
    });

    it('should handle session with extra properties', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          email: 'test@example.com',
          name: 'Test User',
          is_anonymous: false,
          extra_property: 'some-value'
        } as any,
        expires: '2024-12-31'
      });

      const result = await requireAuth(mockRequest, mockAuthOptions);

      expect(result).toBeNull();
    });

    it('should handle concurrent authentication checks', async () => {
      mockGetSessionSafely.mockResolvedValue({
        user: {
          id: 'test-user-123',
          is_anonymous: false
        } as any
      });

      const promises = [
        requireAuth(mockRequest, mockAuthOptions),
        requireTenantAccess('tenant-1', mockRequest, mockAuthOptions),
        requireTenantAdmin('tenant-2', mockRequest, mockAuthOptions),
        requireOrgAccess('org-1', mockRequest, mockAuthOptions)
      ];

      const results = await Promise.all(promises);

      // Auth should pass, others should fail due to TODO implementations
      expect(results[0]).toBeNull();
      expect(results[1]!.status).toBe(403);
      expect(results[2]!.status).toBe(403);
      expect(results[3]!.status).toBe(403);
    });

    it('should handle session timeout during check', async () => {
      mockGetSessionSafely
        .mockResolvedValueOnce({
          user: { id: 'test-user-123', is_anonymous: false } as any
        })
        .mockResolvedValueOnce(null); // Session expired

      const result1 = await requireAuth(mockRequest, mockAuthOptions);
      const result2 = await requireAuth(mockRequest, mockAuthOptions);

      expect(result1).toBeNull();
      expect(result2!.status).toBe(401);
    });

    it('should handle different authentication states for different middleware', async () => {
      // Test sequence: authenticated -> anonymous -> null session
      mockGetSessionSafely
        .mockResolvedValueOnce({
          user: { id: 'test-user-123', is_anonymous: false } as any
        })
        .mockResolvedValueOnce({
          user: { id: 'anon-user-456', is_anonymous: true } as any
        })
        .mockResolvedValueOnce(null);

      const result1 = await requireAuth(mockRequest, mockAuthOptions);
      const result2 = await requireTenantAccess('tenant-123', mockRequest, mockAuthOptions);
      const result3 = await requireOrgAccess('org-123', mockRequest, mockAuthOptions);

      expect(result1).toBeNull(); // Authenticated user passes
      expect(result2!.status).toBe(401); // Anonymous user fails
      expect(result3!.status).toBe(401); // Null session fails
    });
  });
});
