import { NextRequest, NextResponse } from 'next/server';
import { UserActions } from '@nia/prism/core/actions';
import { getLogger } from '@nia/prism/core/logger';

const log = getLogger('prism:register');

/**
 * POST /api/users/register
 * Body: { name: string, email: string, password: string, confirmPassword: string }
 * Public self-registration endpoint. Creates a new user with bcrypt-hashed password.
 */
export async function POST_impl(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });

    const { name, email, password, confirmPassword } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ success: false, error: 'Name is required' }, { status: 400 });
    }
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email is required' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ success: false, error: 'Invalid email address' }, { status: 400 });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json({ success: false, error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ success: false, error: 'Passwords do not match' }, { status: 400 });
    }

    await UserActions.createUser({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
    } as any);

    log.info('New user registered via self-signup', { email: email.toLowerCase().trim() });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    log.error('Registration failed', { error: e.message });
    if (String(e?.message || '').toLowerCase().includes('already exists')) {
      return NextResponse.json({ success: false, error: 'An account with this email already exists' }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
