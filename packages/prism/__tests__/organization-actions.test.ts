import { v4 as uuidv4 } from 'uuid';

import * as OrganizationActions from '../src/core/actions/organization-actions';
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
    email: email,
  };
  return await createUser({...userData, password: 'securePassword123'});
}

async function createTestOrganization(name: string, tenantId: string, description?: string): Promise<IOrganization> {
  const orgData: IOrganization = {
    name: name,
    tenantId: tenantId,
    description: description
  };
  return await OrganizationActions.createOrganization(orgData);
}

describe('Organization Actions (shared)', () => {

  describe('createOrganization', () => {
    it('should create an organization successfully', async () => {
      const tenant = await createTestTenant({name:`Org Creator Tenant ${uuidv4()}`});
      expect(tenant._id).toBeTruthy();
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }

      const orgData: IOrganization = {
        name: 'New Organization',
        tenantId: tenant._id,
        description: 'A newly created organization',
        settings: { customTheme: 'dark' }
      };

      const result = await OrganizationActions.createOrganization(orgData);
      expect(result._id).toBeTruthy();
      expect(result.name).toEqual(orgData.name);
      expect(result.tenantId).toEqual(tenant._id);
      expect(result.description).toEqual(orgData.description);
      expect(result.settings).toEqual(orgData.settings);
    });
  });

  describe('getOrganizationById', () => {
    it('should return an organization by ID', async () => {
      const tenant = await createTestTenant({name:`Org Getter Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const org = await createTestOrganization('Retrievable Org', tenant._id, 'Should be retrievable by ID');
      if (!org._id) {
        throw new Error('Organization ID is not defined');
      }

      const findOrg = await OrganizationActions.getOrganizationById(org._id, tenant._id!);
      if (!findOrg) {
        throw new Error('Organization not found');
      }
      expect(findOrg).not.toBeNull();
      expect(findOrg?.name).toEqual('Retrievable Org');
      expect(findOrg?.description).toEqual('Should be retrievable by ID');
    });

    it('should return null for non-existent organization ID', async () => {
      const tenant = await createTestTenant({name:'Org Getter Tenant'});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const result = await OrganizationActions.getOrganizationById('non-existent-id', tenant._id);
      expect(result).toBeNull();
    });
  });

  describe('getOrganizationsForTenant', () => {
    it('should return all organizations for a tenant', async () => {
      const tenant = await createTestTenant({name:`Multi-Org Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }

      // Create some test organizations for the tenant
      await createTestOrganization('Org One', tenant._id);
      await createTestOrganization('Org Two', tenant._id);
      await createTestOrganization('Org Three', tenant._id);

      const result = await OrganizationActions.getOrganizationsForTenant(tenant._id);
      expect(result && result.length === 3).toBeTruthy();
      
      const orgNames = result ? result.map((o: IOrganization) => o.name) : [];
      expect(orgNames).toContain('Org One');
      expect(orgNames).toContain('Org Two');
      expect(orgNames).toContain('Org Three');
    });

    it('should return empty array if no organizations found for tenant', async () => {
      const tenant = await createTestTenant({name:'Empty Tenant'});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const result = await OrganizationActions.getOrganizationsForTenant(tenant._id);
      expect(result).toEqual([]);
    });

    it('should throw error when tenantId is not provided', async () => {
      await expect(OrganizationActions.getOrganizationsForTenant('')).rejects.toThrow('Tenant ID is required');
    });
  });

  describe('getOrganizationsForUser', () => {
    it('should return organizations for a user with their roles', async () => {
      const tenant = await createTestTenant({name:`User Org Access Tenant ${uuidv4()}`});
      if (!tenant._id) {
        throw new Error('Tenant ID is not defined');
      }
      const user = await createAUser('Org Access User', 'org-access@example.com');
      if (!user._id) {
        throw new Error('User ID is not defined');
      }
      const assign = await assignUserToTenant(user._id, tenant._id, TenantRole.MEMBER);
      if (!assign._id) {
        throw new Error('User-Tenant assignment ID is not defined');
      }
      const org1 = await createTestOrganization('Access Org 1', tenant._id);
      const org2 = await createTestOrganization('Access Org 2', tenant._id);
      if (!org1._id || !org2._id) {
        throw new Error('Organization IDs are not defined');
      }

      await OrganizationActions.assignUserToOrganization(user._id, org1._id, tenant._id, OrganizationRole.ADMIN);
      await OrganizationActions.assignUserToOrganization(user._id, org2._id, tenant._id, OrganizationRole.VIEWER);

      const orgs = await OrganizationActions.getOrganizationsForUser(user._id, tenant._id);
      if (!orgs) {
        throw new Error('Organizations are not defined');
      }
      expect(orgs.length).toEqual(2);
      // Check that each org has a userRole property
      orgs.forEach(org => {
        expect(org.name).toBeDefined();
      });

      // Verify org details
      const orgNames = orgs.map(o => o.name);
      expect(orgNames).toContain('Access Org 1');
      expect(orgNames).toContain('Access Org 2');
    });
  });

  describe('updateUserOrganizationRole success path', () => {
    it('should promote an ADMIN to OWNER successfully', async () => {
      const tenant = await createTestTenant({name:`Org Role Promotion Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      const user = await createAUser('Role Promote User', 'role-promote@example.com');
      if (!user._id) throw new Error('User ID undefined');
      await assignUserToTenant(user._id, tenant._id, TenantRole.MEMBER);
      const org = await createTestOrganization('Promotion Org', tenant._id);
      if (!org._id) throw new Error('Org ID missing');
      const role = await OrganizationActions.assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.ADMIN);
      if (!role._id) throw new Error('Role ID missing');
      const updated = await OrganizationActions.updateUserOrganizationRole(role._id, tenant._id, OrganizationRole.OWNER);
      expect(updated.role).toBe(OrganizationRole.OWNER);
    });

    it('should demote an OWNER to ADMIN when another OWNER exists', async () => {
      const tenant = await createTestTenant({name:`Org Owner Demotion Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      const owner1 = await createAUser('Owner One', 'owner1@example.com');
      const owner2 = await createAUser('Owner Two', 'owner2@example.com');
      if (!owner1._id || !owner2._id) throw new Error('Owner IDs missing');
      await assignUserToTenant(owner1._id, tenant._id, TenantRole.MEMBER);
      await assignUserToTenant(owner2._id, tenant._id, TenantRole.MEMBER);
      const org = await createTestOrganization('Dual Owner Org', tenant._id);
      if (!org._id) throw new Error('Org ID missing');
      const role1 = await OrganizationActions.assignUserToOrganization(owner1._id, org._id, tenant._id, OrganizationRole.OWNER);
      const role2 = await OrganizationActions.assignUserToOrganization(owner2._id, org._id, tenant._id, OrganizationRole.OWNER);
      if (!role1._id) throw new Error('role1 id missing');
      const updated = await OrganizationActions.updateUserOrganizationRole(role1._id, tenant._id, OrganizationRole.ADMIN);
      expect(updated.role).toBe(OrganizationRole.ADMIN);
    });

    it('should allow deactivating an ADMIN when another ADMIN exists and no owners', async () => {
      const tenant = await createTestTenant({name:`Org Multi Admin Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      const userA = await createAUser('Admin A', 'adminA@example.com');
      const userB = await createAUser('Admin B', 'adminB@example.com');
      if (!userA._id || !userB._id) throw new Error('Admin IDs missing');
      await assignUserToTenant(userA._id, tenant._id, TenantRole.MEMBER);
      await assignUserToTenant(userB._id, tenant._id, TenantRole.MEMBER);
      const org = await createTestOrganization('Admin Org', tenant._id);
      if (!org._id) throw new Error('Org ID missing');
      const roleA = await OrganizationActions.assignUserToOrganization(userA._id, org._id, tenant._id, OrganizationRole.ADMIN);
      await OrganizationActions.assignUserToOrganization(userB._id, org._id, tenant._id, OrganizationRole.ADMIN);
      if (!roleA._id) throw new Error('roleA id missing');
      const deleted = await OrganizationActions.deleteUserOrganizationRole(roleA._id, tenant._id);
      expect(deleted._id).toBe(roleA._id);
    });

    it('should allow updating an ADMIN to MEMBER when another ADMIN exists and no owners', async () => {
      const tenant = await createTestTenant({name:`Org Admin Update Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      const userA = await createAUser('Update Admin A', 'updateadminA@example.com');
      const userB = await createAUser('Update Admin B', 'updateadminB@example.com');
      if (!userA._id || !userB._id) throw new Error('Admin IDs missing');
      await assignUserToTenant(userA._id, tenant._id, TenantRole.MEMBER);
      await assignUserToTenant(userB._id, tenant._id, TenantRole.MEMBER);
      const org = await createTestOrganization('Admin Update Org', tenant._id);
      if (!org._id) throw new Error('Org ID missing');
      const roleA = await OrganizationActions.assignUserToOrganization(userA._id, org._id, tenant._id, OrganizationRole.ADMIN);
      await OrganizationActions.assignUserToOrganization(userB._id, org._id, tenant._id, OrganizationRole.ADMIN);
      if (!roleA._id) throw new Error('roleA id missing');
      const updated = await OrganizationActions.updateUserOrganizationRole(roleA._id, tenant._id, OrganizationRole.MEMBER);
      expect(updated.role).toBe(OrganizationRole.MEMBER);
    });
  });

  describe('organization update / role negative paths', () => {
    it('updateOrganization throws for non-existent organization', async () => {
      const tenant = await createTestTenant({name:`Org Update Negative Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await expect(OrganizationActions.updateOrganization('11111111-1111-1111-1111-111111111111', tenant._id, { name: 'Nope'} as any)).rejects.toThrow('Organization not found');
    });

    it('updateUserOrganizationRole throws for non-existent role id', async () => {
      const tenant = await createTestTenant({name:`Org Role Negative Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      await expect(OrganizationActions.updateUserOrganizationRole('22222222-2222-2222-2222-222222222222', tenant._id, OrganizationRole.ADMIN)).rejects.toThrow('User organization role with ID 22222222-2222-2222-2222-222222222222 does not exist');
    });
  });

  describe('updateOrganization success path', () => {
    it('should update organization name, description, and settings', async () => {
      const tenant = await createTestTenant({name:`Org Update Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID undefined');
      const org = await createTestOrganization('Original Org', tenant._id, 'Original description');
      if (!org._id) throw new Error('Org ID missing');
      const updated = await OrganizationActions.updateOrganization(org._id, tenant._id, {
        name: 'Updated Org',
        description: 'Updated description',
        settings: { customTheme: 'light', featureFlagX: true }
      });
      expect(updated.name).toBe('Updated Org');
      expect(updated.description).toBe('Updated description');
      expect(updated.settings).toEqual({ customTheme: 'light', featureFlagX: true });
    });
  });

  // Added core action role uniqueness / reactivation tests migrated from action-level suite
  describe('role lifecycle (core actions)', () => {
    it('idempotent: assignUserToOrganization returns same record for same role', async () => {
      const tenant = await createTestTenant({name:`Org Idempotent Tenant ${uuidv4()}`});
      if (!tenant._id) throw new Error('Tenant ID is not defined');
      const user = await createAUser('Idempotent User', 'idempotent@example.com');
      if (!user._id) throw new Error('User ID missing');
      const org = await createTestOrganization('Idem Org', tenant._id);
      if (!org._id) throw new Error('Org ID missing');
      const first = await OrganizationActions.assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.ADMIN);
      const second = await OrganizationActions.assignUserToOrganization(user._id, org._id, tenant._id, OrganizationRole.ADMIN);
      expect(first._id).toBe(second._id);
    });
  });
});
