import { NextRequest } from 'next/server';
import { POST_impl } from '@nia/prism/core/routes/users/reset-password/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export async function POST(req: NextRequest) {
  return POST_impl(req, dashboardAuthOptions);
}
