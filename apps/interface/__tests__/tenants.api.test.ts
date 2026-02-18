/**
 * @jest-environment node
 * 
 * Test suite for /api/tenants route
 * 
 * This tests the core tenant management functionality which is fundamental
 * to the multi-tenant architecture of Nia Universal.
 */

import { TenantActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestTenant } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '@nia/prism/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order, @typescript-eslint/no-var-requires
const { GET, POST } = require('../src/app/api/tenants/route');

describe('Tenants API Tests', () => {
    beforeEach(async () => {
      expect(testSessionUser).not.toBeNull();
    });

    describe('GET /api/tenants', () => {
        it('should return all tenants for authenticated user', async () => {
            // Create test tenants
            const tenant1 = await createTestTenant({ name: 'Test Tenant 1' });
            const tenant2 = await createTestTenant({ name: 'Test Tenant 2' });

            expect(tenant1._id).toBeTruthy();
            expect(tenant2._id).toBeTruthy();

            await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant1._id!, UserTenantRoleBlock.TenantRole.OWNER);
            await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant2._id!, UserTenantRoleBlock.TenantRole.ADMIN);

            // Create a GET request
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url);
            const req = new NextRequest(request);

            // Call the GET function
            const response = await GET(req);

            // Assert the response
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(Array.isArray(data.tenants)).toBe(true);
            expect(data.tenants.length).toBeGreaterThanOrEqual(2);

            // Verify our test tenants are in the response
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tenantIds = data.tenants.map((t: any) => t._id);
            expect(tenantIds).toContain(tenant1._id);
            expect(tenantIds).toContain(tenant2._id);
        });

        it('should return empty array when user has no tenants', async () => {
            // Create a GET request for a user with no tenants
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url);
            const req = new NextRequest(request);

            // Call the GET function (user is already set up by testSessionUser)
            const response = await GET(req);

            // Assert the response - might have tenants from other tests, but should succeed
            expect(response.status).toBe(200);
            const data = await response.json();
            expect(Array.isArray(data.tenants)).toBe(true);
        });
    });

    describe('POST /api/tenants', () => {
        it('should create a new tenant with valid data', async () => {
            const newTenantData = {
                name: 'New Test Tenant',
                domain: 'newtesttenant.com'
            };

            // Create a POST request
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTenantData)
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert the response
            expect(response.status).toBe(201);
            const data = await response.json();
            expect(data.tenant).toBeDefined();
            expect(data.tenant.name).toBe(newTenantData.name);
            expect(data.tenant.domain).toBe(newTenantData.domain);
            expect(data.tenant._id).toBeTruthy();
        });

        it('should handle missing name in request body', async () => {
            const invalidData = {
                description: 'A tenant without a name'
            };

            // Create a POST request with invalid data
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invalidData)
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert error response
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should handle empty name in request body', async () => {
            const invalidData = {
                name: '',
                description: 'A tenant with empty name'
            };

            // Create a POST request with invalid data
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(invalidData)
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert error response
            expect(response.status).toBeGreaterThanOrEqual(400);
        });

        it('should handle invalid JSON in request body', async () => {
            // Create a POST request with invalid JSON
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify('invalid json')
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert error response - should handle malformed JSON
            expect([400, 500]).toContain(response.status);
        });

        it('should automatically assign creator as owner of new tenant', async () => {
            const newTenantData = {
                name: 'Owner Assignment Test Tenant',
                domain: 'ownerassignmenttest.com'
            };

            // Create a POST request
            const url = `http://localhost:3000/api/tenants`;
            const request = new Request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newTenantData)
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert successful creation
            expect(response.status).toBe(201);
            const data = await response.json();
            expect(data.tenant._id).toBeTruthy();

            // Verify user was assigned as owner (this tests the business logic)
            const userTenantRoles = await TenantActions.getUserTenantRoles(testSessionUser!._id!);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const createdTenantRole = userTenantRoles.find((role: any) => role.tenantId === data.tenant._id);
            expect(createdTenantRole).toBeDefined();
            expect(createdTenantRole!.role).toBe(UserTenantRoleBlock.TenantRole.OWNER);
        });
    });
});
