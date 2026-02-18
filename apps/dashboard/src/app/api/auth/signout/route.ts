import { getSessionSafely } from '@nia/prism/core/auth';
import { NextRequest, NextResponse } from 'next/server';
import { dashboardAuthOptions } from '../../../../lib/auth-config';

export async function POST(request: NextRequest) {
  try {
    const session = await getSessionSafely(request, dashboardAuthOptions);

    if (session?.user) {
      console.log(`[SIGNOUT] User signed out: userId=${session.user.id}, is_anonymous=${session.user.is_anonymous}`);
    }

    // Create response that redirects to login page
    // const response = NextResponse.redirect(new URL('/login', request.url));    
    // Create response that clears the session
    const response = NextResponse.json({ success: true, redirect: '/login' });


    // Clear all NextAuth cookies comprehensively
    const cookiesToDelete = [
      'dashboard-auth.session-token',
      '__Secure-dashboard-auth.session-token',
      'dashboard-auth.csrf-token',
      '__Secure-dashboard-auth.csrf-token',
      'dashboard-auth.callback-url',
      '__Secure-dashboard-auth.callback-url',
      'dashboard-auth.pkce.code_verifier',
      '__Secure-dashboard-auth.pkce.code_verifier',
      'dashboard-auth.state',
      '__Secure-dashboard-auth.state',
      'dashboard-auth.nonce',
      '__Secure-dashboard-auth.nonce',
    ];

    cookiesToDelete.forEach(cookieName => {
      response.cookies.delete(cookieName);
    });

    return response;
  } catch (error) {
    console.error('[SIGNOUT] Error during sign-out:', error);
    const response = NextResponse.json({ success: true, redirect: '/login' });
    return response;
  }
}

export async function GET(request: NextRequest) {
  // Handle GET requests by redirecting to POST
  return POST(request);
} 