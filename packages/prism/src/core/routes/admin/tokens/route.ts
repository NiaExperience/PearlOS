import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { NextAuthOptions } from 'next-auth';
import { BlockType_ResetPasswordToken } from '../../../actions/reset-password-token-constants';
import { Prism } from '../../../../prism';

/**
 * GET /api/admin/tokens?userId=...&purpose=invite_activation|password_reset&active=1
 * Lists token records (hashed) for admin/debug. Requires authenticated session (TODO: enforce admin role).
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<Response> {
  try {
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const userId = url.searchParams.get('userId') || undefined;
    const purpose = url.searchParams.get('purpose') as any;
    const active = url.searchParams.get('active');
    const prism = await Prism.getInstance();
    const where: any = {};
    if (userId) where.parent_id = userId;
    if (purpose === 'invite_activation' || purpose === 'password_reset') {
      where.indexer = { path: 'purpose', equals: purpose };
    }
    const query: any = {
      contentType: BlockType_ResetPasswordToken,
      tenantId: 'any',
      where,
      orderBy: { createdAt: 'desc' as const }
    };
    const result = await prism.query(query);
    let items: any[] = result.items || [];
    if (active) {
      const now = Date.now();
      items = items.filter(t => !t.consumedAt && new Date(t.expiresAt).getTime() > now);
    }
    const redacted = items.map(t => ({
      id: t._id,
      userId: t.userId,
      email: t.email,
      purpose: t.purpose,
      expiresAt: t.expiresAt,
      consumedAt: t.consumedAt || null,
      attempts: t.attempts || 0,
      tokenHash: t.tokenHash
    }));
    return NextResponse.json({ success: true, total: redacted.length, items: redacted });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message || 'Server error' }, { status: 500 });
  }
}
