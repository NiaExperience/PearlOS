import { NextRequest, NextResponse } from 'next/server';
import { UserActions } from '@nia/prism/core/actions';
import { hash } from 'bcryptjs';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { name, email, password } = await req.json();
    if (!name || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Hash the password before storing
    const password_hash = await hash(password, 10);
    const userData = {
      name,
      email,
      password_hash,
    };
    const user = await UserActions.createUser(userData as any);
    if (user) {
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Registration failed' }, { status: 500 });
  }
} 