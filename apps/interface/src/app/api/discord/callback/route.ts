import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { timingSafeEqual } from 'crypto';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import {
  getUserAccountByProvider,
  createAccount,
  updateAccount,
} from '@nia/prism/core/actions/account-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const STATE_COOKIE = 'discord_oauth_state';
const POPUP_COOKIE = 'discord_oauth_popup';
const OPENCLAW_CONFIG_PATHS = [
  '/home/deploy/.openclaw/relay-openclaw.json',
  '/home/deploy/.openclaw/openclaw.json',
  '/root/.openclaw/openclaw.json',
];

function getBotToken(): string | null {
  if (process.env.DISCORD_BOT_TOKEN) return process.env.DISCORD_BOT_TOKEN;

  const fs = require('fs');
  for (const configPath of OPENCLAW_CONFIG_PATHS) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const token = config?.env?.DISCORD_BOT_TOKEN || config?.channels?.discord?.token;
      if (token) return token;
    } catch {
      // Try the next known runtime config path.
    }
  }
  return null;
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

function sanitizeReturnTo(returnTo: unknown): string {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/')) return '/';
  if (returnTo.startsWith('//')) return '/';
  return returnTo;
}

function settingsRedirect(req: NextRequest, status: 'success' | 'error', detail?: string, returnTo?: unknown) {
  const url = new URL(sanitizeReturnTo(returnTo), resolveAppOrigin(req));
  url.searchParams.set('discord_connect', status);
  if (detail) url.searchParams.set('discord_detail', detail);
  return NextResponse.redirect(url);
}

