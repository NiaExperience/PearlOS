import { UserActions } from '@nia/prism/core/actions';
import { getSessionSafely } from '@nia/prism/core/auth';
import { IUser } from '@nia/prism/core/blocks/user.block';
import { NextAuthOptions } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/users/set-password
 * Body: { password: string, confirmPassword: string }
 * Requires authenticated credentials user with mustSetPassword flag (no existing password_hash)
 */
export async function POST_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<Response> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { password, confirmPassword } = body || {};
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Passwords do not match' }, { status: 400 });
    }
    // Fetch user to ensure they still lack a password
    const userResult = await UserActions.getUserById(session.user.id);
    if (!userResult) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }
    if (userResult.password_hash) {
      return NextResponse.json({ success: false, error: 'Password already set' }, { status: 409 });
    }
    // Use existing action to update password via updateUser (hashing occurs inside)
    const updateResp = await UserActions.updateUser(session.user.id, { ...(userResult as IUser), password });
    if (!updateResp.success) {
      return NextResponse.json({ success: false, error: updateResp.error || 'Failed to set password' }, { status: updateResp.statusCode || 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
