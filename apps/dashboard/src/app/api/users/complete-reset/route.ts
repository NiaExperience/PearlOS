import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { POST_impl } from '@nia/prism/core/routes/users/complete-reset/route';

const authOptions = createAuthOptions({
  appType: 'dashboard',
  baseUrl: process.env.DASHBOARD_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:4000',
  googleCredentials: { clientId: process.env.GOOGLE_CLIENT_ID || '', clientSecret: process.env.GOOGLE_CLIENT_SECRET || '' }
});

export async function POST(req: Request) {
  return POST_impl(req as any, authOptions as any);
}
