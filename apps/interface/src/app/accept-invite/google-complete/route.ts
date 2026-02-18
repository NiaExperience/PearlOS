/* eslint-disable @typescript-eslint/no-explicit-any */
import { TenantActions, UserActions } from '@nia/prism/core/actions';
import { IUser } from '@nia/prism/core/blocks/user.block';
import { consumeResetToken, verifyResetToken } from '@nia/prism/core/email';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';
  const assistant = url.searchParams.get('assistant') || '';
  const origin = process.env.NEXT_PUBLIC_INTERFACE_URL || process.env.NEXTAUTH_INTERFACE_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_API_URL || url.origin;
  const target = assistant ? `${origin}/${assistant}` : `${origin}/`;

  if (!token) {
    const back = new URL('/accept-invite', origin);
    back.searchParams.set('error', 'MissingToken');
    if (assistant) back.searchParams.set('assistant', assistant);
    return NextResponse.redirect(back.toString(), 302);
  }

  // Verify token first so we can drive Google sign-in with login_hint if needed
  const info = await verifyResetToken(token, ['invite_activation']);
  if (!info) {
    const back = new URL('/accept-invite', origin);
    back.searchParams.set('error', 'InvalidOrExpired');
    if (assistant) back.searchParams.set('assistant', assistant);
    return NextResponse.redirect(back.toString(), 302);
  }

  // If no authenticated session yet, send to login with autoGoogle=1 to auto-start Google OAuth
  const session = await getServerSession(interfaceAuthOptions);
  if (!session || !session.user?.email) {
    const callbackBack = new URL(`/accept-invite/google-complete?token=${encodeURIComponent(token)}${assistant ? `&assistant=${encodeURIComponent(assistant)}` : ''}`, origin);
    const login = new URL('/login', origin);
    login.searchParams.set('callbackUrl', callbackBack.toString());
    login.searchParams.set('autoGoogle', '1');
    const invitedEmail = (info.email || '').toLowerCase();
    if (invitedEmail) login.searchParams.set('login_hint', invitedEmail);
    return NextResponse.redirect(login.toString(), 302);
  }

  const invitedEmail = (info.email || '').toLowerCase();
  const authedEmail = String(session.user.email || '').toLowerCase();
  if (!invitedEmail || invitedEmail !== authedEmail) {
    const back = new URL('/accept-invite', origin);
    back.searchParams.set('error', 'EmailMismatch');
    if (assistant) back.searchParams.set('assistant', assistant);
    return NextResponse.redirect(back.toString(), 302);
  }

  // If token already consumed, just proceed
  if (!(info as any).consumed) {
    try {
      await consumeResetToken(token, ['invite_activation']);
    } catch {
      // Ignore errors; proceed
    }
  }

  // Ensure user verified flag is set
  try {
    const user = await UserActions.getUserById(info.userId);
    if (user && !user.emailVerified) {
      await UserActions.updateUser(info.userId, { ...user, emailVerified: new Date() } as IUser);
    }
  } catch {
    // Ignore
  }

  // If the Google-auth session user is a different user record than the invited token's user,
  // replicate any tenant role assignments from the invited user to this authenticated user so access works.
  try {
    const sessionUserId = session.user.id;
    if (sessionUserId && sessionUserId !== info.userId) {
      const roles: any[] = await TenantActions.getUserTenantRoles(info.userId) as any[];
      for (const r of roles || []) {
        if (r?.tenantId && r?.role) {
          try {
            await TenantActions.assignUserToTenant(sessionUserId, r.tenantId, r.role);
          } catch (e) {
            // Best effort; continue
          }
        }
      }
    }
  } catch {
    // Ignore
  }

  // Redirect to assistant or home
  return NextResponse.redirect(target, 302);
}
