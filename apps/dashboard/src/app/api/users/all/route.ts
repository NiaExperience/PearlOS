export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { Prism } from '@nia/prism';
import { BlockType_User } from '@nia/prism/core/blocks/user.block';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

/**
 * SUPERADMIN ONLY: Return all users platform-wide (capped for safety)
 * GET /api/users/all
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session?.user?.id || !isSuperAdmin(session.user.id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const prism = await Prism.getInstance();
    const query: any = {
      contentType: BlockType_User,
      tenantId: 'any',
      where: {},
      orderBy: { createdAt: 'desc' },
    };
    const result = await prism.query(query);
    // Limit to 1000 to avoid huge payloads (adjust if needed)
    const users = (result.items || []).slice(0, 1000);
    return NextResponse.json({ users });
  } catch (e: any) {
    console.error('Users ALL route error', e);
    return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  }
}
