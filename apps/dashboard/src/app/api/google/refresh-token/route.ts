import { POST_impl } from '@nia/prism/core/routes/google/refresh-token/route';
import { NextRequest } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

/**
 * API route to handle token refresh requests
 * POST /api/google/refresh-token
 */
export async function POST(request: NextRequest) {
  return POST_impl(request, dashboardAuthOptions);
}
