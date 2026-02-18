/**
 * @jest-environment node
 */

import { TenantActions } from '@nia/prism/core/actions';
import { UserBlock, UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestTenant, createTestUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '@nia/prism/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { GET, POST } from '../src/app/api/users/route';
// eslint-disable-next-line import/order
import { GET as GET_SPECIFIC } from '../src/app/api/users/[userId]/route';

describe('Users API Tests', () => {
    beforeEach(() => {
        expect(testSessionUser).not.toBeNull();
        if (!testSessionUser) {
            throw new Error('Test session user is not set up');
        }
    });

    it('should return all users for a tenant', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        if (!tenant || !tenant._id) {
            throw new Error('Failed to create test tenant');
        }
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        console.log(`Assigning user ${testSessionUser!._id!} to tenant: ${tenant._id}`);
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create a GET request
        const url = `http://localhost:3000/api/users?tenantId=${tenant._id}`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(200);
        const users = await response.json();
        expect(Array.isArray(users)).toBe(true);
        expect(users.length).toBeGreaterThanOrEqual(1);

        // Verify our test users are in the response
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const userIds = users.map((u: any) => u._id);
        expect(userIds).toContain(testSessionUser!._id!);
    });

    it('should create a new user', async () => {
        expect(testSessionUser).not.toBeNull();
        if (!testSessionUser || !testSessionUser._id) {
            throw new Error('Test session user is not set up');
        }
        // Create a tenant
        const tenant = await createTestTenant();
        if (!tenant || !tenant._id) {
            throw new Error('Failed to create test tenant');
        }
        expect(tenant._id).toBeTruthy();

        // Give the test user ADMIN access to the tenant
        console.log(`Assigning user ${testSessionUser!._id!} to tenant: ${tenant._id}`);
        const adminRole = await TenantActions.assignUserToTenant(testSessionUser._id, tenant._id, UserTenantRoleBlock.TenantRole.ADMIN);
        expect(adminRole).not.toBeNull();
        expect(adminRole!.role).toBe(UserTenantRoleBlock.TenantRole.ADMIN);

        // New user data
        const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
        const newUserData = {
            name: `New Test User ${unique}`,
            email: `newuser+${unique}@example.com`,
            password: 'securePassword123',
            tenantId: tenant._id, // Ensure tenantId is provided
            role: UserTenantRoleBlock.TenantRole.ADMIN, // Default is MEMBER, let's given them heightened privileges
        };

        // Create a POST request
        const url = `http://localhost:3000/api/users`;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(newUserData),
        };
        const request = new Request(url, options);
        const req = new NextRequest(request);

        // Call the POST function
        const response = await POST(req);

        // Assert the response
        if (!response || !response.status) {
            throw new Error('Response is undefined or does not have a status');
        }
        const user = await response.json();
        expect(response.status).toBe(201);
        expect(user).toBeTruthy();
        expect(user.name).toBe(newUserData.name);
        expect(user.email).toBe(newUserData.email);
        expect(user._id).toBeTruthy();

        // Verify user was actually created
        const createdUser = await TenantActions.getUsersForTenant(tenant._id);
        expect(createdUser).toHaveLength(2); // the test user and the new user
        const userIds = createdUser.map(u => u._id);
        expect(userIds).toContain(user._id);
        expect(user._id).not.toEqual(testSessionUser!._id!);
        expect(userIds).toContain(testSessionUser!._id!);

        // Verify the role assignment
        const roles = await TenantActions.getUserTenantRoles(user._id) || [];
        expect(roles).toHaveLength(1);
        expect(roles.some(role => role.tenantId === tenant._id && role.role === newUserData.role)).toBe(true);
    });

    it('should return an error if tenant ID is not provided when fetching users', async () => {
        // Create a GET request without tenantId
        const url = `http://localhost:3000/api/users`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Agent or Tenant ID is required');
    });

    it('should return an error if required fields are missing when creating a user', async () => {
        // Create a POST request with missing fields
        const url = `http://localhost:3000/api/users`;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                // Missing name, email, tenantId
                password: 'password123'
            }),
        };
        const request = new Request(url, options);
        const req = new NextRequest(request);

        // Call the POST function
        const response = await POST(req);
        if (!response || !response.status) {
            throw new Error('Response is undefined or does not have a status');
        }
        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeTruthy();
    });

    it('should return a specific user by ID', async () => {
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Create a test user
        const uniq2 = `${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;
        const userData: UserBlock.IUser = {
            name: `Specific User ${uniq2}`,
            email: `specific+${uniq2}@example.com`,
        };

        const user = await createTestUser(userData, 'specificpassword');
        expect(user._id).toBeTruthy();

        // Assign the user to the tenant
        console.log(`Assigning user ${user._id} to tenant: ${tenant._id}`);
        await TenantActions.assignUserToTenant(user._id!, tenant._id!, UserTenantRoleBlock.TenantRole.MEMBER);

        // Create a GET request
        const url = `http://localhost:3000/api/users/${user._id}?tenantId=${tenant._id}`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET_SPECIFIC(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.users).toBeTruthy();
        expect(data.users).toHaveLength(1);
        expect(data.users[0]._id).toBe(user._id);
        expect(data.users[0].name).toBe(userData.name);
        expect(data.users[0].email).toBe(userData.email);
    });

    it('should return an error if user ID is not found', async () => {
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Create a GET request with non-existent user ID
        const url = `http://localhost:3000/api/users/non-existent-user?tenantId=${tenant._id}`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET_SPECIFIC(req);

        // Assert the response
        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('User not found');
    });
});
