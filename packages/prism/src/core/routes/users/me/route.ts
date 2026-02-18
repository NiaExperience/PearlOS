import { NextRequest, NextResponse } from 'next/server';
import { getSessionSafely } from '@nia/prism/core/auth';
import { UserActions } from '@nia/prism/core/actions';
import { NextAuthOptions } from 'next-auth';
import { getLogger } from '../../../logger';

const log = getLogger('prism:routes:users');

/**
 * API route to get the current user profile
 * GET /api/users/me
 *
 * @param req - The Next.js request object
 * @param authOptions - The app-specific NextAuth options
 * @returns A Next.js response with the user information
 */
export async function GET_impl(req: NextRequest, authOptions: NextAuthOptions): Promise<Response> {
  try {
    log.info('Users/me GET');
    
    const session = await getSessionSafely(req, authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ user: null, error: 'Not authenticated' }, { status: 401 });
    }
    
    log.info('Users/me authenticated', { userId: session.user.id });
    
    const user = await UserActions.getCurrentUser(authOptions);
    if (user && user.success) {
      return NextResponse.json({ user: user.data });
    } else {
      return NextResponse.json({ user: null, error: user?.error || 'User not found' }, { status: 404 });
    }
  } catch (error: any) {
    log.error('Error in users/me API', { error });
    return NextResponse.json(
      { user: null, error: error.message || 'Failed to fetch user' },
      { status: 500 }
    );
  }
}
