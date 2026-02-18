import { NextRequest, NextResponse } from 'next/server';
import { verifyResetToken } from '@nia/prism/core/email';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  if (!token) return NextResponse.json({ success: false, error: 'Missing token' }, { status: 400 });
  const info = await verifyResetToken(token, ['invite_activation']);
  if (!info) return NextResponse.json({ success: false, error: 'Invalid or expired' }, { status: 400 });
  return NextResponse.json({ success: true, email: info.email, userId: info.userId, consumed: info.consumed || false });
}
