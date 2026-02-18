import { sendEmail } from '../src/core/email';

jest.mock('@aws-sdk/client-ses', () => {
  return {
    SESClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({ MessageId: 'ses-id-123' }) })),
    SendEmailCommand: jest.fn().mockImplementation((args) => ({ args })),
  };
});

// Nodemailer test account creation can be noisy; stub it when SES path is active fallback not needed here.
jest.mock('nodemailer', () => {
  const original = jest.requireActual('nodemailer');
  return {
    ...original,
    createTestAccount: jest.fn().mockResolvedValue({ smtp: { host: 'localhost', port: 2525, secure: false }, user: 'u', pass: 'p' }),
    createTransport: jest.fn().mockReturnValue({ sendMail: jest.fn().mockResolvedValue({ messageId: 'local-id', response: '250 OK' }) }),
    getTestMessageUrl: jest.fn().mockReturnValue(undefined),
  };
});

describe('sendEmail SES integration', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AWS_REGION = 'us-east-2';
    process.env.EMAIL_FROM = 'admin@niaxp.com';
    delete process.env.SMTP_HOST; // ensure SES not blocked by SMTP
    delete process.env.EMAIL_FORCE_SES;
    delete process.env.EMAIL_REQUIRE_SES;
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('skips SES by default in test env (falls back to local transport)', async () => {
    const res = await sendEmail({ to: 'skip@example.com', subject: 'Skip', html: '<b>Hi</b>' });
    expect(res.messageId).toBe('local-id');
  });

  it('uses SES when EMAIL_FORCE_SES=true', async () => {
    process.env.EMAIL_FORCE_SES = 'true';
    const res = await sendEmail({ to: 'force@example.com', subject: 'Force', html: '<b>Hi</b>' });
    expect(res.messageId).toBe('ses-id-123');
  });
});
