export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { GET_impl } from '@nia/prism/core/routes/content/list/route';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

/**
 * API route to handle content list retrieval
 * GET /api/contentList
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, interfaceAuthOptions);
}
