/**
 * @jest-environment node
 */

import { ResourceType } from '@nia/prism/core/blocks/resourceShareToken.block';
import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import type { IUser } from '@nia/prism/core/blocks/user.block';
import type { IUserOrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import type { IUserTenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';

import {
  createSharingOrganization,
  getUserSharedResources,
  shareResourceWithUser,
} from '../lib';

// Mock global fetch
global.fetch = jest.fn();

describe('ResourceSharing Actions', () => {
  const mockTenantId = 'tenant-123';
  const mockUserId = 'user-456';
  const mockResourceId = 'note-789';
  const mockOrgId = 'org-abc';
  const mockContentType = ResourceType.Notes;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createSharingOrganization', () => {
    it('should create organization via API and return organization', async () => {
      const mockOrg: IOrganization = {
        _id: mockOrgId,
        tenantId: mockTenantId,
        name: `Share:Note:${mockResourceId}`,
        description: 'Sharing organization for Note: Test Note',
        settings: {
          resourceSharing: true,
          resourceOwnerUserId: mockUserId,
        },
        sharedResources: {
          [mockResourceId]: mockContentType,
        },
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ organization: mockOrg }),
      });

      const result = await createSharingOrganization(
        mockResourceId,
        mockContentType,
        'Test Note',
        mockTenantId,
        mockUserId
      );

      expect(global.fetch).toHaveBeenCalledWith('/api/sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: mockResourceId,
          contentType: mockContentType,
          resourceTitle: 'Test Note',
          tenantId: mockTenantId,
        }),
      });

      expect(result).toEqual(mockOrg);
    });

    it('should throw error when API call fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Failed to create organization' }),
      });

      await expect(
        createSharingOrganization(
          mockResourceId,
          mockContentType,
          'Test Note',
          mockTenantId,
          mockUserId
        )
      ).rejects.toThrow('Failed to create organization');
    });
  });

  describe('getUserSharedResources', () => {
    it('should fetch shared resources for user', async () => {
      const mockResources = [
        {
          resourceId: mockResourceId,
          contentType: mockContentType,
          organization: {
            _id: mockOrgId,
            tenantId: mockTenantId,
            name: `Share:Note:${mockResourceId}`,
          } as IOrganization,
          role: OrganizationRole.MEMBER,
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockResources }),
      });

      const result = await getUserSharedResources(
        mockUserId,
        mockTenantId,
        mockContentType
      );

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/sharing?userId=${mockUserId}&tenantId=${mockTenantId}&contentType=${mockContentType}`
      );

      expect(result).toEqual(mockResources);
    });

    it('should fetch all shared resources when no contentType provided', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ data: [] }),
      });

      await getUserSharedResources(mockUserId, mockTenantId);

      expect(global.fetch).toHaveBeenCalledWith(
        `/api/sharing?userId=${mockUserId}&tenantId=${mockTenantId}`
      );
    });

    it('should throw error when API call fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Failed to fetch shared resources' }),
      });

      await expect(
        getUserSharedResources(mockUserId, mockTenantId)
      ).rejects.toThrow('Failed to fetch shared resources');
    });
  });

  describe('shareResourceWithUser', () => {
    it('should share resource with user via API', async () => {
      const mockUser: IUser = {
        _id: 'user-new',
        email: 'test@example.com',
        name: 'Test User',
      };

      const mockTenantRole: IUserTenantRole = {
        _id: 'tenant-role-123',
        userId: mockUser._id!,
        tenantId: mockTenantId,
        role: TenantRole.MEMBER,
      };

      const mockOrgRole: IUserOrganizationRole = {
        _id: 'org-role-123',
        userId: mockUser._id!,
        organizationId: mockOrgId,
        role: OrganizationRole.MEMBER,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({
          sharedUser: {
            user: mockUser,
            tenantRole: mockTenantRole,
            orgRole: mockOrgRole,
          },
        }),
      });

      const result = await shareResourceWithUser(
        mockResourceId,
        mockContentType,
        'test@example.com',
        'read-only',
        mockTenantId,
        mockUserId
      );

      expect(global.fetch).toHaveBeenCalledWith('/api/sharing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceId: mockResourceId,
          contentType: mockContentType,
          resourceTitle: mockResourceId,
          tenantId: mockTenantId,
          shareWithEmail: 'test@example.com',
          accessLevel: 'read-only',
        }),
      });

      expect(result).toEqual({
        user: mockUser,
        tenantRole: mockTenantRole,
        orgRole: mockOrgRole,
      });
    });

    it('should throw error when API call fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Failed to share resource' }),
      });

      await expect(
        shareResourceWithUser(
          mockResourceId,
          mockContentType,
          'test@example.com',
          'read-only',
          mockTenantId,
          mockUserId
        )
      ).rejects.toThrow('Failed to share resource');
    });

    it('should throw error when sharedUser is not returned', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ sharedUser: null }),
      });

      await expect(
        shareResourceWithUser(
          mockResourceId,
          mockContentType,
          'test@example.com',
          'read-only',
          mockTenantId,
          mockUserId
        )
      ).rejects.toThrow('Failed to share with user');
    });
  });
});
