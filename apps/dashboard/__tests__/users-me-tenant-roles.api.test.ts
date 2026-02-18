/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */

import { TenantActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { NextRequest } from 'next/server';

import { createTestTenant, createTestUser } from '../../../packages/prism/src/testing';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '../../../packages/prism/src/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { GET } from '../src/app/api/users/me/tenant-roles/route';

describe('Users Me Tenant Roles API Tests', () => {

    it('should return user tenant roles for authenticated user', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create a GET request
        const url = `http://localhost:3000/api/users/me/tenant-roles`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.roles).toBeDefined();
        expect(Array.isArray(data.roles)).toBe(true);
        expect(data.userId).toBe(testSessionUser!._id!);

        // Verify the roles contain our test tenant
        const tenantRole = data.roles.find((role: any) => role.tenantId === tenant._id);
        expect(tenantRole).toBeDefined();
        expect(tenantRole.role).toBe(UserTenantRoleBlock.TenantRole.ADMIN);
    });

    it('should return empty roles array when user has no tenant roles', async () => {
        // Create a new user without any tenant assignments
        const userData = {
            name: 'No Roles User',
            email: 'noroles@example.com',
        };
        const user = await createTestUser(userData, 'password123');
        expect(user._id).toBeTruthy();

        // Create a GET request with custom headers to simulate this user
        const url = `http://localhost:3000/api/users/me/tenant-roles`;
        const request = new Request(url, {
            headers: {
                'x-test-user-id': user._id!,
                'x-test-anonymous': 'false'
            }
        });
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.roles).toBeDefined();
        expect(Array.isArray(data.roles)).toBe(true);
        expect(data.roles).toHaveLength(0);
        expect(data.userId).toBe(user._id);
    });

    it('should return 401 when user is not authenticated', async () => {
        // Create a GET request with x-test-anonymous header to simulate anonymous user
        const url = `http://localhost:3000/api/users/me/tenant-roles`;
        const request = new Request(url, {
            headers: {
                'x-test-anonymous': 'true',
            },
        });
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.error).toBe('Unauthorized');
    });

    it('should return multiple tenant roles for user with access to multiple tenants', async () => {
        // Create multiple tenants
        const tenant1 = await createTestTenant();
        const tenant2 = await createTestTenant();
        expect(tenant1._id).toBeTruthy();
        expect(tenant2._id).toBeTruthy();

        // Give the test user different roles in each tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant1._id!, UserTenantRoleBlock.TenantRole.ADMIN);
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant2._id!, UserTenantRoleBlock.TenantRole.MEMBER);

        // Create a GET request
        const url = `http://localhost:3000/api/users/me/tenant-roles`;
        const request = new Request(url);
        const req = new NextRequest(request);

        // Call the GET function
        const response = await GET(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.roles).toBeDefined();
        expect(Array.isArray(data.roles)).toBe(true);
        expect(data.roles.length).toBeGreaterThanOrEqual(2);
        expect(data.userId).toBe(testSessionUser!._id!);

        // Verify both tenant roles are present
        const tenant1Role = data.roles.find((role: any) => role.tenantId === tenant1._id);
        const tenant2Role = data.roles.find((role: any) => role.tenantId === tenant2._id);

        expect(tenant1Role).toBeDefined();
        expect(tenant1Role.role).toBe(UserTenantRoleBlock.TenantRole.ADMIN);

        expect(tenant2Role).toBeDefined();
        expect(tenant2Role.role).toBe(UserTenantRoleBlock.TenantRole.MEMBER);
    });

    it('should handle database errors gracefully', async () => {
        // Mock TenantActions.getUserTenantRoles to throw an error
        const originalGetUserTenantRoles = TenantActions.getUserTenantRoles;
        TenantActions.getUserTenantRoles = jest.fn().mockRejectedValue(new Error('Database connection failed'));

        try {
            // Create a GET request
            const url = `http://localhost:3000/api/users/me/tenant-roles`;
            const request = new Request(url);
            const req = new NextRequest(request);

            // Call the GET function
            const response = await GET(req);

            // Assert the response
            expect(response.status).toBe(500);
            const data = await response.json();
            expect(data.error).toBe('Failed to fetch tenant roles');
        } finally {
            // Restore the original function
            TenantActions.getUserTenantRoles = originalGetUserTenantRoles;
        }
    });
}); 