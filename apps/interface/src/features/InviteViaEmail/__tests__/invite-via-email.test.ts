/**
 * Tests for /api/invite-friend endpoint (InviteViaEmail feature)
 */
import { POST } from '../routes/route';
import { sendEmail } from '@interface/utils/sendMail';
import { NextRequest } from 'next/server';

// Mock the sendEmail utility
jest.mock('@interface/utils/sendMail');

const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

describe('InviteViaEmail feature - /api/invite-friend', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should send an invitation email with correct parameters', async () => {
    mockedSendEmail.mockResolvedValue({ messageId: 'test-message-id' });

    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.messageId).toBe('test-message-id');
    expect(mockedSendEmail).toHaveBeenCalledWith({
      to: 'test@example.com',
      from: expect.any(String),
      name: 'Pearlos',
      subject: 'You have been invited to Pearlos',
      message: expect.stringContaining('https://rsvp.pearlos.org/'),
    });
    
    // Verify the HTML message contains the invite link
    const callArgs = mockedSendEmail.mock.calls[0][0];
    expect(callArgs.message).toContain('https://rsvp.pearlos.org/');
    expect(callArgs.message).toContain('You\'ve Been Invited to Pearlos');
  });

  it('should return 400 for missing email', async () => {
    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Email is required');
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it('should return 400 for invalid email format', async () => {
    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'invalid-email' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid email format');
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it('should trim whitespace from email', async () => {
    mockedSendEmail.mockResolvedValue({ messageId: 'test-message-id' });

    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: '  test@example.com  ' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'test@example.com',
      })
    );
  });

  it('should return 500 when sendEmail fails', async () => {
    mockedSendEmail.mockRejectedValue(new Error('SES error'));

    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe('Failed to send invitation');
    expect(data.details).toBe('SES error');
  });

  it('should include the rsvp link in the email body', async () => {
    mockedSendEmail.mockResolvedValue({ messageId: 'test-message-id' });

    const request = new NextRequest('http://localhost:3000/api/invite-friend', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'friend@example.com' }),
    });

    await POST(request);

    const callArgs = mockedSendEmail.mock.calls[0][0];
    expect(callArgs.message).toContain('href="https://rsvp.pearlos.org/"');
    expect(callArgs.message).toMatch(/You've Been Invited/i);
    expect(callArgs.message).toContain('the human-first intelligent environment for creation, collaboration and connection');
    expect(callArgs.message).toContain('celebrate at the speed of imagination');
    expect(callArgs.message).toContain('linear-gradient'); // Gradient styling
    expect(callArgs.message).toContain('be first in line for early access');
  });
});

