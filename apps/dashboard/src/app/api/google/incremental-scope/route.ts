import { GET_impl, POST_impl } from '@nia/prism/core/routes/google/incremental-scope/route';
import { NextRequest } from 'next/server';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
/**
 * API route to handle Google OAuth incremental authorization callback
 * GET /api/google/callback
 */
export async function GET(request: NextRequest) {
  return GET_impl(request, dashboardAuthOptions);
}

/**
 * API route to handle incremental authorization requests
 * POST /api/google/incremental-scope
 */
export async function POST(request: NextRequest) {
  return POST_impl(request, dashboardAuthOptions);
}