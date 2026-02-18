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
import { POST } from '../src/app/api/bulk-upload-urls/route';

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

describe('Bulk Upload URLs API Tests', () => {

  it('should return 400 when files parameter is missing', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a POST request without files
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenantId}`;
    const requestData = {
      // tenantId removed from body
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
    expect(data.error).toBe('Files must be an array');
  });

  it('should return 400 when files is not an array', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a POST request with files as string
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenantId}`;
    const requestData = {
      files: 'not-an-array',
      // tenantId removed from body
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
    expect(data.error).toBe('Files must be an array');
  });

  it('should return 400 when files array is empty', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a POST request with empty files array
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenantId}`;
    const requestData = {
      files: [],
      // tenantId removed from body
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
    expect(data.error).toBe('At least one file is required');
  });

  it('should return 400 when files array has more than 100 items', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a large files array
    const largeFilesArray = Array.from({ length: 101 }, (_, i) => ({
      filename: `file${i}.jpg`,
      fileType: 'image/jpeg'
    }));

    // Create a POST request with too many files
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenant._id}`;
    const requestData = {
      files: largeFilesArray,
      // tenantId removed from body
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
    expect(data.error).toBe('Maximum 100 files allowed per request');
  });

  it('should return 400 when file is missing filename', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a POST request with invalid file
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenant._id}`;
    const requestData = {
      files: [
        { fileType: 'image/jpeg' }, // Missing filename
        { filename: 'file2.jpg', fileType: 'image/jpeg' }
      ],
      // tenantId removed from body
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
    expect(data.error).toBe('File at index 0 is missing filename or fileType');
  });

  it('should return 400 when file is missing fileType', async () => {
    // Create a tenant
    const tenant = await createTestTenant();
    expect(tenant._id).toBeTruthy();
    const tenantId = tenant._id!;

    // Give the test user admin access to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

    // Create a POST request with invalid file
    const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenant._id}`;
    const requestData = {
      files: [
        { filename: 'file1.jpg' }, // Missing fileType
        { filename: 'file2.jpg', fileType: 'image/jpeg' }
      ],
      // tenantId removed from body
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
    expect(data.error).toBe('File at index 0 is missing filename or fileType');
  });

  it('should return 500 when S3 bucket is not configured', async () => {
    // Store original environment variable
    const originalBucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME;
    
    try {
      // Remove the bucket name environment variable
      delete process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME;

      // Create a tenant
      const tenant = await createTestTenant();
      expect(tenant._id).toBeTruthy();
      const tenantId = tenant._id!;

      // Give the test user admin access to the tenant
      await TenantActions.assignUserToTenant(testSessionUser!._id!, tenantId, UserTenantRoleBlock.TenantRole.ADMIN);

      // Create a POST request
      const url = `http://localhost:4000/api/bulk-upload-urls?tenantId=${tenant._id}`;
      const requestData = {
        files: [
          { filename: 'file1.jpg', fileType: 'image/jpeg' }
        ],
        // tenantId removed from body
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
      expect(data.error).toBe('S3 bucket not configured');
    } finally {
      // Restore the original environment variable
      if (originalBucketName) {
        process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME = originalBucketName;
      }
    }
  });
}); 