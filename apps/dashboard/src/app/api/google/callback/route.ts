import { GET_impl } from '@nia/prism/core/routes/google/callback/route';
import { NextRequest } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
/**
 * API route to handle Google OAuth incremental authorization callback
 * GET /api/google/callback
 */
export async function GET(request: NextRequest) {
  return GET_impl(request, dashboardAuthOptions);
}
