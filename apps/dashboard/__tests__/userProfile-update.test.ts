/**
 * @jest-environment node
 */
import { UserProfileDefinition } from '@nia/prism/core/platform-definitions/UserProfile.definition';
import { createTestAssistant, createTestTenant, testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';

import * as route from '../src/app/api/userProfile/route';


// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildReq(url: string, method: string, body?: any, headers?: Record<string, string>) {
  return new NextRequest(new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined }));
}

describe('Dashboard UserProfile PUT API', () => {
  it('updates email and rejects duplicates', async () => {
    const tenant = await createTestTenant();
    // create an assistant so UserProfile parent linkage is valid in this tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assistant = await createTestAssistant({ name: 'AdminUserProfile', tenantId: tenant._id } as any);
    const baseHeaders = { 'content-type': 'application/json', 'x-test-user-id': testSessionUser!._id! };

    // seed two UserProfile records via prism create through the route GET won't help; here we simulate by calling the interface route save is not accessible
    // Instead, perform update testing by first creating two items using prism directly via the dashboard API is not available here.
    // We'll simulate by calling the PUT endpoint after constructing a fake id would not work either.
    // Therefore, we adapt: Create two emails in the same tenant by using the Dashboard GET pre-conditions are not guaranteed; use Prism directly.

    const { Prism } = await import('@nia/prism');
    const prism = await Prism.getInstance();

    try { await prism.createDefinition(UserProfileDefinition, tenant._id); } catch { /* ignore if already exists */ }

    const emailA = `userA_${Date.now()}@example.com`.toLowerCase();
    const emailB = `userB_${Date.now()}@example.com`.toLowerCase();

    const a = await prism.create('UserProfile', { first_name: 'A', email: emailA, assistantId: assistant._id }, tenant._id);
    const b = await prism.create('UserProfile', { first_name: 'B', email: emailB, assistantId: assistant._id }, tenant._id);
    const idA = (a.items?.[0]?._id || a.items?.[0]?.page_id) as string;

    // Success: update A to a new unique email
    {
      const newEmail = `userA2_${Date.now()}@example.com`.toLowerCase();
      const req = buildReq('http://localhost/api/userProfile', 'PUT', { id: idA, tenantId: tenant._id, email: newEmail }, baseHeaders);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await route.PUT(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    }

    // Duplicate: try to set A to B's email -> 409
    {
      const req = buildReq('http://localhost/api/userProfile', 'PUT', { id: idA, tenantId: tenant._id, email: emailB }, baseHeaders);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await route.PUT(req as any);
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.duplicate).toBe(true);
    }
  });
});
