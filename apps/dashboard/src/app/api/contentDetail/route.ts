import { NextRequest, NextResponse } from 'next/server';
import { GET_impl, POST_impl, PUT_impl, DELETE_impl } from '@nia/prism/core/routes/content/detail/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function GET(req: NextRequest): Promise<NextResponse> {
  return GET_impl(req, dashboardAuthOptions);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return POST_impl(req, dashboardAuthOptions);
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  return PUT_impl(req, dashboardAuthOptions);
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return DELETE_impl(req, dashboardAuthOptions);
}