// Self-closing page used when the OAuth flow was launched from a popup window.
// It hands the result back to the Pearl window that opened it (via postMessage)
// and closes itself, so the user is never navigated away from Pearl.
function popupResultResponse(
  req: NextRequest,
  status: 'success' | 'error',
  detail?: string,
  payload?: { userId?: string; username?: string },
) {
  const origin = resolveAppOrigin(req);
  const message =
    status === 'success'
      ? { type: 'discord.oauth-success', userId: payload?.userId, username: payload?.username, detail }
      : { type: 'discord.oauth-error', error: detail || 'unknown' };
  const heading = status === 'success' ? 'Connected to Pearl Village' : 'Discord connection failed';
  const sub =
    status === 'success'
      ? 'You can close this window and head back to Pearl.'
      : 'Something went wrong. You can close this window and try again from Pearl.';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${heading}</title>
<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f0820;color:#f0ece4;text-align:center;padding:24px}h1{font-size:18px;margin:0}p{font-size:14px;opacity:.7;margin:0}</style></head>
<body>
<h1>${heading}</h1>
<p>${sub}</p>
<script>
(function(){
  var msg = ${JSON.stringify(message)};
  try { if (window.opener && !window.opener.closed) { window.opener.postMessage(msg, ${JSON.stringify(origin)}); } } catch (e) {}
  setTimeout(function(){ try { window.close(); } catch (e) {} }, 150);
})();
</script>
</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Pick the right terminal response (popup self-close vs full-page redirect) and
// always clear the one-shot OAuth cookies.
function finalize(
  req: NextRequest,
  isPopup: boolean,
  status: 'success' | 'error',
  detail?: string,
  returnTo?: unknown,
  payload?: { userId?: string; username?: string },
) {
  const res = isPopup
    ? popupResultResponse(req, status, detail, payload)
    : settingsRedirect(req, status, detail, returnTo);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(POPUP_COOKIE);
  return res;
}

function compareStateConstantTime(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const clientSecret = process.env.DISCORD_CLIENT_SECRET?.trim();
  const cookiePopup = req.cookies.get(POPUP_COOKIE)?.value === '1';

  if (!clientId || !clientSecret) {
    return finalize(req, cookiePopup, 'error', 'oauth_not_configured');
  }

  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return finalize(req, cookiePopup, 'error', 'not_signed_in');
  }

  const code = req.nextUrl.searchParams.get('code');
  const stateParam = req.nextUrl.searchParams.get('state');
  const oauthError = req.nextUrl.searchParams.get('error');

  if (oauthError) {
    console.error('[discord/callback] Discord returned OAuth error', {
      error: oauthError,
      description: req.nextUrl.searchParams.get('error_description'),
    });
    return finalize(req, cookiePopup, 'error', `discord_${oauthError}`);
  }
  if (!code || !stateParam) {
    return finalize(req, cookiePopup, 'error', 'missing_code_or_state');
  }

  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateCookie) {
    return finalize(req, cookiePopup, 'error', 'missing_state_cookie');
  }

  let parsedState: { s: string; v: string; u: string; t: number; r?: string; p?: number };
  try {
    parsedState = JSON.parse(stateCookie);
  } catch {
    return finalize(req, cookiePopup, 'error', 'malformed_state_cookie');
  }
  const isPopup = cookiePopup || parsedState.p === 1;

  if (!compareStateConstantTime(parsedState.s, stateParam)) {
    return finalize(req, isPopup, 'error', 'state_mismatch', parsedState.r);
  }
  if (parsedState.u !== session.user.id) {
    return finalize(req, isPopup, 'error', 'session_user_mismatch', parsedState.r);
  }
  if (Date.now() - parsedState.t > 600_000) {
    return finalize(req, isPopup, 'error', 'state_expired', parsedState.r);
  }

  const redirectUri = resolveRedirectUri(req);

  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: parsedState.v,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error('[discord/callback] token exchange failed', tokenRes.status, text);
    return finalize(req, isPopup, 'error', 'token_exchange_failed', parsedState.r);
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  const meRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `${tokenData.token_type} ${tokenData.access_token}` },
  });

  if (!meRes.ok) {
    const text = await meRes.text();
    console.error('[discord/callback] /users/@me failed', meRes.status, text);
    return finalize(req, isPopup, 'error', 'identity_fetch_failed', parsedState.r);
  }

  const discordUser = (await meRes.json()) as {
    id: string;
    username: string;
    discriminator?: string;
    global_name?: string;
  };

  const botToken = getBotToken();
  let joinStatus: 'joined' | 'already_member' | 'pending_screening' | 'join_skipped' | 'join_failed' = 'join_skipped';
  if (botToken) {
    const joinRes = await fetch(
      `${DISCORD_API}/guilds/${DISCORD_GUILD_ID}/members/${discordUser.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'DiscordBot (PearlOS-Interface, 1.0)',
        },
        body: JSON.stringify({ access_token: tokenData.access_token }),
      },
    );

    if (joinRes.status === 201) {
      const joined = await joinRes.json().catch(() => ({}));
      joinStatus = joined?.pending ? 'pending_screening' : 'joined';
    } else if (joinRes.status === 204) {
      joinStatus = 'already_member';
    } else {
      const text = await joinRes.text();
      console.error('[discord/callback] guild join failed', joinRes.status, text);
      joinStatus = 'join_failed';
    }
  }

  const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 0);

  try {
    const existing = (await getUserAccountByProvider(session.user.id, 'discord')) as IAccount | null;
    const payload: Partial<IAccount> = {
      userId: session.user.id,
      provider: 'discord',
      providerAccountId: discordUser.id,
      type: 'oauth',
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: tokenData.scope,
    };
    if (existing && existing._id) {
      await updateAccount(existing._id, payload);
    } else {
      await createAccount(payload as IAccount);
    }
  } catch (err) {
    console.error('[discord/callback] account persistence failed', err);
    return finalize(req, isPopup, 'error', 'persist_failed', parsedState.r);
  }

  return finalize(req, isPopup, 'success', joinStatus, parsedState.r, {
    userId: discordUser.id,
    username: discordUser.global_name || discordUser.username,
  });
}
