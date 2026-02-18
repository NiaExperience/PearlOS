'use server';

import React from "react";
import { getServerSession, NextAuthOptions } from "next-auth";
import { AuthProviderClient } from "./auth-provider-client";

export async function AuthProvider({ 
  children, 
  basePath = '/api/auth',
  authOptions,
}: { 
  children: React.ReactNode;
  basePath?: string;
  authOptions: NextAuthOptions;
}): Promise<JSX.Element> {
  const session = await getServerSession(authOptions);
  return <AuthProviderClient session={session} basePath={basePath}>{children}</AuthProviderClient>;
} 