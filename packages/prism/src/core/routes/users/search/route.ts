import { requireAuth } from '@nia/prism/core/auth';
import { isSuperAdmin } from '@nia/prism/core/auth/auth.middleware';
import { getSessionSafely } from '@nia/prism/core/auth/getSessionSafely';
import { BlockType_User } from '@nia/prism/core/blocks/user.block';
import { NextRequest, NextResponse } from 'next/server';
import { NextAuthOptions } from 'next-auth';

import { Prism } from '../../../../prism';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:users:search');

// GET /api/users/search?q=...  (SUPERADMIN only)
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<NextResponse> {
  const authError = await requireAuth(req, authOptions);
  if (authError) return authError as NextResponse;
  const session = await getSessionSafely(req, authOptions);
  if (!session?.user?.id || !isSuperAdmin(session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const q = req.nextUrl.searchParams.get('q');
  if (!q || q.length < 2) return NextResponse.json({ error: 'q (min 2 chars) required' }, { status: 400 });
  try {
    const prism = await Prism.getInstance();
    // naive scan (future: add indexed field queries)
    const query = {
      contentType: BlockType_User,
      tenantId: 'any',
      where: {},
      orderBy: { createdAt: 'desc' as const }
    } as any;
    const result = await prism.query(query);
  // TODO(pagination): Replace naive filter + slice with cursor-based pagination once available
  const filtered = (result.items || []).filter((u: any) => (u.email && u.email.toLowerCase().includes(q.toLowerCase())) || (u.name && u.name.toLowerCase().includes(q.toLowerCase()))).slice(0, 50);
    return NextResponse.json({ users: filtered });
  } catch (e) {
    log.error('USER SEARCH error', { error: e, query: q });
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
