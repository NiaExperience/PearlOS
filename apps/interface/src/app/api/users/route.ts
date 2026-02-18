export const dynamic = "force-dynamic";
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { GET_impl, POST_impl } from '@nia/prism/core/routes/users/route';
import { NextRequest, NextResponse } from 'next/server';

/**
 * API route to get users for a tenant
 * GET /api/users?tenantId=xxx
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, interfaceAuthOptions);
}

/**
 * API route to create or update a user for a tenant
 * POST /api/users
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return POST_impl(req, interfaceAuthOptions);
}
