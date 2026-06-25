import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

export const GOOGLE_CHAT_OAUTH_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/chat.spaces.create',
] as const;

export const STATE_COOKIE = 'google_chat_oauth_state';
export const STATE_TTL_SECONDS = 600;

export type GoogleChatOAuthState = {
  s: string;
  v: string;
  n: string;
  u: string;
  t: number;
  r?: string;
  p?: number;
};

export function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

export function resolveAppOrigin(req: NextRequest): string {
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

export function resolveRedirectUri(req: NextRequest): string {
  return process.env.GOOGLE_CHAT_OAUTH_REDIRECT_URI?.trim() || `${resolveAppOrigin(req)}/api/google-chat/oauth/callback`;
}

export function resolveClientId(): string {
  return (
    process.env.GOOGLE_CHAT_OAUTH_CLIENT_ID ||
    process.env.GOOGLE_INTERFACE_CLIENT_ID ||
    process.env.GOOGLE_CLIENT_ID ||
    ''
  ).trim();
}

export function resolveClientSecret(): string {
  return (
    process.env.GOOGLE_CHAT_OAUTH_CLIENT_SECRET ||
    process.env.GOOGLE_INTERFACE_CLIENT_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    ''
  ).trim();
}

export function resolveReturnTo(req: NextRequest, appOrigin: string): string {
  const requested = req.nextUrl.searchParams.get('returnTo') || req.headers.get('referer') || '/';
  try {
    const target = new URL(requested, appOrigin);
    if (target.origin !== appOrigin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

export function compareStateConstantTime(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function popupResultResponse(
  req: NextRequest,
  status: 'success' | 'error',
  detail?: string,
  payload?: Record<string, unknown>,
) {
  const origin = resolveAppOrigin(req);
  const message = status === 'success'
    ? { type: 'google-chat.oauth-success', detail, ...payload }
    : { type: 'google-chat.oauth-error', error: detail || 'unknown', ...payload };
  const heading = status === 'success' ? 'Google Chat connected' : 'Google Chat connection failed';
  const sub = status === 'success'
    ? 'You can close this window and head back to Pearl.'
    : 'Something went wrong. You can close this window and try again from Pearl.';
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${heading}</title>
<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#f8fafc;text-align:center;padding:24px}h1{font-size:18px;margin:0}p{font-size:14px;opacity:.75;margin:0}</style></head>
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

export function settingsRedirect(req: NextRequest, status: 'success' | 'error', detail?: string, returnTo?: unknown) {
  const appOrigin = resolveAppOrigin(req);
  let path = '/';
  if (typeof returnTo === 'string' && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
    path = returnTo;
  }
  const url = new URL(path, appOrigin);
  url.searchParams.set('google_chat_connect', status);
  if (detail) url.searchParams.set('google_chat_detail', detail);
  return NextResponse.redirect(url);
}

export function finalizeOAuthResponse(
  req: NextRequest,
  isPopup: boolean,
  status: 'success' | 'error',
  detail?: string,
  returnTo?: unknown,
  payload?: Record<string, unknown>,
) {
  const res = isPopup
    ? popupResultResponse(req, status, detail, payload)
    : settingsRedirect(req, status, detail, returnTo);
  res.cookies.delete(STATE_COOKIE);
  return res;
}
