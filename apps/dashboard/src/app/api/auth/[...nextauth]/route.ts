import NextAuth from 'next-auth';
import { DefaultSession } from 'next-auth';
import { dashboardAuthOptions } from '../../../../lib/auth-config';

export const dynamic = "force-dynamic";
// Explicitly handle errors
const handler = NextAuth(dashboardAuthOptions);
export { handler as GET, handler as POST }; 