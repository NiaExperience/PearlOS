import { assignUserToTenant, getUserTenantRoles, updateUserTenantRole, deleteUserTenantRole } from '../src/core/actions/tenant-actions';
import { createUser } from '../src/core/actions/user-actions';
import { IUser } from '../src/core/blocks/user.block';
import { TenantRole } from '../src/core/blocks/userTenantRole.block';
import { createTestTenant } from '../src/testing/testlib';


async function createAUser(name: string, email: string): Promise<IUser> {
  const userData: IUser = {
    name: name,
    email: email
  };
  return await createUser({...userData, password: 'securePassword123'});
}

describe('User-Tenant-Role Actions (shared)', () => {

  describe('assignUserToTenant', () => {
    it('should assign a user to a tenant with a specific role', async () => {
      const user = await createAUser('Role Assignment User', 'role-assignment@example.com');
              const tenant = await createTestTenant();
      if (!user._id || !tenant._id) {
        throw new Error('User or Tenant ID is not defined');
      }

      const result = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      expect(result._id).toBeTruthy();
      expect(result.userId).toEqual(user._id);
      expect(result.tenantId).toEqual(tenant._id);
      expect(result.role).toEqual(TenantRole.ADMIN);
    });

    it('should throw error when required parameters are missing', async () => {
      const user = await createAUser('Missing Param User', 'missing-param@example.com');
      const tenant = await createTestTenant();
      if (!user._id || !tenant._id) {
        throw new Error('User or Tenant ID is not defined');
      }

      // Test missing userId
      expect(assignUserToTenant('', tenant._id, TenantRole.MEMBER))
        .rejects.toThrow(Error('User ID is required'));

      // Test missing tenantId
      expect(assignUserToTenant(user._id, '', TenantRole.MEMBER))
        .rejects.toThrow(Error('Tenant ID is required'));

      // Test missing role
      expect(assignUserToTenant(user._id, tenant._id, '' as TenantRole))
        .rejects.toThrow(Error('Role is required'));

      // Test bad role
      expect(assignUserToTenant(user._id, tenant._id, 'darth-jarjar' as TenantRole))
        .rejects.toThrow(Error('Invalid role provided'));
    });
  });

  describe('getUserTenantRoles', () => {
    it('should return all tenant roles for a user', async () => {
      const user = await createAUser('Multi-Role User', 'multi-role@example.com');
      const tenant1 = await createTestTenant();
      const tenant2 = await createTestTenant();
      if (!user._id || !tenant1._id || !tenant2._id) {
        throw new Error('User or Tenant ID is not defined');
      }

      await assignUserToTenant(user._id, tenant1._id, TenantRole.OWNER);
      await assignUserToTenant(user._id, tenant2._id, TenantRole.MEMBER);

      const roles = await getUserTenantRoles(user._id);
      expect(roles && roles.length === 2).toBeTruthy();

      const tenantIds = roles ? roles.map(r => r.tenantId) : [];
      expect(tenantIds).toContain(tenant1._id);
      expect(tenantIds).toContain(tenant2._id);

      const userRoles = roles ? roles.map(r => r.role) : [];
      expect(userRoles).toContain(TenantRole.OWNER);
      expect(userRoles).toContain(TenantRole.MEMBER);
    });

    it('should return empty array when user has no roles', async () => {
      const user = await createAUser('No Role User', 'no-role@example.com');
      if (!user._id) {
        throw new Error('User ID is not defined');
      }

      const roles = await getUserTenantRoles(user._id);
      expect(roles).toEqual([]);
    });

    it('should throw error when userId is not provided', async () => {
      await expect(getUserTenantRoles('')).rejects.toThrow('User ID is required');
    });
  });

  describe('updateUserTenantRole', () => {
    it('should update a user\'s role in a tenant', async () => {
      const user = await createAUser('Update Role User', 'update-role@example.com');
      const tenant = await createTestTenant();
      if (!user._id || !tenant._id) {
        throw new Error('User or Tenant ID is not defined');
      }

      // First assign the user as a member
      const initialRole = await assignUserToTenant(user._id, tenant._id, TenantRole.MEMBER);

      // Then update to admin
      const updatedRole = await updateUserTenantRole(user._id, tenant._id, TenantRole.ADMIN);

      expect(updatedRole._id).toEqual(initialRole._id);
      expect(updatedRole.role).toEqual(TenantRole.ADMIN);
      expect(updatedRole.userId).toEqual(user._id);
      expect(updatedRole.tenantId).toEqual(tenant._id);
    });
  });

  describe('deleteUserTenantRole', () => {
    it('should delete a user\'s role in a tenant (not last protected role)', async () => {
      const owner = await createAUser('Owner User', 'owner-delete-role@example.com');
      const admin = await createAUser('Delete Role User', 'delete-role@example.com');
      const tenant = await createTestTenant();

      if (!owner._id || !admin._id || !tenant._id) {
        throw new Error('User or Tenant ID is not defined');
      }

      // Seed an OWNER so that deactivating an ADMIN is allowed
      await assignUserToTenant(owner._id, tenant._id, TenantRole.OWNER);
      const initialRole = await assignUserToTenant(admin._id, tenant._id, TenantRole.ADMIN);
      const deletedRole = await deleteUserTenantRole(admin._id, tenant._id);
      expect(deletedRole._id).toEqual(initialRole._id);
    });
  });
});