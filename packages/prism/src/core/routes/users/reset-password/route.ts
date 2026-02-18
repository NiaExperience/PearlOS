import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { issueResetToken, sendEmail } from '@nia/prism/core/email';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:users:reset-password');

/**
 * POST /api/users/reset-password
 * Body: { userId?: string } (optional - default current user) - placeholder flow
 * NOTE: A full reset flow would issue a token via email; this is a stub that validates feasibility.
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(req, authOptions);
    // Issues a password reset token and emails link (token now encrypted & hashed server-side)
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const targetUserId = body.userId || session.user.id;
    const user = await UserActions.getUserById(targetUserId);
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    const email = user.email as string; // ensure present
  // Support either 'id' or '_id' depending on model shape
  // @ts-ignore dynamic
  const uid: string = (user.id || user._id || '').toString();
  const token = await issueResetToken(uid, email);
    const resetLink = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/reset-password?token=${encodeURIComponent(token)}`;
    const { messageId, previewUrl } = await sendEmail({
      to: email,
      subject: 'Reset your Nia password',
      html: `<p>You requested a password reset.</p><p><a href="${resetLink}">Reset Password</a> (valid 30 minutes)</p>`
    });
    log.info('[reset-password] token issued + email sent', { userId: targetUserId, messageId, previewUrl });
    return NextResponse.json({ success: true, tokenIssued: true, messageId, previewUrl });
  } catch (e: any) {
    log.error('RESET PASSWORD error', { error: e });
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
