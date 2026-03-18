/**
 * Shared API authentication helper.
 * Routes can call `requireAuth(req)` to enforce either:
 *   1. A valid next-auth session (browser cookie), OR
 *   2. The `x-shared-secret` header matching MESH_SHARED_SECRET
 *
 * Returns null if authenticated, or a 401 NextResponse to return early.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

export async function requireAuth(req: NextRequest): Promise<NextResponse | null> {
  // In test mode, bypass authentication (matches middleware.ts and page.tsx behavior)
  if (
    process.env.TEST_MODE === 'true' ||
    process.env.NEXT_PUBLIC_TEST_MODE === 'true' ||
    process.env.NEXT_PUBLIC_TEST_ANONYMOUS_USER === 'true'
  ) {
    return null; // test mode — no auth required
  }

  // Check shared secret header first (fast path for internal/mesh calls)
  const secret = req.headers.get('x-shared-secret');
  const meshSecret = process.env.MESH_SHARED_SECRET;
  if (meshSecret && secret === meshSecret) {
    return null; // authenticated
  }

  // Check next-auth session (browser cookie path)
  try {
    const session = await getServerSession(interfaceAuthOptions);
    if (session?.user) {
      return null; // authenticated
    }
  } catch {
    // Session check failed, fall through to 401
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
