import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { randomBytes, createHash } from 'crypto';
import { interfaceAuthOptions } from '@interface/lib/auth-config';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DISCORD_AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_OAUTH_SCOPES = ['identify', 'guilds.join'];
const STATE_COOKIE = 'discord_oauth_state';
const POPUP_COOKIE = 'discord_oauth_popup';
const STATE_TTL_SECONDS = 600;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function resolveRedirectUri(req: NextRequest): string {
  const fromEnv = process.env.DISCORD_OAUTH_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${resolveAppOrigin(req)}/api/discord/callback`;
}

function resolveAppOrigin(req: NextRequest): string {
  const fromEnv = (
    process.env.NEXT_PUBLIC_INTERFACE_URL ||
    process.env.NEXTAUTH_INTERFACE_URL ||
    process.env.NEXTAUTH_URL ||
    ''
  ).trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      // Fall through to request-derived origin.
    }
  }
  const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) {
    return `${forwardedProto || req.nextUrl.protocol.replace(':', '')}://${forwardedHost}`;
  }
  return req.nextUrl.origin;
}

function resolveReturnTo(req: NextRequest, appOrigin: string): string {
  const requested = req.nextUrl.searchParams.get('returnTo') || req.headers.get('referer') || '/';
  try {
    const target = new URL(requested, appOrigin);
    if (target.origin !== appOrigin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function feedbackRedirect(req: NextRequest, status: 'success' | 'error', detail?: string) {
  const referer = req.headers.get('referer');
  const appOrigin = resolveAppOrigin(req);
  let target: URL;
  try {
    target = referer ? new URL(referer, appOrigin) : new URL('/', appOrigin);
    if (target.origin !== appOrigin) {
      target = new URL('/', appOrigin);
    }
  } catch {
    target = new URL('/', appOrigin);
  }
  target.searchParams.set('discord_connect', status);
  if (detail) target.searchParams.set('discord_detail', detail);
  return NextResponse.redirect(target);
}

export async function GET(req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    return feedbackRedirect(req, 'error', 'oauth_not_configured');
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    const loginUrl = new URL('/login', resolveAppOrigin(req));
    loginUrl.searchParams.set('callbackUrl', '/api/discord/auth');
    return NextResponse.redirect(loginUrl);
  }

  const appOrigin = resolveAppOrigin(req);
  const redirectUri = resolveRedirectUri(req);
  const returnTo = resolveReturnTo(req, appOrigin);
  // When opened from a popup window (e.g. the Pearl Village connect screen), the
  // callback returns a self-closing page that messages the opener instead of
  // navigating the whole tab — so the user stays inside Pearl.
  const isPopup = req.nextUrl.searchParams.get('popup') === '1';

  const stateRaw = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

  const stateValue = JSON.stringify({
    s: stateRaw,
    v: codeVerifier,
    u: session.user.id,
    t: Date.now(),
    r: returnTo,
    p: isPopup ? 1 : 0,
  });

  const authorizeUrl = new URL(DISCORD_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', DISCORD_OAUTH_SCOPES.join(' '));
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', stateRaw);
  authorizeUrl.searchParams.set('prompt', 'consent');
  authorizeUrl.searchParams.set('code_challenge', codeChallenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');

  console.info('[discord/auth] redirecting to Discord OAuth', {
    clientId,
    redirectUri,
    scope: DISCORD_OAUTH_SCOPES.join(' '),
  });

  const secureCookie =
    process.env.NODE_ENV === 'production' ||
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https';

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE, stateValue, {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/api/discord',
    maxAge: STATE_TTL_SECONDS,
  });
  // Mirror the popup flag in a cookie so the callback can pick the right
  // response mode even for errors that occur before the signed state is parsed.
  res.cookies.set(POPUP_COOKIE, isPopup ? '1' : '0', {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'lax',
    path: '/api/discord',
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
