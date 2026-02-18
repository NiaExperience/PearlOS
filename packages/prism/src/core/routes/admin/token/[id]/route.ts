import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextAuthOptions } from 'next-auth';
import { deleteResetPasswordToken, getResetPasswordTokenById } from '../../../../actions/reset-password-token-actions';

export async function DELETE_impl(req: NextRequest, { params }: { params: { id: string } }, authOptions: NextAuthOptions) {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const id = params.id;
    const rec = await getResetPasswordTokenById(id);
    if (!rec) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const ok = await deleteResetPasswordToken(id);
    if (!ok) return NextResponse.json({ success: false, error: 'Delete failed' }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
