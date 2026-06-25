import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { googleChatIsConfigured, requireGoogleChatPearlOsIdentity } from '../../_lib/google-chat-link';
import {
  GOOGLE_CHAT_OAUTH_SCOPES,
  STATE_COOKIE,
  STATE_TTL_SECONDS,
  codeChallenge,
  randomToken,
  resolveAppOrigin,
  resolveClientId,
  resolveClientSecret,
  resolveRedirectUri,
  resolveReturnTo,
  type GoogleChatOAuthState,
} from '../_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!googleChatIsConfigured()) {
    return NextResponse.redirect(new URL('/pearlos/settings?google_chat_connect=error&google_chat_detail=not_configured', resolveAppOrigin(req)));
  }

  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/pearlos/settings?google_chat_connect=error&google_chat_detail=oauth_not_configured', resolveAppOrigin(req)));
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', resolveAppOrigin(req));
    loginUrl.searchParams.set('callbackUrl', '/api/google-chat/oauth/start');
    return NextResponse.redirect(loginUrl);
  }

  let identity;
  try {
    identity = await requireGoogleChatPearlOsIdentity(session.user.id);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'google_account_required';
    return NextResponse.redirect(new URL(`/pearlos/settings?google_chat_connect=error&google_chat_detail=${encodeURIComponent(reason)}`, resolveAppOrigin(req)));
  }

  const appOrigin = resolveAppOrigin(req);
  const redirectUri = resolveRedirectUri(req);
  const returnTo = resolveReturnTo(req, appOrigin);
  const isPopup = req.nextUrl.searchParams.get('popup') === '1';
  const stateRaw = randomToken(32);
  const verifier = randomToken(48);
  const nonce = randomToken(32);
  const stateValue: GoogleChatOAuthState = {
    s: stateRaw,
    v: verifier,
    n: nonce,
    u: session.user.id,
    t: Date.now(),
    r: returnTo,
    p: isPopup ? 1 : 0,
  };

  const authorizeUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', GOOGLE_CHAT_OAUTH_SCOPES.join(' '));
  authorizeUrl.searchParams.set('state', stateRaw);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('include_granted_scopes', 'true');
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('login_hint', identity.email);
  authorizeUrl.searchParams.set('code_challenge', codeChallenge(verifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  const secureCookie =
    process.env.NODE_ENV === 'production' ||
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https';
  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, JSON.stringify(stateValue), {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/api/google-chat/oauth',
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
