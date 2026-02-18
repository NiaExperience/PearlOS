import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '@interface/utils/sendMail';
import { generateInviteEmailHtml } from '../lib/email-template';

import { getLogger } from '@interface/lib/logger';

const logger = getLogger('InviteFriendRoute');

export const dynamic = 'force-dynamic';

interface InviteFriendRequest {
  email: string;
}

/**
 * POST /api/invite-friend
 * Sends a friend invitation email via AWS SES
 */
export async function POST_impl(req: NextRequest): Promise<NextResponse> {
  try {
    const body: InviteFriendRequest = await req.json();
    const { email } = body;

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 }
      );
    }

    // Basic email format validation
    const emailRegex = /.+@.+\..+/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      );
    }

    // Generate email content
    const inviteLink = 'https://rsvp.pearlos.org/';
    const htmlMessage = generateInviteEmailHtml({ inviteLink });

    // Send email via AWS SES
    const fromEmail = process.env.EMAIL_FROM as string;
    const result = await sendEmail({
      to: email.trim(),
      from: fromEmail,
      name: 'Pearlos',
      subject: 'You have been invited to Pearlos',
      message: htmlMessage,
    });

      logger.info('Invitation sent', { email: email.trim(), messageId: result.messageId });

    return NextResponse.json(
      { 
        success: true, 
        messageId: result.messageId,
        message: `Invitation sent to ${email.trim()}` 
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Error sending invitation', { error });
    return NextResponse.json(
      { 
        error: 'Failed to send invitation',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Export as POST for Next.js API route compatibility
export { POST_impl as POST };

