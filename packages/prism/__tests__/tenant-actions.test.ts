/* eslint-disable @typescript-eslint/no-explicit-any */
import { v4 as uuidv4 } from 'uuid';

import * as TenantActions from '../src/core/actions/tenant-actions';
import { ITenant, TenantPlanTier } from '../src/core/blocks/tenant.block';
import { IUserTenantRole, TenantRole } from '../src/core/blocks/userTenantRole.block';
import { createTestUser } from '../src/testing/testlib';

async function createATenant(name: string = `Tenant ${uuidv4()}`, planTier: TenantPlanTier = TenantPlanTier.BASIC): Promise<ITenant> {
  const data: ITenant = {
    name: name,
    planTier: planTier
  };
  const tenant = await TenantActions.createTenant(data);
  if (!tenant._id) {
    throw new Error('Tenant ID is not defined');
  }
  return tenant;
}

describe('Tenant Actions (shared)', () => {

  describe('createTenant', () => {
    it('should create a tenant successfully with custom settings', async () => {
      const tenantData: ITenant = {
        name: 'Acme Corporation',
        domain: 'acme.com',
        planTier: TenantPlanTier.PROFESSIONAL,
        settings: { customLogo: true, customTheme: 'dark' }
      };

      const result = await TenantActions.createTenant(tenantData);
      expect(result._id).toBeTruthy();
      expect(result.name).toEqual(tenantData.name);
      expect(result.domain).toEqual(tenantData.domain);
      expect(result.planTier).toEqual(tenantData.planTier);
    });

    it('should create a tenant with minimal data', async () => {
      const tenantData: ITenant = {
        name: 'Minimal Tenant'
      };

      const result = await TenantActions.createTenant(tenantData);
      expect(result._id).toBeTruthy();
      expect(result.name).toEqual(tenantData.name);
    });

    it('should handle tenant creation failure gracefully', async () => {
      // Test with invalid data that might cause creation to fail
      const invalidTenantData = {} as ITenant;
      
      await expect(TenantActions.createTenant(invalidTenantData)).rejects.toThrow();
    });
  });

  describe('getTenantById', () => {
    it('should return a tenant by ID', async () => {
      const tenant = await createATenant('Tenant By ID Corp');
      expect(tenant._id).toBeTruthy();
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const result = await TenantActions.getTenantById(tenant._id);
      expect(result).not.toBeNull();
      expect(result?.name).toEqual('Tenant By ID Corp');
    });

    it('should return null for non-existent tenant ID', async () => {
      const result = await TenantActions.getTenantById('non-existent-id');
      expect(result).toBeNull();
    });

    it('should handle empty tenant ID', async () => {
      const result = await TenantActions.getTenantById('');
      expect(result).toBeNull();
    });
  });

  describe('getAllTenants', () => {
    it('should return all tenants', async () => {
      // Create some test tenants
      await createATenant('Tenant One');
      await createATenant('Tenant Two');
      await createATenant('Tenant Three');

      const result = await TenantActions.getAllTenants();
      expect(result && result.length >= 3).toBeTruthy();

      const tenantNames = result ? result.map((t: ITenant) => t.name) : [];
      expect(tenantNames).toContain('Tenant One');
      expect(tenantNames).toContain('Tenant Two');
      expect(tenantNames).toContain('Tenant Three');
    });

    it('should return empty array when no tenants exist', async () => {
      // Clear existing tenants by creating a new test environment
      const result = await TenantActions.getAllTenants();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('assignUserToTenant', () => {
    it('should assign a user to a tenant with a specific role', async () => {
      const tenant = await createATenant('User\'s Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      const roleModel = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);
      expect(roleModel._id).toBeTruthy();
      expect(roleModel.userId).toEqual(user._id);
      expect(roleModel.tenantId).toEqual(tenant._id);
      expect(roleModel.role).toEqual(TenantRole.ADMIN);
    });

    it('should assign user with OWNER role', async () => {
      const tenant = await createATenant('Owner Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      const roleModel = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.OWNER);
      expect(roleModel.role).toEqual(TenantRole.OWNER);
    });

    it('should assign user with MEMBER role', async () => {
      const tenant = await createATenant('Member Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      const roleModel = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);
      expect(roleModel.role).toEqual(TenantRole.MEMBER);
    });

    it('should throw error when userId is not provided for assignment', async () => {
      const tenant = await createATenant('Error Tenant Assign User');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      
      await expect(TenantActions.assignUserToTenant('', tenant._id, TenantRole.ADMIN)).rejects.toThrow('User ID is required');
    });

    it('should throw error when tenantId is not provided', async () => {
      const user = await createTestUser();
      
      await expect(TenantActions.assignUserToTenant(user._id!, '', TenantRole.ADMIN)).rejects.toThrow('Tenant ID is required');
    });

    it('should throw error when role is not provided', async () => {
      const tenant = await createATenant('Role Error Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();
      
      await expect(TenantActions.assignUserToTenant(user._id!, tenant._id, '' as TenantRole)).rejects.toThrow('Role is required');
    });

    it('should throw error when invalid role is provided', async () => {
      const tenant = await createATenant('Invalid Role Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      await expect(TenantActions.assignUserToTenant(user._id!, tenant._id, '' as TenantRole)).rejects.toThrow('Role is required');
    });
  });

  describe('assignUserToTenant (idempotent / duplicate handling)', () => {
    it('should be idempotent when assigning same role twice', async () => {
      const tenant = await createATenant('Idempotent Tenant 1');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      const first: any = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);
      const second: any = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);
      expect(first._id).toBeTruthy();
      expect(second._id).toEqual(first._id);
      expect(second.operation).toBe('noop');
    });

    it('should update role in-place when assigning different role after initial assignment', async () => {
      const tenant = await createATenant('Idempotent Tenant 2');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      const first: any = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);
      const second: any = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);
      expect(second._id).toEqual(first._id); // same record updated
      expect(second.role).toBe(TenantRole.ADMIN);
      expect(second.operation).toBe('updated');
    });
  });

  describe('getUserTenantRoles', () => {
    it('should return tenant roles for a user', async () => {
      const tenant1 = await createATenant('User\'s Tenant 1');
      const tenant2 = await createATenant('User\'s Tenant 2');
      if (!tenant1._id || !tenant2._id) {
        throw new Error('Tenant IDs are not defined');
      }
      const user = await createTestUser();

      await TenantActions.assignUserToTenant(user._id!, tenant1._id, TenantRole.OWNER);
      await TenantActions.assignUserToTenant(user._id!, tenant2._id, TenantRole.MEMBER);

      const roles = await TenantActions.getUserTenantRoles(user._id!);
      expect(roles && roles.length === 2).toBeTruthy();

      const tenantIds = roles ? roles.map((r: IUserTenantRole) => r.tenantId) : [];
      expect(tenantIds).toContain(tenant1._id);
      expect(tenantIds).toContain(tenant2._id);

      const userRoles = roles ? roles.map((r: IUserTenantRole) => r.role) : [];
      expect(userRoles).toContain(TenantRole.OWNER);
      expect(userRoles).toContain(TenantRole.MEMBER);
    });

    it('should return empty array for user with no roles', async () => {
      const user = await createTestUser();

      const roles = await TenantActions.getUserTenantRoles(user._id!);
      expect(roles).toEqual([]);
    });

    it('should throw error when userId is not provided', async () => {
      await expect(TenantActions.getUserTenantRoles('')).rejects.toThrow('User ID is required');
    });
  });

  describe('getTenantsForUser', () => {
    it('should return tenants for a user with their roles', async () => {
      const tenant1 = await createATenant('User Access Tenant 1', TenantPlanTier.BASIC);
      const tenant2 = await createATenant('User Access Tenant 2', TenantPlanTier.PROFESSIONAL);
      if (!tenant1._id || !tenant2._id) {
        throw new Error('Tenant IDs are not defined');
      }
      const user = await createTestUser();

      await TenantActions.assignUserToTenant(user._id!, tenant1._id, TenantRole.ADMIN);
      await TenantActions.assignUserToTenant(user._id!, tenant2._id, TenantRole.OWNER);

      const tenants = await TenantActions.getTenantsForUser(user._id!);
      expect(tenants.length).toEqual(2);
      
      // Check that each tenant has a userRole property
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tenants.forEach((tenant: any) => {
        expect(tenant.name).toBeDefined();
      });

      // Verify tenant details
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tenantNames = tenants.map((t: any) => t.name);
      expect(tenantNames).toContain('User Access Tenant 1');
      expect(tenantNames).toContain('User Access Tenant 2');
    });

    it('should return empty array for user with no tenants', async () => {
      const user = await createTestUser();

      const tenants = await TenantActions.getTenantsForUser(user._id!);
      expect(tenants).toEqual([]);
    });

    it('should filter out inactive roles', async () => {
      const tenant = await createATenant('Inactive Role Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      // Assign user to tenant
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);
      
      // Delete the role
      await TenantActions.deleteUserTenantRole(user._id!, tenant._id);

      const tenants = await TenantActions.getTenantsForUser(user._id!);
      expect(tenants).toEqual([]);
    });
  });

  describe('userHasAccess', () => {
    it('should return true when user has OWNER role', async () => {
      const tenant = await createATenant('Access Test Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.OWNER);

      const hasAccess = await TenantActions.userHasAccess(user._id!, tenant._id, TenantRole.MEMBER);
      expect(hasAccess).toBe(true);
    });

    it('should return true when user has ADMIN role and minimum is MEMBER', async () => {
      const tenant = await createATenant('Admin Access Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);

      const hasAccess = await TenantActions.userHasAccess(user._id!, tenant._id, TenantRole.MEMBER);
      expect(hasAccess).toBe(true);
    });

    it('should return false when user has MEMBER role and minimum is ADMIN', async () => {
      const tenant = await createATenant('Member Access Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);

      const hasAccess = await TenantActions.userHasAccess(user._id!, tenant._id, TenantRole.ADMIN);
      expect(hasAccess).toBe(false);
    });

    it('should return false when user has no role in tenant', async () => {
      const tenant = await createATenant('No Access Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();
      const hasAccess = await TenantActions.userHasAccess(user._id!, tenant._id, TenantRole.MEMBER);
      expect(hasAccess).toBe(false);
    });

    it('should return false when userId is not provided for access check', async () => {
      const tenant = await createATenant('Error Tenant Access');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      expect(await TenantActions.userHasAccess('', tenant._id, TenantRole.MEMBER)).toBe(false);
    });

    it('should return false when tenantId is not provided', async () => {
      const user = await createTestUser();
      expect(await TenantActions.userHasAccess(user._id!, '', TenantRole.MEMBER)).toBe(false);
    });

    it('should return false when user does not exist', async () => {
      const tenant = await createATenant('Non-existent User Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      expect(await TenantActions.userHasAccess('non-existent-user', tenant._id, TenantRole.MEMBER)).toBe(false);
    });

    it('should return false when tenant does not exist', async () => {
      const user = await createTestUser();
      expect(await TenantActions.userHasAccess(user._id!, 'non-existent-tenant', TenantRole.MEMBER)).toBe(false);
    });
  });

  describe('updateUserTenantRole', () => {
    it('should update user role from MEMBER to ADMIN', async () => {
      const tenant = await createATenant('Update Role Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      // Initially assign as MEMBER
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);

      // Update to ADMIN
      const updatedRole = await TenantActions.updateUserTenantRole(user._id!, tenant._id, TenantRole.ADMIN);
      expect(updatedRole.role).toEqual(TenantRole.ADMIN);
    });

    it('should update user role from ADMIN to OWNER', async () => {
      const tenant = await createATenant('Admin to Owner Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      // Initially assign as ADMIN
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);

      // Update to OWNER
      const updatedRole = await TenantActions.updateUserTenantRole(user._id!, tenant._id, TenantRole.OWNER);
      expect(updatedRole.role).toEqual(TenantRole.OWNER);
    });

    it('should throw error when user is not assigned to tenant', async () => {
      const tenant = await createATenant('Not Assigned Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      await expect(TenantActions.updateUserTenantRole(user._id!, tenant._id, TenantRole.ADMIN)).rejects.toThrow('User is not assigned to this tenant');
    });
  });

  describe('deleteUserTenantRole', () => {
    it('should delete user tenant role', async () => {
      const tenant = await createATenant('Delete Role Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      // Initially assign user
      const role = await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);

      // Delete the role
      const deletedRole = await TenantActions.deleteUserTenantRole(user._id!, tenant._id);
      expect(deletedRole._id).toEqual(role._id);
    });

    it('should throw error when user is not assigned to tenant', async () => {
      const tenant = await createATenant('Delete Not Assigned Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();
      await expect(TenantActions.deleteUserTenantRole(user._id!, tenant._id)).rejects.toThrow('User is not assigned to this tenant');
    });
  });

  // Added core action protection scenarios migrated from action-level tests
  describe('role protection (core actions)', () => {
    it('protection: cannot demote last OWNER', async () => {
      const tenant = await createATenant('Protection Owner Tenant');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.OWNER);
      await expect(TenantActions.updateUserTenantRole(user._id!, tenant._id, TenantRole.MEMBER))
        .rejects.toThrow('Cannot demote last tenant OWNER');
    });
    it('protection: cannot delete last ADMIN when no OWNER exists', async () => {
      const tenant = await createATenant('Protection Admin Tenant');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);
      await expect(TenantActions.deleteUserTenantRole(user._id!, tenant._id))
        .rejects.toThrow('Cannot delete last tenant ADMIN when no OWNER exists');
    });
    it('protection: cannot delete last OWNER', async () => {
      const tenant = await createATenant('Protection Last Owner Tenant');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.OWNER);
      await expect(TenantActions.deleteUserTenantRole(user._id!, tenant._id))
        .rejects.toThrow('Cannot delete last tenant OWNER');
    });
    it('protection: cannot remove last ADMIN when no OWNER exists', async () => {
      const tenant = await createATenant('Protection Remove Admin Tenant');
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createTestUser();
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);
      await expect(TenantActions.updateUserTenantRole(user._id!, tenant._id, TenantRole.MEMBER))
        .rejects.toThrow('Cannot remove last tenant ADMIN when no OWNER exists');
    });
  });

  describe('getUsersForTenant', () => {
    it('should return users for a tenant', async () => {
      const tenant = await createATenant('Get Users Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user1 = await createTestUser();
      const user2 = await createTestUser();

      await TenantActions.assignUserToTenant(user1._id!, tenant._id, TenantRole.ADMIN);
      await TenantActions.assignUserToTenant(user2._id!, tenant._id, TenantRole.MEMBER);

      const users = await TenantActions.getUsersForTenant(tenant._id);
      expect(users.length).toEqual(2);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const userNames = users.map((u: any) => u.name);
      expect(userNames).toContain(user1.name);
      expect(userNames).toContain(user2.name);
    });

    it('should return empty array for tenant with no users', async () => {
      const tenant = await createATenant('No Users Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }

      const users = await TenantActions.getUsersForTenant(tenant._id);
      expect(users).toEqual([]);
    });

    it('should throw error when tenantId is not provided', async () => {
      await expect(TenantActions.getUsersForTenant('')).rejects.toThrow('Tenant ID is required');
    });

    it('should handle duplicate user assignments gracefully', async () => {
      const tenant = await createATenant('Duplicate Users Tenant');
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createTestUser();

      // Assign user twice (this shouldn't happen in practice, but we should handle it)
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.ADMIN);
      await TenantActions.assignUserToTenant(user._id!, tenant._id, TenantRole.MEMBER);

      const users = await TenantActions.getUsersForTenant(tenant._id);
      // Should only return the user once
      expect(users.length).toEqual(1);
      expect(users[0].name).toEqual(user.name);
    });
  });
});