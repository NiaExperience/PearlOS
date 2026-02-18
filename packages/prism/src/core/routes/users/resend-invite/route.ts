/* eslint-disable @typescript-eslint/no-explicit-any */
import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { issueInviteToken, sendActivationInviteEmail } from '@nia/prism/core/email';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:users');

/**
 * POST /api/users/resend-invite
 * Optional body: { email?: string }
 * If email omitted, uses current session user (must still exist and lack password_hash)
 * NOTE: This is a placeholder that would dispatch an email in a real system.
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<Response> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const targetEmail = body.email as string | undefined;

    let user = null;
    if (targetEmail) {
      user = await UserActions.getUserByEmail(targetEmail);
    } else {
      user = await UserActions.getUserById(session.user.id);
    }
    if (!user) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

  // Simulate an invite resend: Only meaningful if user lacks password
  // TODO(email): Mine prior interface vestigial emailer code (search hooks/useVapi.ts handleMailSend in old repo code) to integrate real delivery.
    const needsPassword = !user.password_hash;
    if (!needsPassword) {
      return NextResponse.json({ success: false, error: 'User already activated' }, { status: 409 });
    }

  const email = user.email as string; // ensured by model
  // Re-issue a fresh invite activation token and send standard invite email
  const uid: string = (user as any).page_id || (user as any)._id || (user as any).id;
  const token = await issueInviteToken(String(uid), String(email));
  const { messageId, previewUrl } = await sendActivationInviteEmail({
    to: email,
    token,
    reqUrl: req.url,
  });
    log.info('Resend invite email sent', { email: user.email, messageId, previewUrl });
    return NextResponse.json({ success: true, queued: true, messageId, previewUrl });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
