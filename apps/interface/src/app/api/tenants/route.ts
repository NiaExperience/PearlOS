export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from 'next/server';
import { GET_impl, POST_impl } from '@nia/prism/core/routes/tenants/route';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

/**
 * API route to fetch tenants for the authenticated user
 * GET /api/tenants
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, interfaceAuthOptions);
}

/**
 * API route to create a new tenant
 * POST /api/tenants
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return POST_impl(req, interfaceAuthOptions);
}
