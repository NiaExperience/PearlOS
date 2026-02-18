import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { POST_impl } from '@nia/prism/core/routes/users/reset-password/route';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest): Promise<NextResponse> {
  return POST_impl(req, interfaceAuthOptions);
}
