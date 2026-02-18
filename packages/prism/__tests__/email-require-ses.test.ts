import { sendEmail } from '../src/core/email';

describe('EMAIL_REQUIRE_SES enforcement', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.AWS_REGION;
    delete process.env.AWS_SES_REGION;
    delete process.env.SMTP_HOST;
    process.env.EMAIL_FROM = 'no-reply@example.com';
    process.env.EMAIL_REQUIRE_SES = 'true';
  (process.env as any).NODE_ENV = 'development';
  });
  afterAll(() => { process.env = OLD_ENV; });

  it('throws if SES required but not configured', async () => {
    await expect(sendEmail({ to: 'user@example.com', subject: 'Hi', html: '<p>Hi</p>' }))
      .rejects.toThrow(/SES required/);
  });
});
