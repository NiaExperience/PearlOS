'use server';

import { dashboardAuthOptions } from '../lib/auth-config';
import { AuthProvider as SharedAuthProvider } from '@nia/prism/core/components/auth/auth-provider';

export async function AuthProvider({ children, basePath = '/api/auth' }: { children: React.ReactNode; basePath?: string }) {
  return <SharedAuthProvider authOptions={dashboardAuthOptions} basePath={basePath}>{children}</SharedAuthProvider>;
} 