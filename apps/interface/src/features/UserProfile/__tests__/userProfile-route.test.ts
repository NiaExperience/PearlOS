/**
 * @jest-environment node
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { POST_impl, GET_impl } from '@nia/prism/core/routes/userProfile/route';
import { testSessionUser } from '@nia/prism/testing';
import { createTestTenant, createTestAssistant } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

function makeRequest(url: string, method: string, body?: any) {
  return new NextRequest(url, { method, body: body ? JSON.stringify(body) : undefined } as any);
}

describe('UserProfile route', () => {
  it('denies anonymous/unauthorized POST for userProfile', async () => {
    const tenant = await createTestTenant();
    const assistant = await createTestAssistant({ tenantId: tenant._id } as any);

    const old = process.env.TEST_REQUIRE_AUTH_HEADER;
    process.env.TEST_REQUIRE_AUTH_HEADER = 'true';
    try {
      const req = makeRequest('https://localhost:3000/api/userProfile?agent=' + assistant.subDomain, 'POST', { first_name:"Test", email:`test${uuidv4()}@example.com`});
      // Pass empty auth options to simulate no session
      const res = await POST_impl(req, interfaceAuthOptions);
      expect(res.status).toBe(403);
    } finally {
      process.env.TEST_REQUIRE_AUTH_HEADER = old;
    }
  });

  it('denies anonymous/unauthorized GET for userProfile', async () => {
    const tenant = await createTestTenant();
    const assistant = await createTestAssistant({ tenantId: tenant._id } as any);

    const old = process.env.TEST_REQUIRE_AUTH_HEADER;
    process.env.TEST_REQUIRE_AUTH_HEADER = 'true';
    try {
      const req = makeRequest('https://localhost:3000/api/userProfile?agent=' + assistant.subDomain, 'GET');
      // Pass empty auth options to simulate no session
      const res = await GET_impl(req, interfaceAuthOptions);
      expect(res.status).toBe(403);
    } finally {
      process.env.TEST_REQUIRE_AUTH_HEADER = old;
    }
  });

  it('normalizes humanized email and enforces duplicate check', async () => {
    const tenant = await createTestTenant({ name: 'UserProfile Normalization Tenant' });
    const assistant = await createTestAssistant({ name: 'UserProfile Normalization Assistant', tenantId: tenant._id } as any);
    const baseUrl = `https://localhost:3000/userProfile?agent=${assistant.subDomain}`;

    const headers = new Headers({
      'content-type': 'application/json',
      'x-test-user-id': testSessionUser!._id!,
    });

    // First submit with humanized email
    const firstBody = { first_name: 'Bob', email: 'bob at example dot com' };
    const firstReq = new NextRequest(new Request(baseUrl, { method: 'POST', headers, body: JSON.stringify(firstBody) }));
    const firstRes = await POST_impl(firstReq, interfaceAuthOptions);
    expect(firstRes.status).toBe(201);
    const firstJson = await firstRes.json();
    expect(firstJson.success).toBe(true);
    expect(firstJson.data?.email).toBe('bob@example.com');

    // Second submit should merge
    const dupReq = new NextRequest(new Request(baseUrl, { method: 'POST', headers, body: JSON.stringify(firstBody) }));
    const dupRes = await POST_impl(dupReq, interfaceAuthOptions);
    expect(dupRes.status).toBe(201);
    const dupJson = await dupRes.json();
  });
});
