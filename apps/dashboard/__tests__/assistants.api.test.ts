/**
 * @jest-environment node
 */
import { v4 as uuidv4 } from 'uuid';
import { createTestTenant, createTestAssistant, testSessionUser } from '../../../packages/prism/src/testing';
import { TenantActions } from '../../../packages/prism/src/core/actions';
import { TenantRole } from '../../../packages/prism/src/core/blocks/userTenantRole.block';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/assistant/route';

describe('/api/assistant', () => {
  it('GET returns assistants for the current user', async () => {
    const tenant = await createTestTenant();
    const assistant = await createTestAssistant({
      name: `Assistant ${uuidv4()}`,
      tenantId: tenant._id!,
      persona_name: 'Test Persona',
      is_template: true,
    });
    expect(assistant._id).toBeDefined();
    // assign test user to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, TenantRole.ADMIN); // Mock user assignment

    // Simulate GET request
    const url = `http://localhost:4000/api/assistant?tenantId=${tenant._id}`;
    const request = new Request(url, { method: 'GET' });
    const req = new NextRequest(request);
    const response = await GET(req);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(Array.isArray(json.templates)).toBe(true);
    expect(json.templates.length).toBeGreaterThanOrEqual(1);
    // Order of templates isn't guaranteed; assert presence instead of position
    expect(json.templates.map((t: any) => t.name)).toContain(assistant.name);
  });

  it('POST creates a new assistant', async () => {
    const tenant = await createTestTenant();
    const assistantData = {
      name: `Assistant ${uuidv4()}`,
      tenantId: tenant._id,
      persona_name: 'Created Persona',
      is_template: false,
    };
    // assign test user to the tenant
    await TenantActions.assignUserToTenant(testSessionUser!._id!, tenant._id!, TenantRole.ADMIN); // Mock user assignment

    // Simulate POST request
    const url = `http://localhost:4000/api/assistant`;
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(assistantData),
    });
    const req = new NextRequest(request);
    const response = await POST(req);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.assistant.name).toBe(assistantData.name);
    expect(json.assistant.tenantId).toBe(tenant._id);
  });
}); 