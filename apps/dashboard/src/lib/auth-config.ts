import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { NextAuthOptions } from 'next-auth';
import DiscordProvider from 'next-auth/providers/discord';

const isProduction = process.env.NODE_ENV === 'production';

function tryGetOrigin(urlLike?: string): string | null {
  if (!urlLike) return null;
  try {
    return new URL(urlLike).origin;
  } catch {
    return null;
  }
}

function resolveDashboardUrl(): string {
  const configured =
    process.env.NEXTAUTH_DASHBOARD_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_DASHBOARD_URL;

  if (configured) return configured;
  if (!isProduction) return 'http://localhost:4000';
  throw new Error('Missing dashboard base URL configuration. Set NEXTAUTH_DASHBOARD_URL in production.');
}

// Set the NEXTAUTH_URL for the dashboard
const defaultUrl = resolveDashboardUrl();
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || process.env.NEXTAUTH_DASHBOARD_URL || defaultUrl;

// Create auth options for dashboard with app-specific configuration
const authConfig = {
  appType: 'dashboard' as const,
  baseUrl: process.env.NEXTAUTH_DASHBOARD_URL || defaultUrl,
  googleCredentials: {
    clientId: process.env.GOOGLE_DASHBOARD_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_DASHBOARD_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET!,
  },
  cookiePrefix: 'dashboard-auth',
  pages: {
    signIn: '/dashboard/login',
    error: '/unauthorized', // Redirect auth errors to unauthorized page
  },
  redirectHandler: (url: string, baseUrl: string) => {
    // Prefer runtime request origin to support dynamic cloud hosts.
    const runtimeOrigin = tryGetOrigin(baseUrl);
    const configuredOrigin =
      tryGetOrigin(process.env.NEXT_PUBLIC_DASHBOARD_URL) ||
      tryGetOrigin(process.env.NEXTAUTH_DASHBOARD_URL) ||
      tryGetOrigin(process.env.NEXTAUTH_URL) ||
      tryGetOrigin(defaultUrl);
    const effectiveOrigin = runtimeOrigin || configuredOrigin || 'http://localhost:4000';
    const dashboardUrl = `${effectiveOrigin}/`;

    // For dashboard, redirect to a concrete landing page after sign-in
    if (url.startsWith(baseUrl) || url.startsWith(dashboardUrl)) {
      if (url.includes('/auth/signin') || url.includes('/dashboard/login')) {
        return new URL("/dashboard/assistants", dashboardUrl).toString();
      }
      return url;
    }
    return new URL("/dashboard/assistants", dashboardUrl).toString();
  }
};

const baseAuthOptions = createAuthOptions(authConfig);

// Dashboard-specific auth configuration
// Inject Discord OAuth provider if credentials are configured
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordClientSecret = process.env.DISCORD_CLIENT_SECRET;
const providersWithDiscord = discordClientId && discordClientSecret
  ? [
      ...(baseAuthOptions.providers || []),
      DiscordProvider({
        clientId: discordClientId,
        clientSecret: discordClientSecret,
        authorization: { params: { scope: 'identify email' } },
      }),
    ]
  : baseAuthOptions.providers;

export const dashboardAuthOptions: NextAuthOptions = {
  ...baseAuthOptions,
  providers: providersWithDiscord,
}; 