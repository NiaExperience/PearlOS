export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { GET_impl, DELETE_impl } from '@nia/prism/core/routes/users/[userId]/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function DELETE(req: NextRequest, context: { params: { userId: string } }): Promise<NextResponse> {
  return DELETE_impl(req, context, dashboardAuthOptions);
}

export async function GET(req: NextRequest, context: { params: { userId: string } }): Promise<NextResponse> {
  return GET_impl(req, context, dashboardAuthOptions);
}
