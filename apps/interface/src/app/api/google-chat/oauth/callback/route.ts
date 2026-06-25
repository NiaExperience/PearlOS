import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';

import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { linkGoogleChatOauthDm, requireGoogleChatPearlOsIdentity } from '../../_lib/google-chat-link';
import {
  sendGoogleChatMessage,
  setupGoogleChatDirectMessage,
} from '../../_lib/google-chat-client';
import {
  GOOGLE_CHAT_OAUTH_SCOPES,
  STATE_COOKIE,
  compareStateConstantTime,
  finalizeOAuthResponse,
  resolveClientId,
  resolveClientSecret,
  resolveRedirectUri,
  type GoogleChatOAuthState,
} from '../_lib';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GOOGLE_OIDC_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

type GoogleIdTokenPayload = {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  nonce?: string;
  hd?: string;
};

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(value: unknown): string {
  const text = cleanString(value).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? text : '';
}

function scopeIncludes(scopeText: string, scope: string): boolean {
  return scopeText.split(/\s+/).includes(scope);
}

function parseStateCookie(value: string | undefined): GoogleChatOAuthState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GoogleChatOAuthState>;
    if (parsed.s && parsed.v && parsed.n && parsed.u && parsed.t) {
      return parsed as GoogleChatOAuthState;
    }
  } catch {
    return null;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const cookieState = parseStateCookie(req.cookies.get(STATE_COOKIE)?.value);
  const isPopup = cookieState?.p === 1;
  const clientId = resolveClientId();
  const clientSecret = resolveClientSecret();

  if (!clientId || !clientSecret) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'oauth_not_configured', cookieState?.r);
  }

  const oauthError = req.nextUrl.searchParams.get('error');
  if (oauthError) {
    return finalizeOAuthResponse(req, isPopup, 'error', `google_${oauthError}`, cookieState?.r);
  }

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  if (!code || !stateParam) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'missing_code_or_state', cookieState?.r);
  }
  if (!cookieState) {
    return finalizeOAuthResponse(req, false, 'error', 'missing_state_cookie');
  }
  if (!compareStateConstantTime(cookieState.s, stateParam)) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'state_mismatch', cookieState.r);
  }
  if (Date.now() - cookieState.t > 600_000) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'state_expired', cookieState.r);
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'not_signed_in', cookieState.r);
  }
  if (session.user.id !== cookieState.u) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'session_user_mismatch', cookieState.r);
  }

  let identity;
  try {
    identity = await requireGoogleChatPearlOsIdentity(session.user.id);
  } catch (error) {
    return finalizeOAuthResponse(req, isPopup, 'error', error instanceof Error ? error.message : 'google_account_required', cookieState.r);
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      code_verifier: cookieState.v,
      grant_type: 'authorization_code',
      redirect_uri: resolveRedirectUri(req),
    }).toString(),
  });
  if (!tokenRes.ok) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'token_exchange_failed', cookieState.r);
  }
  const tokenData = await tokenRes.json() as {
    access_token?: string;
    id_token?: string;
    scope?: string;
  };
  const accessToken = cleanString(tokenData.access_token);
  const idToken = cleanString(tokenData.id_token);
  const grantedScope = cleanString(tokenData.scope);
  if (!accessToken || !idToken) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'token_missing', cookieState.r);
  }
  if (
    !scopeIncludes(grantedScope, 'https://www.googleapis.com/auth/chat.spaces.create') &&
    !scopeIncludes(grantedScope, 'https://www.googleapis.com/auth/chat.spaces')
  ) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'chat_scope_not_granted', cookieState.r, {
      grantedScopes: grantedScope,
    });
  }

  let payload: GoogleIdTokenPayload;
  try {
    const verified = await jwtVerify(idToken, GOOGLE_OIDC_JWKS, {
      audience: clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    payload = verified.payload as GoogleIdTokenPayload;
  } catch {
    return finalizeOAuthResponse(req, isPopup, 'error', 'id_token_invalid', cookieState.r);
  }

  const googleSub = cleanString(payload.sub);
  const googleEmail = normalizeEmail(payload.email);
  if (
    !googleSub ||
    !googleEmail ||
    payload.email_verified !== true ||
    cleanString(payload.nonce) !== cookieState.n ||
    googleEmail !== identity.email ||
    googleSub !== identity.googleProviderAccountId
  ) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'google_account_mismatch', cookieState.r);
  }
  const allowedHd = cleanString(process.env.GOOGLE_CHAT_ALLOWED_HD).toLowerCase();
  if (allowedHd && cleanString(payload.hd).toLowerCase() !== allowedHd) {
    return finalizeOAuthResponse(req, isPopup, 'error', 'google_domain_not_allowed', cookieState.r);
  }

  let space;
  try {
    space = await setupGoogleChatDirectMessage(accessToken, randomUUID());
  } catch (error) {
    console.error('[google-chat/oauth] spaces.setup failed', error);
    return finalizeOAuthResponse(req, isPopup, 'error', 'google_chat_setup_failed', cookieState.r);
  }

  try {
    const linked = await linkGoogleChatOauthDm({
      userId: session.user.id,
      googleSub,
      googleEmail,
      googleChatDisplayName: cleanString(payload.name) || identity.userName,
      googleChatSpaceName: space.name,
      googleChatSpaceUri: space.spaceUri,
    });

    try {
      await sendGoogleChatMessage({
        spaceName: space.name,
        text: 'Pearl is connected to this Google Chat DM. You can talk to Public Pearl here now.',
      });
    } catch (sendError) {
      console.warn('[google-chat/oauth] linked DM but confirmation send failed', sendError);
    }

    return finalizeOAuthResponse(req, isPopup, 'success', 'connected', cookieState.r, {
      googleChatUserName: linked.googleChatUserName,
      googleChatDisplayName: linked.googleChatDisplayName,
      googleChatSpaceUri: linked.googleChatSpaceUri,
      grantedScopes: GOOGLE_CHAT_OAUTH_SCOPES,
    });
  } catch (error) {
    console.error('[google-chat/oauth] link persistence failed', error);
    return finalizeOAuthResponse(req, isPopup, 'error', error instanceof Error ? error.message : 'persist_failed', cookieState.r);
  }
}
