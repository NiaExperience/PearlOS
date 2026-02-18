/**
 * @jest-environment node
 */
import { AssistantBlock, AssistantFeedbackBlock } from '@nia/prism/core/blocks';
import { createTestAssistant, createTestAssistantFeedback, createTestTenant } from '@nia/prism/testing';
import { NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
// Mock the auth middleware module
// eslint-disable-next-line import/order
import { testSessionUser } from '@nia/prism/testing';
// import the route AFTER mocks are set up
// eslint-disable-next-line import/order
import { POST } from '../src/app/api/log-assistant-feedback/route';


describe('Assistant Feedback API Tests (postgres)', () => {
  beforeEach(async () => {
    expect(testSessionUser).not.toBeNull();
  });

  it('should create and find a valid assistant feedback item', async () => {
    // define a tenant
    const tenant = await createTestTenant();
    // Create assistant
    const assistantData = {
      name: 'KWM Assistant A',
      tenantId: tenant._id,
    } as AssistantBlock.IAssistant;

    // create & validate assistant
    const assistant = await createTestAssistant(assistantData);
    expect(assistant._id).toBeTruthy();

    const targetSubDomain = assistant.subDomain;

    // define some keywords
    const feedbackData = {
      assistant_id: assistant._id,
      call_id: uuidv4(),
      feedback_type: AssistantFeedbackBlock.FeedbackType.IMPROVEMENT,
      description: 'Air fresheners in the latrine',
      conversation_context: 'casual', 
      reported_by: 'Bob Loblaw',
      reported_at: new Date().toISOString(),
      status: AssistantFeedbackBlock.StatusType.UNDER_REVIEW,
      severity: AssistantFeedbackBlock.SeverityType.MEDIUM,
    };

    // Transform the data into a page
    const feedbackResponse = await createTestAssistantFeedback(feedbackData);
    expect(feedbackResponse._id).toBeTruthy();

    // Create a NextRequest object
    const newFeedbackPostData = {
      agent: targetSubDomain,
      description: 'Would love to have my sheets changed',
      callId: uuidv4(),
    };

    const url = `http://localhost:3000/api/log-assistant-feedback`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newFeedbackPostData),
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(200);
    const data = await response.json();
    expect('success' in data).toBeTruthy();
    expect('message' in data).toBeTruthy();
    expect('data' in data).toBeTruthy();
    expect(data.success).toEqual(true);
    expect(data.message).toEqual('Feedback logged successfully');
    expect(data.data).not.toBeNull();
    expect(data.data.description).toBe(newFeedbackPostData.description);
  });

  it('should return an error if the assistant is not found', async () => {
    // Create a NextRequest object
    const newFeedbackPostData = {
      agent: 'non-existent-assistant',
      description: 'Would love to have my sheets changed',
      callId: uuidv4(),
    };

    const url = `http://localhost:3000/api/log-assistant-feedback`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newFeedbackPostData),
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe('Assistant not found');
  });

  it('should return an error if no assistant agent is provided', async () => {
    // Create a NextRequest object
    const newFeedbackPostData = {
      description: 'Would love to have my sheets changed',
      callId: uuidv4(),
    };

    const url = `http://localhost:3000/api/log-assistant-feedback`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newFeedbackPostData),
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Assistant agent is required');
  });

  it('should return an error if the description is not specified', async () => {
    // define a tenant
    const tenant = await createTestTenant();
    // Create assistant
    const assistantData = {
      name: 'KWM Assistant B',
      tenantId: tenant._id,
    } as AssistantBlock.IAssistant;

    // create & validate assistant
    const assistant = await createTestAssistant(assistantData);
    expect(assistant._id).toBeTruthy();

    const targetSubDomain = assistant.subDomain;

    // Create a NextRequest object
    const newFeedbackPostData = {
      agent: targetSubDomain,
      callId: uuidv4(),
    };

    const url = `http://localhost:3000/api/log-assistant-feedback`;
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newFeedbackPostData),
    };
    const request = new Request(url, options);
    const req = new NextRequest(request);

    // Call the POST function
    const response = await POST(req);

    // Assert the response
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Description is required');
  });
});
