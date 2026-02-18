import { NextRequest, NextResponse } from 'next/server';
import { GET_impl } from '@nia/prism/core/routes/content/list/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

/**
 * API route to handle content list retrieval
 * GET /api/contentList
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, dashboardAuthOptions);
}