import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { POST_impl } from '@nia/prism/core/routes/users/set-password/route';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return POST_impl(req, interfaceAuthOptions);
}
