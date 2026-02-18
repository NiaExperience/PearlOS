import { NextRequest, NextResponse } from 'next/server';
import { GET_impl } from '@nia/prism/core/routes/users/me/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

/**
 * API route to get the current user profile
 * GET /api/users/me
 */
export async function GET(req: NextRequest): Promise<Response> {
  const disableAuth =
    process.env.DISABLE_DASHBOARD_AUTH === 'true' &&
    (req.nextUrl.hostname === 'localhost' || req.nextUrl.hostname === '127.0.0.1');

  if (disableAuth) {
    // Local dev: return a stub user so the dashboard can operate without NextAuth.
    return NextResponse.json({
      user: {
        _id: 'local-dev-admin',
        id: 'local-dev-admin',
        name: 'Local Admin',
        email: 'local-admin@localhost',
        is_anonymous: false,
      },
    });
  }

  return GET_impl(req, dashboardAuthOptions);
}