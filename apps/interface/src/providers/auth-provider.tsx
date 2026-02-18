'use server';

import { AuthProvider as SharedAuthProvider } from '@nia/prism/core/components/auth/auth-provider';

import { interfaceAuthOptions } from '../lib/auth-config';

export async function AuthProvider({ children, basePath = '/api/auth' }: { children: React.ReactNode; basePath?: string }) {
  return <SharedAuthProvider authOptions={interfaceAuthOptions} basePath={basePath}>{children}</SharedAuthProvider>;
} 