/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/waitlist/route';
import { sendEmail } from '@interface/utils/sendMail';

jest.mock('@interface/utils/sendMail', () => ({
  sendEmail: jest.fn(),
}));

describe('Waitlist API', () => {
  const originalEnv = process.env;
  const fetchMock = jest.fn();
  const sendEmailMock = sendEmail as jest.MockedFunction<typeof sendEmail>;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = {
      ...originalEnv,
      NOTION_API_KEY: 'test-notion-key',
      NOTION_WAITLIST_DB_ID: 'test-db-id',
      WAITLIST_SOURCE: 'pearlos.org',
      EMAIL_FROM: 'hello@pearlos.org',
    };
    global.fetch = fetchMock as unknown as typeof fetch;
    sendEmailMock.mockResolvedValue({ messageId: 'test-email-id' });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function buildRequest(body: unknown): NextRequest {
    const request = new Request('http://localhost:3000/api/waitlist', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return new NextRequest(request);
  }

  it('returns 500 when Notion env vars are missing', async () => {
    delete process.env.NOTION_API_KEY;
    const response = await POST(buildRequest({ email: 'new@user.com' }));
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Server misconfigured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid email', async () => {
    const response = await POST(buildRequest({ email: 'not-an-email' }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('Please enter a valid email address');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns duplicate success when email is already on waitlist', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ id: 'existing-row' }] }),
    });

    const response = await POST(buildRequest({ email: 'Existing@User.com' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.duplicate).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('creates waitlist row when email is new', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-page-id' }),
      });

    const response = await POST(buildRequest({ email: 'new@user.com' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.message).toContain('waitlist');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@user.com',
      from: 'hello@pearlos.org',
      name: 'PearlOS',
      subject: 'You are on the PearlOS waitlist',
      message: expect.stringContaining('Thanks for joining the PearlOS waitlist.'),
    }));
  });

  it('does not fail signup when confirmation email fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'new-page-id' }),
      });
    sendEmailMock.mockRejectedValueOnce(new Error('SES unavailable'));

    const response = await POST(buildRequest({ email: 'new@user.com' }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('returns 502 when Notion create call fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: [] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ message: 'Notion create failed' }),
      });

    const response = await POST(buildRequest({ email: 'new@user.com' }));
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toContain('Waitlist create failed');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
