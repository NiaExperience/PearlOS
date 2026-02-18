'use client';

import { SessionProvider } from "next-auth/react";
import { Session } from "next-auth";

interface AuthProviderClientProps {
  children: React.ReactNode;
  session: Session | null;
}

export function AuthProviderClient({ children, session }: AuthProviderClientProps) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
} 