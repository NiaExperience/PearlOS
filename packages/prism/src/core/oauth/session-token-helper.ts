/**
 * Helper functions for handling OAuth tokens in session
 */

import { Session } from 'next-auth';
import { getServerSession, NextAuthOptions } from 'next-auth';
import { cookies } from 'next/headers';
import { encode, decode } from 'next-auth/jwt';
import { getLogger } from '../logger';

const log = getLogger('prism:oauth:session-token');

/**
 * Update the session with a new access token
 */
export async function updateSessionWithAccessToken(
  session: Session,
  authOptions: NextAuthOptions,
  accessToken: string,
  expiresAt?: number
): Promise<boolean> {
  try {
    if (!session?.user?.id) {
      log.error('Cannot update session: Invalid session or missing user ID');
      return false;
    }

    // Get the session token from cookies
    const sessionCookie = (await cookies()).get(authOptions.cookies?.sessionToken?.name || 'next-auth.session-token');
    if (!sessionCookie?.value) {
      log.error('Cannot update session: No session cookie found', { userId: session.user.id });
      return false;
    }

    // Get the session token secret
    const secret = authOptions.secret || process.env.NEXTAUTH_SECRET;
    if (!secret) {
      log.error('Cannot update session: No session secret found', { userId: session.user.id });
      return false;
    }

    try {
      // Decode the current session token
      const token = await decode({ token: sessionCookie.value, secret });
      if (!token) {
        log.error('Cannot update session: Failed to decode session token', { userId: session.user.id });
        return false;
      }

      // Update the token with the new access token
      const updatedToken = {
        ...token,
        google_access_token: accessToken,
      };
      if (expiresAt) {
        log.info('Google access token expiry set', { userId: session.user.id, expiresAt });
      }

      // Encode the updated token
      const encodedToken = await encode({
        token: updatedToken,
        secret,
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      // Set the updated session cookie
      (await cookies()).set({
        name: authOptions.cookies?.sessionToken?.name || 'next-auth.session-token',
        value: encodedToken,
        path: '/',
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });

      log.info('Session cookie updated with new access token', { userId: session.user.id });
      return true;
    } catch (error) {
      log.error('Error updating session token', { userId: session.user.id, error });
      return false;
    }
  } catch (error) {
    log.error('Error in updateSessionWithAccessToken', { error });
    return false;
  }
}
