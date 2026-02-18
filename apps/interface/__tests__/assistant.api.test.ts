/**
 * @jest-environment node
 */
import { AssistantBlock, UserBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestTenant, createTestUser } from '@nia/prism/testing';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '@nia/prism/testing';
import { NextRequest } from 'next/server';

// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { GET } from '../src/app/api/assistant/route';

describe('Assistant API Tests (postgres)', () => {
  beforeEach(async () => {
    expect(testSessionUser).not.toBeNull();
  });

  it('should create and find a valid assistant', async () => {
    // create a tenant
    const tenant = await createTestTenant();

    // define a user name
    const userName = 'Ben Derdundat';
   
    // define an assistant
    const assistantData = {
      name: 'Assistant A',
      user: userName,
      tenantId: tenant._id,
    } as AssistantBlock.IAssistant;

    // create & validate assistant
    const assistant = await createTestAssistant(assistantData);
    expect(assistant).not.toBeNull();
    expect(assistant._id).toBeTruthy();
    expect(assistant.subDomain).not.toBeUndefined();
    // the subdomain will be the lowercase name with whitespace replaced with dashes
    const targetSubDomain = assistant.subDomain;

    // create & validate user
    const userData : UserBlock.IUser = {
      name: userName,
      phone_number: '4155551212',
      email: 'ben@derdundat.com',
    };    
    const user = await createTestUser(userData, 'the ox sleeps in the meadow');
    expect(user).not.toBeNull();
    expect(user._id).toBeTruthy();
    const userId = user._id!;

    // Create a NextRequest object
    const url = `http://localhost:3000/api/assistant/${targetSubDomain}`;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
      }
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(200);
    const findAssistant = await response.json();
    expect(findAssistant).not.toBeNull();
    expect(findAssistant.name).toBe(assistantData.name);
  });

  it('should return an error if no assistant agent is provided', async () => {
    // Create a NextRequest object
    const url = `http://localhost:3000/api/assistant`;
    const request = new Request(url);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Assistant agent is required');
  });

  it('should return an error if the assistant is not found', async () => {
    // Create a NextRequest object
    const url = `http://localhost:3000/api/assistant?agent=non-existent-assistant`;
    const options = {
      method: 'GET',
      headers: {
        'Content-Type': 'text/plain',
      }
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await GET(req);

    // Assert the response
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Assistant not found');
  });
});
