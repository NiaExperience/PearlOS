/**
 * @jest-environment node
 */

import { TenantActions } from '../../../packages/prism/src/core/actions';
import { UserTenantRoleBlock } from '../../../packages/prism/src/core/blocks';
import { createTestTenant } from '../../../packages/prism/src/testing';
import { NextRequest } from 'next/server';
import { testSessionUser } from '../../../packages/prism/src/testing';

// Shared mock for S3Client.send (name starts with 'mock' so Jest allows factory reference)
const mockS3ClientSend = jest.fn();

// Mock AWS SDK v3 S3 client (hoisted before imports are evaluated)
jest.mock('@aws-sdk/client-s3', () => {
    const original = jest.requireActual('@aws-sdk/client-s3');
    return {
        ...original,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockS3ClientSend })),
        PutObjectCommand: jest.fn().mockImplementation((input: any) => ({ __input: input })),
    };
});

import { POST } from '../src/app/api/upload-images/route';

// File polyfill for Node.js test environment (local to this test file only)
if (typeof File === 'undefined') {
    class FilePolyfill extends Blob {
        name: string;
        lastModified: number;

        constructor(bits: BlobPart[], filename: string, options?: FilePropertyBag) {
            super(bits, options);
            this.name = filename;
            this.lastModified = options?.lastModified ?? Date.now();
        }
    }
    (global as any).File = FilePolyfill;
}

beforeEach(() => {
    mockS3ClientSend.mockReset();
    mockS3ClientSend.mockResolvedValue({});
});

describe('Upload Images API Tests', () => {
    it('returns 500 when S3 upload fails', async () => {
        const tenant = await createTestTenant();
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Force the next S3 send() call to reject
    mockS3ClientSend.mockRejectedValueOnce(new Error('S3 explode'));

        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-image.jpg');
        formData.append('file', new File(['mock'], 'test-image.jpg', { type: 'image/jpeg' }));

        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, { method: 'POST', body: formData });
        const req = new NextRequest(request);
        const response = await POST(req);
        expect(response.status).toBe(500);
        const data = await response.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe('Failed to upload image to S3');
        expect(data.details).toContain('S3 explode');
    });

    it('should upload image successfully with admin access', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-image.jpg');

        // Create a mock file
        const mockFile = new File(['mock image content'], 'test-image.jpg', {
            type: 'image/jpeg',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.url).toBeDefined();
        expect(data.key).toBeDefined();
        expect(data.fileName).toBe('test-image.jpg');
        expect(data.contentType).toBe('image/jpeg');
        expect(data.size).toBe(mockFile.size);
        expect(data.message).toContain('Successfully uploaded test-image.jpg to S3');
    });

    it('should return 400 when file is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data without file
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-image.jpg');

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: file, assistantName, contentType, fileName');
    });

    it('should return 400 when assistantName is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id!).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data without assistantName
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-image.jpg');

        // Create a mock file
        const mockFile = new File(['mock image content'], 'test-image.jpg', {
            type: 'image/jpeg',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: file, assistantName, contentType, fileName');
    });

    it('should return 400 when contentType is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data without contentType
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('fileName', 'test-image.jpg');

        // Create a mock file
        const mockFile = new File(['mock image content'], 'test-image.jpg', {
            type: 'image/jpeg',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: file, assistantName, contentType, fileName');
    });

    it('should return 400 when fileName is missing', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data without fileName
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');

        // Create a mock file
        const mockFile = new File(['mock image content'], 'test-image.jpg', {
            type: 'image/jpeg',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Missing required fields: file, assistantName, contentType, fileName');
    });

    it('should return 400 for invalid file type', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-file.txt');

        // Create a mock file with invalid type
        const mockFile = new File(['mock content'], 'test-file.txt', {
            type: 'text/plain',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBe('Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.');
    });

    it('should sanitize file names with special characters', async () => {
        // Create a tenant
        const tenant = await createTestTenant();
        expect(tenant._id).toBeTruthy();

        // Give the test user admin access to the tenant
        await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, UserTenantRoleBlock.TenantRole.ADMIN);

        // Create form data with special characters in filename
        const formData = new FormData();
        formData.append('tenantId', tenant._id!);
        formData.append('assistantName', 'test-assistant');
        formData.append('contentType', 'images');
        formData.append('fileName', 'test-image with spaces & special chars!.jpg');

        // Create a mock file
        const mockFile = new File(['mock image content'], 'test-image.jpg', {
            type: 'image/jpeg',
        });
        formData.append('file', mockFile);

        // Create a POST request
        const url = `http://localhost:4000/api/upload-images`;
        const request = new Request(url, {
            method: 'POST',
            body: formData,
        });
        const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

        // Assert the response
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.success).toBe(true);
        expect(data.fileName).toBe('test-image_with_spaces___special_chars_.jpg');
        expect(data.key).toContain('test-assistant/images/test-image_with_spaces___special_chars_.jpg');
    });
}); 