import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { issueInviteToken, __testTokenMeta, sendActivationInviteEmail } from '@nia/prism/core/email';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:users:invite');

/**
 * POST /api/users/invite
 * Body: { email: string, name?: string }
 * Creates a provisional user (no password) if not exists and issues an invite activation token.
 * Idempotent: if user exists with password -> 409; if exists without password -> re-issue token.
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<Response> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { email, name } = body || {};
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 });
    }
    let user = await UserActions.getUserByEmail(email.toLowerCase());
    if (user && (user as any).password_hash) {
      return NextResponse.json({ success: false, error: 'User already active' }, { status: 409 });
    }
    if (!user) {
      user = await UserActions.createUser({ name: name || email.split('@')[0], email: email.toLowerCase() } as any);
    }
    // @ts-ignore dynamic id
    const uid: string = (user.id || user._id || '').toString();
    const token = await issueInviteToken(uid, user.email as string);
    const { messageId, previewUrl } = await sendActivationInviteEmail({
      to: user.email as string,
      token,
      reqUrl: req.url,
    });
    log.info('[invite] token issued + email queued', { email: user.email, messageId, previewUrl, purpose: 'invite_activation' });
    // Expose token only in test environment to enable end-to-end acceptance test
    const extra: any = {};
    if (process.env.NODE_ENV === 'test') {
      // Expose raw token plus meta for test assertions only
      const meta = __testTokenMeta.get(token);
      extra.token = token;
      if (meta) {
        extra.tokenHash = meta.tokenHash;
        if (meta.recordId) extra.tokenRecordId = meta.recordId;
      }
    }
    return NextResponse.json({ success: true, invited: true, messageId, previewUrl, ...extra });
  } catch (e: any) {
    log.error('INVITE error', { error: e });
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
