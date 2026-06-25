import { readFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';

const CHAT_BOT_SCOPE = 'https://www.googleapis.com/auth/chat.bot';
const GOOGLE_OAUTH_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CHAT_API = 'https://chat.googleapis.com/v1';

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function serviceAccountFromEnv(): ServiceAccount | null {
  const inline = cleanString(process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON);
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch {
      return null;
    }
  }

  const path = cleanString(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
  } catch {
    return null;
  }
}

export function googleChatOutboundConfigured(): boolean {
  const account = serviceAccountFromEnv();
  return Boolean(account?.client_email && account?.private_key);
}

async function getAppAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 60 > now) {
    return cachedToken.accessToken;
  }

  const account = serviceAccountFromEnv();
  const clientEmail = cleanString(account?.client_email);
  const privateKey = cleanString(account?.private_key);
  if (!clientEmail || !privateKey) {
    throw new Error('google_chat_service_account_not_configured');
  }

  const key = await importPKCS8(privateKey, 'RS256');
  const assertion = await new SignJWT({
    scope: CHAT_BOT_SCOPE,
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience(GOOGLE_OAUTH_ENDPOINT)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const tokenRes = await fetch(GOOGLE_OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!tokenRes.ok) {
    throw new Error(`google_chat_token_exchange_failed:${tokenRes.status}`);
  }
  const tokenData = await tokenRes.json() as { access_token?: string; expires_in?: number };
  const accessToken = cleanString(tokenData.access_token);
  if (!accessToken) throw new Error('google_chat_token_missing');
  cachedToken = {
    accessToken,
    expiresAt: now + Number(tokenData.expires_in || 3600),
  };
  return accessToken;
}

export function normalizeGoogleChatSpaceUri(value: unknown): string {
  const text = cleanString(value);
  if (!text) return '';
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === 'chat.google.com' ? url.toString() : '';
  } catch {
    return '';
  }
}

export async function setupGoogleChatDirectMessage(accessToken: string, requestId: string): Promise<{
  name: string;
  spaceUri: string;
}> {
  const res = await fetch(`${CHAT_API}/spaces:setup`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      space: {
        spaceType: 'DIRECT_MESSAGE',
        singleUserBotDm: true,
      },
      requestId,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`google_chat_setup_failed:${res.status}:${text.slice(0, 240)}`);
  }
  const data = await res.json() as { name?: string; spaceUri?: string };
  const name = cleanString(data.name);
  if (!/^spaces\/[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('google_chat_setup_missing_space');
  }
  return {
    name,
    spaceUri: normalizeGoogleChatSpaceUri(data.spaceUri),
  };
}

export async function sendGoogleChatMessage(input: {
  spaceName: string;
  text: string;
  privateMessageViewer?: string | null;
  threadName?: string | null;
}): Promise<{ ok: true; name?: string } | { ok: false; error: string }> {
  const spaceName = cleanString(input.spaceName);
  const text = cleanString(input.text);
  if (!/^spaces\/[A-Za-z0-9._-]+$/.test(spaceName)) return { ok: false, error: 'invalid_space_name' };
  if (!text) return { ok: false, error: 'empty_message' };

  try {
    const token = await getAppAccessToken();
    const message: Record<string, unknown> = { text };
    const viewer = cleanString(input.privateMessageViewer);
    if (/^users\/[A-Za-z0-9._-]+$/.test(viewer)) {
      message.privateMessageViewer = { name: viewer };
    }
    const threadName = cleanString(input.threadName);
    if (/^spaces\/[A-Za-z0-9._-]+\/threads\/[A-Za-z0-9._-]+$/.test(threadName)) {
      message.thread = { name: threadName };
    }
    const res = await fetch(`${CHAT_API}/${spaceName}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `google_chat_send_failed:${res.status}:${body.slice(0, 160)}` };
    }
    const data = await res.json().catch(() => null) as { name?: string } | null;
    return { ok: true, name: cleanString(data?.name) || undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
