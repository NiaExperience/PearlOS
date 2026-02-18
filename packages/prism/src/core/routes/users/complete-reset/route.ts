import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';
import { consumeResetToken } from '@nia/prism/core/email';
import { UserActions } from '@nia/prism/core/actions';

/**
 * POST /api/users/complete-reset
 * Body: { token: string, password: string, confirmPassword: string }
 */
export async function POST_impl(req: NextRequest, _authOptions: NextAuthOptions): Promise<NextResponse> {
  try {
    const body = await req.json();
    const { token, password, confirmPassword } = body || {};
    if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
    if (!password || password.length < 8) return NextResponse.json({ success: false, error: 'Password too short' }, { status: 400 });
    if (password !== confirmPassword) return NextResponse.json({ success: false, error: 'Passwords do not match' }, { status: 400 });
  const tokenData = await consumeResetToken(token);
    if (!tokenData) return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 400 });
    // Update user password
  const existing = await UserActions.getUserById(tokenData.userId);
  if (!existing) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  // Build minimal update object preserving required props
  const updatePayload: any = { ...existing, password };
  await UserActions.updateUser(tokenData.userId, updatePayload);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
