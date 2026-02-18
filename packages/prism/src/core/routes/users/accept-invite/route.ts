import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { consumeResetToken } from '@nia/prism/core/email';
import { UserActions } from '@nia/prism/core/actions';

/**
 * POST /api/users/accept-invite
 * Body: { token: string, password: string, confirmPassword: string }
 * Consumes invite_activation token and sets initial password.
 */
export async function POST_impl(req: NextRequest, _authOptions: NextAuthOptions): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    const { token, password, confirmPassword } = body;
    // TODO(captcha): If invite acceptance endpoint is ever exposed to untrusted automation (public self-signup), integrate CAPTCHA / rate limiting here.
    if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
    if (!password || password.length < 8) return NextResponse.json({ success: false, error: 'Password too short' }, { status: 400 });
    if (password !== confirmPassword) return NextResponse.json({ success: false, error: 'Passwords do not match' }, { status: 400 });
    const tokenData = await consumeResetToken(token, ['invite_activation']);
    if (!tokenData) return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 400 });
    const existing = await UserActions.getUserById(tokenData.userId);
    if (!existing) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    if (existing.password_hash) return NextResponse.json({ success: false, error: 'User already activated' }, { status: 409 });
    const updatePayload: any = { ...existing, password };
    if (!existing.emailVerified) updatePayload.emailVerified = new Date();
    await UserActions.updateUser(tokenData.userId, updatePayload);
    return NextResponse.json({ success: true, email: existing.email, userId: tokenData.userId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
