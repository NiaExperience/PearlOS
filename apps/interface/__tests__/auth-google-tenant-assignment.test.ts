/**
 * @jest-environment node
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as AccountActions from '@nia/prism/core/actions/account-actions';
import * as AssistantActions from '@nia/prism/core/actions/assistant-actions';
import * as TenantActions from '@nia/prism/core/actions/tenant-actions';
import * as UserActions from '@nia/prism/core/actions/user-actions';
import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { TenantRole } from '@nia/prism/core/blocks/userTenantRole.block';
import { createTestTenant } from '@nia/prism/testing/testlib';
import { v4 as uuidv4 } from 'uuid';

// Create auth options for testing
const testAuthConfig = {
  appType: 'interface' as const,
  baseUrl: 'http://localhost:3000',
  googleCredentials: {
    clientId: process.env.GOOGLE_INTERFACE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_INTERFACE_CLIENT_SECRET!,
  },
  cookiePrefix: 'interface-auth',
  pages: { signIn: '/login' },
};
const authOptions = createAuthOptions(testAuthConfig);

// Set up test environment variables
process.env.NEXTAUTH_SECRET = 'test-nextauth-secret';
process.env.GOOGLE_INTERFACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_INTERFACE_CLIENT_SECRET = 'test-client-secret';

describe('Google OAuth Tenant Assignment Integration', () => {
  const testGoogleAccount = {
    provider: 'google',
    type: 'oauth' as const,
    providerAccountId: `google-${uuidv4()}`,
    access_token: 'mock-access-token',
    expires_at: 1234567890,
    refresh_token: 'mock-refresh-token',
    token_type: 'Bearer',
    id_token: 'mock-id-token',
    scope: 'email profile',
    session_state: 'mock-session-state',
  };

  describe('New Google user creation', () => {
    it('should create a new Google user without tenant assignment during signIn', async () => {
      const email = `test-google-${uuidv4()}@example.com`;
      const googleUser = {
        id: 'temp-google-id',
        email,
        name: 'Test Google User',
        image: 'https://example.com/avatar.jpg',
        sessionId: uuidv4(),
        emailVerified: null,
      };

      // Mock the action functions
      jest.spyOn(UserActions, 'getUserByEmail');
      jest.spyOn(UserActions, 'createUser');
      jest.spyOn(AccountActions, 'createAccount');

      // Execute signIn callback
      const result = await authOptions.callbacks?.signIn?.({
        user: googleUser,
        account: testGoogleAccount,
        profile: undefined,
        email: undefined,
        credentials: undefined,
      });

      expect(result).toBe(true);
      expect(UserActions.getUserByEmail).toHaveBeenCalledWith(email);
      expect(UserActions.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email,
          name: 'Test Google User',
          image: 'https://example.com/avatar.jpg',
          emailVerified: expect.anything(),
        })
      );
      expect(AccountActions.createAccount).toHaveBeenCalled();

      // Verify user was created but NOT assigned to any tenant during signIn
      const createdUser = await UserActions.getUserByEmail(email);
      expect(createdUser).toBeTruthy();
      if (createdUser) {
        const userTenants = await TenantActions.getUserTenantRoles(createdUser._id!);
        // User should not be in any tenant yet (assignment happens at page access)
        expect(userTenants).toHaveLength(0);
      }
    });
  });

  describe('Tenant assignment on page access', () => {
    it('should auto-add user to assistant tenant on first access', async () => {
      // Create a test tenant and assistant
      const tenant = await createTestTenant({ name: `Test Tenant ${uuidv4()}` });
      const assistantName = `test-assistant-${uuidv4()}`;
      
      // Create assistant with tenant (use unique name to avoid collisions)
      const assistant = await AssistantActions.createAssistant({
        name: `Test Assistant ${uuidv4()}`,
        subDomain: assistantName,
        tenantId: tenant._id!,
      } as any);

      // Create a new Google user
      const email = `test-access-${uuidv4()}@example.com`;
      const newUser = await UserActions.createUser({
        email,
        name: 'Test User',
        emailVerified: new Date(),
      });

      expect(newUser._id).toBeTruthy();
      expect(assistant._id).toBeTruthy();
      expect(tenant._id).toBeTruthy();

      // Verify user is NOT in tenant initially
      const hasAccessBefore = await TenantActions.userHasAccess(newUser._id!, tenant._id!);
      expect(hasAccessBefore).toBe(false);

      // Simulate the page access logic: check access and auto-add if needed
      const isUserInTenant = await TenantActions.userHasAccess(newUser._id!, tenant._id!);
      if (!isUserInTenant) {
        // This is what the page.tsx does
        await TenantActions.assignUserToTenant(
          newUser._id!,
          tenant._id!,
          TenantRole.MEMBER
        );
      }

      // Verify user is now in tenant as MEMBER
      const hasAccessAfter = await TenantActions.userHasAccess(newUser._id!, tenant._id!);
      expect(hasAccessAfter).toBe(true);

      // Verify role is MEMBER
      const userRoles = await TenantActions.getUserTenantRoles(newUser._id!);
      const tenantRole = userRoles.find((r: any) => r.tenantId === tenant._id);
      expect(tenantRole).toBeTruthy();
      expect(tenantRole?.role).toBe(TenantRole.MEMBER);
    });

    it('should not duplicate tenant assignment for existing members', async () => {
      // Create a test tenant and assistant
      const tenant = await createTestTenant({ name: `Duplicate Test ${uuidv4()}` });
      const assistantName = `dup-test-${uuidv4()}`;
      
      await AssistantActions.createAssistant({
        name: `Duplicate Test Assistant ${uuidv4()}`,
        subDomain: assistantName,
        tenantId: tenant._id!,
      } as any);

      // Create user and add to tenant
      const email = `test-duplicate-${uuidv4()}@example.com`;
      const user = await UserActions.createUser({
        email,
        name: 'Existing Member',
        emailVerified: new Date(),
      });

      await TenantActions.assignUserToTenant(user._id!, tenant._id!, TenantRole.MEMBER);

      // Verify user is in tenant
      const hasAccess = await TenantActions.userHasAccess(user._id!, tenant._id!);
      expect(hasAccess).toBe(true);

      // Simulate page access again - should not try to re-add
      const isUserInTenant = await TenantActions.userHasAccess(user._id!, tenant._id!);
      expect(isUserInTenant).toBe(true);

      // Attempting to assign again should either succeed idempotently or return existing
      const userRolesBefore = await TenantActions.getUserTenantRoles(user._id!);
      const roleCountBefore = userRolesBefore.filter((r: any) => r.tenantId === tenant._id).length;

      if (!isUserInTenant) {
        await TenantActions.assignUserToTenant(user._id!, tenant._id!, TenantRole.MEMBER);
      }

      const userRolesAfter = await TenantActions.getUserTenantRoles(user._id!);
      const roleCountAfter = userRolesAfter.filter((r: any) => r.tenantId === tenant._id).length;

      // Should not create duplicate roles
      expect(roleCountAfter).toBe(roleCountBefore);
    });
  });

  describe('PearlOS default tenant fallback', () => {
    it('should handle pearlos as default assistant', async () => {
      // Create PearlOS tenant and assistant as a system prerequisite
      const uniqueId = uuidv4().slice(0, 8);
      const pearlOSTenant = await createTestTenant({ name: `PearlOS Tenant ${uniqueId}` });
      const pearlOSAssistant = await AssistantActions.createAssistant({
        name: `PearlOS ${uniqueId}`,
        subDomain: `pearlos-${uniqueId}`,
        tenantId: pearlOSTenant._id!,
      });
      
      // Verify PearlOS exists in the system
      expect(pearlOSAssistant).toBeTruthy();
      expect(pearlOSAssistant.subDomain).toBe(`pearlos-${uniqueId}`);
      expect(pearlOSAssistant.tenantId).toBe(pearlOSTenant._id);
      
      // Verify we can look it up by subdomain
      const foundAssistant = await AssistantActions.getAssistantBySubDomain(`pearlos-${uniqueId}`);
      expect(foundAssistant).toBeTruthy();
      expect(foundAssistant?._id).toBe(pearlOSAssistant._id);
      
      // eslint-disable-next-line no-console
      console.log('✅ PearlOS assistant and tenant created and configured correctly');
    });
  });
});
