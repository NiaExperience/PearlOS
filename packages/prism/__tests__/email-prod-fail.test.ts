import { sendEmail } from '../src/core/email';

describe('sendEmail production hard fail when unconfigured', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.AWS_REGION;
    delete process.env.AWS_SES_REGION;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
  (process.env as any).NODE_ENV = 'production';
    process.env.EMAIL_FROM = 'admin@niaxp.com';
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('throws when neither SES nor SMTP configured in production', async () => {
    await expect(sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' }))
      .rejects.toThrow(/(No SES region or SMTP configuration|SES required but not configured)/);
  });
});
