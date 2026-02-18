/**
 * @jest-environment node
 */

import { TenantActions } from '@nia/prism/core/actions';
import { UserTenantRoleBlock } from '@nia/prism/core/blocks';
import { createTestTenant } from '../../../packages/prism/src/testing';
import { NextRequest } from 'next/server';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '../../../packages/prism/src/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/s3-presigned-url/route';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
    S3Client: jest.fn().mockImplementation(() => ({
        send: jest.fn(),
    })),
    PutObjectCommand: jest.fn().mockImplementation((params) => params),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: jest.fn().mockResolvedValue('https://mock-s3-url.com/presigned-url'),
}));

describe('S3 Presigned URL API Tests', () => {

    it('should return 400 when filename is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();
        const tenantId = tenant._id!;

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create a POST request with missing filename
        const url = `http://localhost:3000/api/s3-presigned-url`;
        const requestData = {
            fileType: 'image/jpeg',
            tenantId: tenant._id,
        };
        const request = new Request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        const req = new NextRequest(request);

        // Call the POST function
        const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Filename and fileType are required');
    });

    it('should return 400 when fileType is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();
        const tenantId = tenant._id!;

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create a POST request with missing fileType
        const url = `http://localhost:3000/api/s3-presigned-url`;
        const requestData = {
            filename: 'test-image.jpg',
            tenantId: tenant._id,
        };
        const request = new Request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        const req = new NextRequest(request);

        // Call the POST function
        const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Filename and fileType are required');
    });

    it('should return 400 when both filename and fileType are missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();
        const tenantId = tenant._id!;

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create a POST request with missing fields
        const url = `http://localhost:3000/api/s3-presigned-url`;
        const requestData = {
            tenantId: tenant._id,
        };
        const request = new Request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestData),
        });
        const req = new NextRequest(request);

        // Call the POST function
        const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Filename and fileType are required');
    });

    it('should return 500 when AWS S3 bucket name is not configured', async () => {
        // Store original environment variable
        const originalBucketName = process.env.AWS_S3_BUCKET_NAME;
        
        try {
            // Remove the bucket name environment variable
            delete process.env.AWS_S3_BUCKET_NAME;

            // Create a tenant
            const tenant = await createTestTenant();
            expect(tenant._id).toBeTruthy();
            const tenantId = tenant._id!;

            // Give the test user admin access to the tenant
            await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

            // Create a POST request
            const url = `http://localhost:3000/api/s3-presigned-url`;
            const requestData = {
                filename: 'test-image.jpg',
                fileType: 'image/jpeg',
                tenantId: tenant._id,
            };
            const request = new Request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestData),
            });
            const req = new NextRequest(request);

            // Call the POST function
            const response = await POST(req);

            // Assert the response
            expect(response.status).toBe(500);
            const data = await response.json();
            expect(data.error).toBe('AWS S3 bucket name not configured');
        } finally {
            // Restore the original environment variable
            if (originalBucketName) {
                process.env.AWS_S3_BUCKET_NAME = originalBucketName;
            }
        }
    });
}); 