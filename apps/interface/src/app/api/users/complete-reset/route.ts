import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { POST_impl } from '@nia/prism/core/routes/users/complete-reset/route';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest):  Promise<NextResponse> {
  return POST_impl(req as any, interfaceAuthOptions );
}
