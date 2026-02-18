import { consumeResetToken, issueResetToken, sendEmail } from '../src/core/email';

jest.mock('nodemailer', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'msg123' });
  return {
    __esModule: true,
    default: {
      createTestAccount: jest.fn().mockResolvedValue({ smtp: { host: 'localhost', port: 1025, secure: false }, user: 'u', pass: 'p' }),
      createTransport: jest.fn().mockReturnValue({ sendMail }),
      getTestMessageUrl: jest.fn().mockReturnValue('preview-url')
    }
  };
});

describe('password reset token store (encrypted+hashed)', () => {
  beforeAll(() => {
  // Force memory path for this basic flow test; persistence covered in password-flow-persistence.test.ts
  process.env.RESET_TOKEN_PERSISTENCE = 'disabled';
    if (!process.env.TOKEN_ENCRYPTION_KEY) {
      process.env.TOKEN_ENCRYPTION_KEY = Buffer.from('test-key-32-bytes-length-1234xyz').toString('base64');
    }
  });
  it('issues and consumes token', async () => {
    const token = await issueResetToken('user123', 'u@example.com');
    expect(typeof token).toBe('string');
    const data = await consumeResetToken(token);
    expect(data).toMatchObject({ userId: 'user123', email: 'u@example.com' });
    expect(await consumeResetToken(token)).toBeNull(); // one-time use
  });
});

describe('email send', () => {
  it('sendEmail returns messageId and previewUrl', async () => {
    const res = await sendEmail({ to: 'x@example.com', subject: 'Subj', html: '<p>Hi</p>' });
    expect(res.messageId).toBe('msg123');
    expect(res.previewUrl).toBeDefined();
  });
});
