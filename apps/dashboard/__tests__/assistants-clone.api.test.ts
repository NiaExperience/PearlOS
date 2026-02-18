/**
 * @jest-environment node
 */
import { createTestTenant, createTestAssistant } from '../../../packages/prism/src/testing';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/assistant/clone/route';
import type { IAssistant } from '@nia/prism/core/blocks/assistant.block';

describe('/api/assistant/clone', () => {
  it('POST clones an assistant from a template', async () => {
    const tenant = await createTestTenant();
    // Create an assistant template
    const assistantData: IAssistant = {
      name: 'CloneMe',
      tenantId: tenant._id!,
      persona_name: 'CloneBot',
      special_instructions: 'Be helpful',
    };
    const assistant = await createTestAssistant(assistantData);
    // Prepare request body for clone
    const body = {
      templateId: assistant._id!,
      newName: 'Cloned Assistant',
      persona_name: 'ClonedBot',
      special_instructions: 'Be even more helpful',
    };
    // Simulate POST request
    const url = `http://localhost:4000/api/assistant/clone`;
    const request = new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const req = new NextRequest(request);
    const response = await POST(req);
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.assistant).toBeDefined();
    expect(json.assistant.name).toBe('Cloned Assistant');
    expect(json.assistant.persona_name).toBe('ClonedBot');
    expect(json.assistant.special_instructions).toBe('Be even more helpful');
  });
}); 