import { POST_impl } from '@nia/prism/core/routes/users/register/route';
import { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return POST_impl(req);
}
