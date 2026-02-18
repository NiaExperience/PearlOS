import { createAuthOptions } from '@nia/prism/core/auth/authOptions';
import { NextAuthOptions } from 'next-auth';

// Set the NEXTAUTH_URL for the dashboard
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_DASHBOARD_URL || 'http://localhost:4000';

// Create auth options for dashboard with app-specific configuration
const authConfig = {
  appType: 'dashboard' as const,
  baseUrl: process.env.NEXTAUTH_DASHBOARD_URL || 'http://localhost:4000',
  googleCredentials: {
    clientId: process.env.GOOGLE_DASHBOARD_CLIENT_ID || process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_DASHBOARD_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET!,
  },
  cookiePrefix: 'dashboard-auth',
  pages: {
    signIn: '/login',
    error: '/unauthorized', // Redirect auth errors to unauthorized page
  },
  redirectHandler: (url: string, baseUrl: string) => {
    console.log('🔄 Dashboard redirect callback:', { url, baseUrl });
    
    // Get the dashboard URL from environment
    const dashboardUrl = process.env.NEXTAUTH_DASHBOARD_URL || 'http://localhost:4000';
    
    // For dashboard, redirect to a concrete landing page after sign-in
    if (url.startsWith(baseUrl)) {
      if (url.includes('/auth/signin') || url.includes('/login')) {
        console.log('🔄 Dashboard: Redirecting to /dashboard after sign-in');
        return new URL('/dashboard', dashboardUrl).toString();
      }
      return url;
    }
    return new URL('/dashboard', dashboardUrl).toString();
  }
};

const baseAuthOptions = createAuthOptions(authConfig);

// Dashboard-specific auth configuration
export const dashboardAuthOptions: NextAuthOptions = {
  ...baseAuthOptions,
}; 