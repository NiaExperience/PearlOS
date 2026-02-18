import { NextRequest, NextResponse } from 'next/server';
import { GET_impl, POST_impl } from '@nia/prism/core/routes/content/definitions/route';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

/**
 * API route to handle dynamic content definitions retrieval
 * GET /api/dynamicContent
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, interfaceAuthOptions);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return POST_impl(req, interfaceAuthOptions);
}