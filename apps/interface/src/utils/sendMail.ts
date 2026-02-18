import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

import { getLogger } from '@interface/lib/logger';

// Configure SES client (v3). Use default credential chain; fall back to env vars if explicitly provided.
const sesClient = new SESClient({
  region: process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  } : undefined,
});

interface SendEmailParams {
  to: string;
  from: string;
  subject: string;
  message: string;
  name: string;
}

interface SendEmailResponse {
  messageId: string;
}

export async function sendEmail({ to, from, name, subject, message }: SendEmailParams): Promise<SendEmailResponse> {
  const log = getLogger('[sendMail]');
  try {
    const command = new SendEmailCommand({
      Destination: { ToAddresses: [to] },
      Source: `${name} <${from}>`,
      Message: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: { Html: { Data: message, Charset: 'UTF-8' }, Text: { Data: message.replace(/<[^>]+>/g, ''), Charset: 'UTF-8' } },
      },
      ReplyToAddresses: [from],
    });
    const resp = await sesClient.send(command);
    log.info('email sent via ses', {
      messageId: resp.MessageId || 'unknown',
    });
    return { messageId: resp.MessageId || 'unknown' };
  } catch (error) {
    log.error('error sending email via ses v3', {
      error,
    });
    throw error;
  }
}
