/**
 * Basic test for new SES v3 sendEmail utility.
 * Uses module isolation so prior imports elsewhere don't defeat our mocks.
 */

describe('sendMail (SES v3)', () => {
  it('sends email and returns messageId', async () => {
    // Ensure a clean module registry so the util is re-evaluated with our mock
    jest.resetModules();

    const sendFn = jest.fn().mockResolvedValue({ MessageId: 'mock-id-123' });
    // Dynamically mock AWS SDK v3 SES client
    jest.doMock('@aws-sdk/client-ses', () => ({
      SESClient: jest.fn().mockImplementation(() => ({ send: sendFn })),
      SendEmailCommand: jest.fn().mockImplementation((input) => ({ __input: input })),
    }));

    // Import after mocks so constructor runs against mocked implementation
  // Use require via createRequire to avoid TS extension resolution issues in test context
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { sendEmail } = require('../src/utils/sendMail');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

    const res = await sendEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      name: 'From Name',
      subject: 'Hello',
      message: '<p>Hi there</p>',
    });

    expect(res.messageId).toBe('mock-id-123');
    expect(SESClient).toHaveBeenCalledTimes(1);
    expect(SendEmailCommand).toHaveBeenCalledTimes(1);
    const callArg = (SendEmailCommand as any).mock.calls[0][0];
    expect(callArg.Destination.ToAddresses).toEqual(['to@example.com']);
    expect(callArg.Source).toContain('From Name');
    // Ensure send invoked with our command shape wrapper
    expect(sendFn).toHaveBeenCalledWith(expect.objectContaining({ __input: expect.any(Object) }));
  });

  it('throws when SES send fails', async () => {
    jest.resetModules();
    const error = new Error('SES failure');
    const sendFn = jest.fn().mockRejectedValue(error);
    jest.doMock('@aws-sdk/client-ses', () => ({
      SESClient: jest.fn().mockImplementation(() => ({ send: sendFn })),
      SendEmailCommand: jest.fn().mockImplementation((input) => ({ __input: input })),
    }));
    const { sendEmail } = require('../src/utils/sendMail');
    await expect(sendEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      name: 'From Name',
      subject: 'Hello',
      message: '<p>Hi there</p>',
    })).rejects.toThrow('SES failure');
    expect(sendFn).toHaveBeenCalled();
  });
});
