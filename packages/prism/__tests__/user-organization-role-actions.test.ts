import { v4 as uuidv4 } from 'uuid';

import { createOrganization, assignUserToOrganization, getUserOrganizationRoles, updateUserOrganizationRole, deleteUserOrganizationRole } from '../src/core/actions/organization-actions';
import { assignUserToTenant } from '../src/core/actions/tenant-actions';
import { createUser } from '../src/core/actions/user-actions';
import { IOrganization } from '../src/core/blocks/organization.block';
import { IUser } from '../src/core/blocks/user.block';
import { OrganizationRole } from '../src/core/blocks/userOrganizationRole.block';
import { TenantRole } from '../src/core/blocks/userTenantRole.block';
import { createTestTenant } from '../src/testing/testlib';


async function createAUser(name: string, email: string): Promise<IUser> {
  const userData: IUser = {
    name: name,
    email: email
  };
  return await createUser({...userData, password: 'securePassword123'});
}

async function createAnOrganization(name: string, tenantId: string): Promise<IOrganization> {
  const orgData: IOrganization = {
    name: name,
    tenantId: tenantId,
    description: 'An organization for testing'
  };
  return await createOrganization(orgData);
}

describe('User-Organization-Role Actions (shared)', () => {

  describe('assignUserToOrganization', () => {
    it('should assign a user to an organization with a specific role', async () => {
      const tenant = await createTestTenant({name:`Org Role Assignment Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createAnOrganization(`Role Assignment Org ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Org Role User ${uuidv4()}`, `org-role-${uuidv4()}@example.com`);
      if (!org._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      if (!assign._id) {
        throw new Error('User assignment to tenant failed');
      }

      const result = await assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.ADMIN);
      expect(result._id).toBeTruthy();
      expect(result.userId).toEqual(user._id);
      expect(result.organizationId).toEqual(org._id);
      expect(result.role).toEqual(OrganizationRole.ADMIN);
    });

    it('should throw error when required parameters are missing', async () => {
      const tenant = await createTestTenant({name:`Missing Org Param Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createAnOrganization(`Missing Org Param Org ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Missing Org Param User ${uuidv4()}`, `missing-org-param-${uuidv4()}@example.com`);
      if (!org._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      if (!assign._id) {
        throw new Error('User assignment to tenant failed');
      }
      // Test missing userId
      await expect(assignUserToOrganization('', org._id, tenant._id, OrganizationRole.MEMBER))
        .rejects.toThrow('userId, organizationId, and role are required');

      // Test missing organizationId
      await expect(assignUserToOrganization(user._id, '', tenant._id, OrganizationRole.MEMBER))
        .rejects.toThrow('userId, organizationId, and role are required');
    });

    it('should throw error for invalid user or organization', async () => {
      const tenant = await createTestTenant({name:`Invalid Org Assignment Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createAnOrganization(`Invalid Org Assignment Org ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Valid Org User ${uuidv4()}`, `valid-org-user-${uuidv4()}@example.com`);
      if (!org._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      // Test invalid user ID
      await expect(assignUserToOrganization('invalid-user-id', org._id, tenant._id, OrganizationRole.MEMBER))
        .rejects.toThrow('Invalid userId format');

      // Test invalid organization ID
      await expect(assignUserToOrganization(user._id, 'invalid-org-id', tenant._id, OrganizationRole.MEMBER))
        .rejects.toThrow('Invalid organizationId format');
    });
  });

  describe('getUserOrganizationRoles', () => {
    it('should return all organization roles for a user', async () => {
      const tenant = await createTestTenant({name:`Multi-Org Role Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org1 = await createAnOrganization(`User Org 1 ${uuidv4()}`, tenant._id);
      const org2 = await createAnOrganization(`User Org 2 ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Multi-Org Role User ${uuidv4()}`, `multi-org-role-${uuidv4()}@example.com`);
      if (!org1._id || !org2._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      if (!assign._id) {
        throw new Error('User assignment to tenant failed');
      }

      await assignUserToOrganization(user._id, org1._id, tenant._id, OrganizationRole.ADMIN);
      await assignUserToOrganization(user._id, org2._id, tenant._id, OrganizationRole.VIEWER);

      const roles = await getUserOrganizationRoles(user._id, tenant._id) || [];
      expect(roles.length).toEqual(2);
      
      const orgIds = roles.map(r => r.organizationId);
      expect(orgIds).toContain(org1._id);
      expect(orgIds).toContain(org2._id);
      
      const userRoles = roles.map(r => r.role);
      expect(userRoles).toContain(OrganizationRole.ADMIN);
      expect(userRoles).toContain(OrganizationRole.VIEWER);
    });

    it('should return empty array when user has no organization roles', async () => {
      const tenant = await createTestTenant({name:`No Role Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createAUser(`No Org Role User ${uuidv4()}`, `no-org-role-${uuidv4()}@example.com`);
      if (!user._id) {
        throw new Error('User ID is not defined');
      }
      const roles = await getUserOrganizationRoles(user._id, tenant._id);
      expect(roles).toEqual([]);
    });

    it('should throw error when userId is not provided', async () => {
      const tenant = await createTestTenant({name:`No Role Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      await expect(getUserOrganizationRoles('', tenant._id)).rejects.toThrow('User ID is required');
    });
  });

  describe('updateUserOrganizationRole', () => {
    it('should update a user\'s role in an organization', async () => {
      const tenant = await createTestTenant({name:`Update Org Role Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createAnOrganization(`Update Org Role Org ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Update Org Role User ${uuidv4()}`, `update-org-role-${uuidv4()}@example.com`);
      if (!org._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      if (!assign._id) {
        throw new Error('User assignment to tenant failed');
      }

      // First assign the user as a viewer
      const initialRole = await assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.VIEWER);
      if (!initialRole._id) {
        throw new Error('Initial role assignment failed');
      }

      // Then update to admin
      const updatedRole = await updateUserOrganizationRole(initialRole._id, tenant._id, OrganizationRole.ADMIN);

      expect(updatedRole._id).toEqual(initialRole._id);
      expect(updatedRole.role).toEqual(OrganizationRole.ADMIN);
      expect(updatedRole.userId).toEqual(user._id);
      expect(updatedRole.organizationId).toEqual(org._id);
    });
  });

  describe('deleteUserOrganizationRole', () => {
    it('should delete a user\'s role in an organization', async () => {
      const tenant = await createTestTenant({name:`Delete Org Role Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createAnOrganization(`Delete Org Role Org ${uuidv4()}`, tenant._id);
      const user = await createAUser(`Delete Org Role User ${uuidv4()}`, `delete-org-role-${uuidv4()}@example.com`);
      if (!org._id || !user._id) {
        throw new Error('Organization or User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.ADMIN);
      if (!assign._id) {
        throw new Error('User assignment to tenant failed');
      }

      // First assign the user
      const initialRole = await assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.MEMBER);
      if (!initialRole._id) {
        throw new Error('Initial role assignment failed');
      }
      // Then delete
      const deletedRole = await deleteUserOrganizationRole(initialRole._id, tenant._id,);
      expect(deletedRole._id).toEqual(initialRole._id);
    });
  });
});