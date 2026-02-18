import NextAuth from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

export const dynamic = "force-dynamic";

// Explicitly handle errors
const handler = NextAuth(interfaceAuthOptions);
export { handler as GET, handler as POST };
