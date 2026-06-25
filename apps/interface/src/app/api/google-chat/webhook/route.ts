import { NextRequest, NextResponse } from 'next/server';
import {
  createRemoteJWKSet,
  importX509,
  jwtVerify,
  type JWTHeaderParameters,
  type KeyLike,
} from 'jose';

import { sanitizeDiscordContent } from '../../discord/_lib/sanitize-discord-content';
import {
  consumeGoogleChatLinkCode,
  extractGoogleChatLinkCode,
  getGoogleChatLinkedAccountScope,
  googleChatIsConfigured,
  normalizeGoogleChatUserName,
  type GoogleChatLinkedAccountScope,
} from '../_lib/google-chat-link';
import { sendGoogleChatMessage } from '../_lib/google-chat-client';
import { UserProfileActions } from '@nia/prism/core/actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const CHAT_ISSUER = 'chat@system.gserviceaccount.com';
const GOOGLE_OIDC_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const CHAT_SERVICE_ACCOUNT_CERTS_URL = `https://www.googleapis.com/service_accounts/v1/metadata/x509/${encodeURIComponent(CHAT_ISSUER)}`;
const BOT_GATEWAY_URL = process.env.BOT_GATEWAY_URL || process.env.NEXT_PUBLIC_BOT_CONTROL_BASE_URL || 'http://localhost:4444';
const SHARED_SECRET = process.env.BOT_CONTROL_SHARED_SECRET || '';
const FALLBACK_REPLY = "I got your message, but Pearl's Google Chat bridge hit a backend timeout. Try me again in a moment.";
const DEFAULT_TIMEOUT_MS = 24_000;
const MAX_REPLY_CHARS = 3500;
const LINK_PROMPT = 'Connect Google Chat from PearlOS Settings > Connections first. Use the same Google account you use for PearlOS.';
const GROUP_LINK_PROMPT = 'Open PearlOS Settings > Connections and connect Google Chat first. In group spaces Pearl only uses public profile information. Private questions and task results stay in your 1:1 chat with Pearl.';

type GoogleChatEvent = {
  type?: string;
  eventType?: string;
  user?: {
    name?: string;
    displayName?: string;
    email?: string;
    type?: string;
  };
  space?: {
    name?: string;
    displayName?: string;
    type?: string;
    spaceUri?: string;
  };
  message?: {
    name?: string;
    text?: string;
    argumentText?: string;
    thread?: {
      name?: string;
    };
  };
};

type ChatCertCache = {
  expiresAt: number;
  keys: Map<string, KeyLike>;
};

let chatCertCache: ChatCertCache | null = null;

function envList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function eventType(event: GoogleChatEvent): string {
  return String(event.type || event.eventType || '').trim().toUpperCase();
}

function bearerToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function isUnverifiedLocalMode(): boolean {
  return process.env.GOOGLE_CHAT_ALLOW_UNVERIFIED === '1' && process.env.NODE_ENV !== 'production';
}

function isGoogleChatEnabled(): boolean {
  return googleChatIsConfigured();
}

function authAudiences(req: NextRequest): string[] {
  const explicit = envList('GOOGLE_CHAT_AUTH_AUDIENCE');
  if (explicit.length) return explicit;

  const projectNumber = process.env.GOOGLE_CHAT_PROJECT_NUMBER?.trim();
  if (projectNumber) return [projectNumber];

  if (process.env.NODE_ENV !== 'production') {
    return [req.url];
  }
  return [];
}

async function getChatServiceAccountKey(header: JWTHeaderParameters): Promise<KeyLike> {
  const kid = typeof header.kid === 'string' ? header.kid : '';
  if (!kid) throw new Error('Google Chat JWT missing key id');

  const now = Date.now();
  if (!chatCertCache || chatCertCache.expiresAt <= now || !chatCertCache.keys.has(kid)) {
    const res = await fetch(CHAT_SERVICE_ACCOUNT_CERTS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Google Chat cert fetch failed: ${res.status}`);
    const cacheControl = res.headers.get('cache-control') || '';
    const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
    const certs = (await res.json()) as Record<string, string>;
    const keys = new Map<string, KeyLike>();

    for (const [certKid, cert] of Object.entries(certs || {})) {
      if (typeof cert === 'string' && cert.includes('BEGIN CERTIFICATE')) {
        keys.set(certKid, await importX509(cert, typeof header.alg === 'string' ? header.alg : 'RS256'));
      }
    }
    chatCertCache = {
      expiresAt: now + Math.max(60, maxAge - 30) * 1000,
      keys,
    };
  }

  const key = chatCertCache.keys.get(kid);
  if (!key) throw new Error('Google Chat JWT key id not found');
  return key;
}

async function verifyGoogleChatRequest(req: NextRequest): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (isUnverifiedLocalMode()) return { ok: true };

  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'missing_google_chat_bearer_token' };

  const audience = authAudiences(req);
  if (!audience.length) return { ok: false, status: 500, error: 'google_chat_auth_audience_not_configured' };

  try {
    if (process.env.GOOGLE_CHAT_PROJECT_NUMBER || process.env.GOOGLE_CHAT_AUTH_MODE === 'project-number') {
      await jwtVerify(token, getChatServiceAccountKey, {
        audience,
        issuer: CHAT_ISSUER,
      });
      return { ok: true };
    }

    const { payload } = await jwtVerify(token, GOOGLE_OIDC_JWKS, {
      audience,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
    if (payload.email !== CHAT_ISSUER || payload.email_verified !== true) {
      return { ok: false, status: 401, error: 'invalid_google_chat_issuer' };
    }
    return { ok: true };
  } catch (error) {
    console.warn('[google-chat/webhook] request token verification failed', error instanceof Error ? error.message : String(error));
    return { ok: false, status: 401, error: 'invalid_google_chat_bearer_token' };
  }
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function stripChatMention(text: string): string {
  return text
    .replace(/<users\/[^>]+>/g, '')
    .replace(/@\S+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function messageText(event: GoogleChatEvent): string {
  return stripChatMention(cleanText(event.message?.argumentText) || stripChatMention(cleanText(event.message?.text)));
}

function spaceLabel(event: GoogleChatEvent): string {
  return cleanText(event.space?.displayName) || cleanText(event.space?.name) || 'a Google Chat space';
}

function welcomeMessage(event: GoogleChatEvent): string {
  const where = spaceLabel(event);
  if (isDirectMessageEvent(event)) {
    return `Pearl is connected to this DM. Connect Google Chat in PearlOS Settings > Connections to start talking with Public Pearl here.`;
  }
  return `Pearl is connected to ${where}. In this space I only use public profile information. DM Public Pearl for private questions and task results.`;
}

function fallbackMessage(error?: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || '');
  if (detail) console.warn('[google-chat/webhook] Pearl response fallback', detail);
  return FALLBACK_REPLY;
}

function gatewayHeaders(event: GoogleChatEvent, scope: GoogleChatLinkedAccountScope): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-email': scope.email,
    'x-user-id': scope.userId,
    'x-user-name': scope.userName,
    'x-tenant-id': scope.tenantId,
    'x-pearl-tenant-id': scope.tenantId,
    'x-pearl-surface': 'google-chat-dm',
  };

  const spaceName = cleanText(event.space?.name);
  const messageName = cleanText(event.message?.name);
  if (spaceName) headers['x-google-chat-space'] = spaceName;
  if (messageName) headers['x-google-chat-message'] = messageName;
  if (scope.googleChatUserName) headers['x-google-chat-user'] = scope.googleChatUserName;
  if (scope.googleChatUserEmail) headers['x-google-chat-email'] = scope.googleChatUserEmail;
  if (SHARED_SECRET) {
    headers['X-Bot-Secret'] = SHARED_SECRET;
    headers.Authorization = `Bearer ${SHARED_SECRET}`;
  }
  return headers;
}

function gatewayBody(event: GoogleChatEvent, scope: GoogleChatLinkedAccountScope, text: string): Record<string, unknown> {
  const spaceName = cleanText(event.space?.name);
  const threadName = cleanText(event.message?.thread?.name);
  const context = [
    'Google Chat public Pearl message.',
    'This is a direct message with the linked PearlOS user. Private task requests are allowed in this DM.',
    `User: ${scope.userName}`,
    `PearlOS user email: ${scope.email}`,
    spaceName ? `Space: ${spaceName}` : '',
    threadName ? `Thread: ${threadName}` : '',
    'Keep the answer concise and useful for Google Chat.',
  ].filter(Boolean).join('\n');

  return {
    messages: [
      { role: 'system', content: context },
      { role: 'user', content: text },
    ],
  };
}

function spaceType(event: GoogleChatEvent): string {
  return cleanText(event.space?.type).toUpperCase();
}

function isDirectMessageEvent(event: GoogleChatEvent): boolean {
  const type = spaceType(event);
  return type === 'DM' || type === 'DIRECT_MESSAGE';
}

function isBotUser(event: GoogleChatEvent): boolean {
  return cleanText(event.user?.type).toUpperCase() === 'BOT';
}

function googleChatUserEmail(event: GoogleChatEvent): string {
  return cleanText(event.user?.email).toLowerCase();
}

function googleChatSpaceName(event: GoogleChatEvent): string {
  return cleanText(event.space?.name);
}

function googleChatSpaceUri(event: GoogleChatEvent): string {
  return cleanText(event.space?.spaceUri);
}

function extractGroupTaskRequest(text: string): string {
  const clean = text.trim();
  const match = clean.match(/^(?:pearl\s+)?(?:task|start task|run task|queue task)\s*[:\-]?\s+([\s\S]{8,})$/i);
  return match?.[1]?.trim() || '';
}

function taskTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 120 ? `${normalized.slice(0, 117).trim()}...` : normalized;
}

async function createGoogleChatDmTask(scope: GoogleChatLinkedAccountScope, event: GoogleChatEvent, task: string): Promise<boolean> {
  if (!SHARED_SECRET) return false;
  const res = await fetch(`${BOT_GATEWAY_URL}/api/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SHARED_SECRET}`,
      'X-Bot-Secret': SHARED_SECRET,
      'x-user-email': scope.email,
      'x-user-id': scope.userId,
      'x-user-name': scope.userName,
      'x-tenant-id': scope.tenantId,
      'x-pearl-tenant-id': scope.tenantId,
      'x-pearl-surface': 'google-chat-dm',
      'x-google-chat-space': googleChatSpaceName(event),
      'x-google-chat-user': scope.googleChatUserName,
    },
    body: JSON.stringify({
      task: [
        'Google Chat task request from linked Public Pearl user.',
        `Visible source space: ${spaceLabel(event)}`,
        'Keep task result delivery private to the user DM. Do not post private details in the originating group.',
        '',
        task,
      ].join('\n'),
      title: taskTitle(task),
      source: 'google_chat_dm',
      created_by: 'pearl',
      assignee: 'claude_cli',
      urgency: 'normal',
      requester_email: scope.email,
      requester_user_id: scope.userId,
      requester_tenant_id: scope.tenantId,
    }),
  });
  return res.ok;
}

function publicProfileSummary(profile: Record<string, unknown> | null): string {
  const publicPersona = (profile?.publicPersona && typeof profile.publicPersona === 'object')
    ? profile.publicPersona as Record<string, unknown>
    : {};
  if (publicPersona.isPublic !== true) {
    return 'This PearlOS public profile is not available in group spaces.';
  }
  const lines: string[] = [];
  const displayName = cleanText(publicPersona.displayName) || 'this user';
  const bio = cleanText(publicPersona.bio);
  const profession = cleanText(publicPersona.profession);
  const location = cleanText(publicPersona.location);
  const interests = Array.isArray(publicPersona.interests)
    ? publicPersona.interests.map((item) => cleanText(item)).filter(Boolean).slice(0, 8)
    : [];
  lines.push(`Public profile for ${displayName}:`);
  if (profession) lines.push(`Profession: ${profession}`);
  if (bio) lines.push(`Bio: ${bio}`);
  if (location) lines.push(`Location: ${location}`);
  if (interests.length) lines.push(`Interests: ${interests.join(', ')}`);
  return lines.length > 1
    ? lines.join('\n')
    : `I do not have public profile details filled in for ${displayName} yet.`;
}

async function groupPublicReply(event: GoogleChatEvent, scope: GoogleChatLinkedAccountScope, text: string): Promise<string> {
  const task = extractGroupTaskRequest(text);
  if (task) {
    const queued = await createGoogleChatDmTask(scope, event, task);
    return queued
      ? "Queued for the requesting PearlOS account. I'll send the result in that user's 1:1 chat with Pearl."
      : 'I could not reach the task queue. I am not going to pretend that was dispatched.';
  }

  const found = await UserProfileActions.findByUser(scope.userId, scope.email).catch(() => null);
  return [
    publicProfileSummary((found?.userProfile || null) as Record<string, unknown> | null),
    '',
    'For private memory, account data, files, or task results, use the DM with Pearl.',
  ].join('\n');
}

function extractTextFromPayload(payload: unknown): string {
  if (!isPlainObject(payload)) return '';
  if (payload.type === 'text' && typeof payload.content === 'string') return payload.content;
  if (typeof payload.content === 'string') return payload.content;

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0];
  if (!isPlainObject(first)) return '';
  const delta = isPlainObject(first.delta) ? first.delta : {};
  if (typeof delta.content === 'string') return delta.content;
  const message = isPlainObject(first.message) ? first.message : {};
  return typeof message.content === 'string' ? message.content : '';
}

async function readGatewayReply(upstream: Response): Promise<string> {
  const contentType = upstream.headers.get('content-type') || '';
  if (!upstream.body || !contentType.includes('text/event-stream')) {
    const data = await upstream.json().catch(() => null);
    const text = extractTextFromPayload(data);
    return text || (typeof data?.text === 'string' ? data.text : '');
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let carry = '';
  let reply = '';

  while (true) {
    const { value, done } = await reader.read();
    carry += decoder.decode(value || new Uint8Array(), { stream: !done });

    while (carry.includes('\n\n')) {
      const index = carry.indexOf('\n\n');
      const event = carry.slice(0, index);
      carry = carry.slice(index + 2);
      for (const rawLine of event.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice('data:'.length).trim();
        if (!data || data === '[DONE]') continue;
        try {
          reply += extractTextFromPayload(JSON.parse(data));
        } catch {
          // Ignore malformed stream fragments and keep reading.
        }
      }
    }

    if (done) break;
  }

  return reply;
}

function googleChatMessage(text: string, event?: GoogleChatEvent): Record<string, unknown> {
  const cleaned = sanitizeDiscordContent(text).trim() || FALLBACK_REPLY;
  const message: Record<string, unknown> = {
    text: cleaned.length > MAX_REPLY_CHARS ? `${cleaned.slice(0, MAX_REPLY_CHARS - 3).trim()}...` : cleaned,
  };
  const threadName = cleanText(event?.message?.thread?.name);
  if (threadName) message.thread = { name: threadName };
  return message;
}

async function askPearl(event: GoogleChatEvent, scope: GoogleChatLinkedAccountScope, text: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.GOOGLE_CHAT_REPLY_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

  try {
    const upstream = await fetch(`${BOT_GATEWAY_URL}/api/chat`, {
      method: 'POST',
      headers: gatewayHeaders(event, scope),
      body: JSON.stringify(gatewayBody(event, scope, text)),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      throw new Error(`bot gateway returned ${upstream.status}`);
    }
    const reply = (await readGatewayReply(upstream)).trim();
    return reply || fallbackMessage('empty Pearl reply');
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  if (!isGoogleChatEnabled()) {
    return NextResponse.json({ error: 'google_chat_disabled' }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    service: 'google-chat-webhook',
    auth: isUnverifiedLocalMode() ? 'local-unverified' : 'google-chat-bearer',
  });
}

export async function POST(req: NextRequest) {
  if (!isGoogleChatEnabled()) {
    return NextResponse.json({ error: 'google_chat_disabled' }, { status: 404 });
  }

  const verified = await verifyGoogleChatRequest(req);
  if (verified.ok === false) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!isPlainObject(body)) {
    return NextResponse.json({ error: 'invalid_google_chat_event' }, { status: 400 });
  }

  const event = body as GoogleChatEvent;
  switch (eventType(event)) {
    case 'ADDED_TO_SPACE':
      return NextResponse.json(googleChatMessage(welcomeMessage(event), event));
    case 'REMOVED_FROM_SPACE':
      return new NextResponse(null, { status: 204 });
    case 'MESSAGE': {
      const text = messageText(event);
      if (!text) {
        return NextResponse.json(googleChatMessage(LINK_PROMPT, event));
      }

      const googleChatUserName = normalizeGoogleChatUserName(event.user?.name);
      if (!googleChatUserName) {
        return NextResponse.json(googleChatMessage('Google Chat did not include a valid user identity for this message.', event));
      }
      if (isBotUser(event)) {
        return NextResponse.json({});
      }

      const directMessage = isDirectMessageEvent(event);

      const linkCode = extractGoogleChatLinkCode(text);
      if (linkCode) {
        if (!directMessage) {
          return NextResponse.json(googleChatMessage('For safety, Google Chat linking only works in a DM with Public Pearl. Open the Pearl DM and send your code there.', event));
        }
        const linked = await consumeGoogleChatLinkCode({
          code: linkCode,
          googleChatUserName,
          googleChatDisplayName: cleanText(event.user?.displayName) || null,
          googleChatUserEmail: googleChatUserEmail(event),
          googleChatSpaceName: googleChatSpaceName(event),
          googleChatSpaceUri: googleChatSpaceUri(event),
        });
        if (!linked.linked) {
          if (linked.reason === 'google_account_mismatch') {
            return NextResponse.json(googleChatMessage('That code belongs to a different PearlOS Google account. Sign in to PearlOS with this same Google account, then try again.', event));
          }
          if (linked.reason === 'google_chat_email_missing') {
            return NextResponse.json(googleChatMessage('Google Chat did not include your Google account email, so I cannot safely link this chat. Use the Connect Google Chat button in PearlOS Settings instead.', event));
          }
          return NextResponse.json(googleChatMessage('That link code did not match or has expired. Generate a fresh Google Chat code in PearlOS Settings > Connections.', event));
        }
        return NextResponse.json(googleChatMessage('Google Chat is linked to your PearlOS account. You can talk to Public Pearl here now.', event));
      }

      const linkedScope = await getGoogleChatLinkedAccountScope(googleChatUserName, {
        googleChatUserEmail: googleChatUserEmail(event),
        googleChatSpaceName: googleChatSpaceName(event),
      });
      if (!linkedScope) {
        return NextResponse.json(googleChatMessage(directMessage ? LINK_PROMPT : GROUP_LINK_PROMPT, event));
      }

      if (!directMessage) {
        const reply = await groupPublicReply(event, linkedScope, text);
        const threadName = cleanText(event.message?.thread?.name);
        const sent = await sendGoogleChatMessage({
          spaceName: googleChatSpaceName(event),
          text: reply,
          privateMessageViewer: null,
          threadName,
        });
        if (sent.ok) return new NextResponse(null, { status: 204 });
        return NextResponse.json(googleChatMessage(reply, event));
      }

      try {
        const reply = await askPearl(event, linkedScope, text);
        return NextResponse.json(googleChatMessage(reply, event));
      } catch (error) {
        return NextResponse.json(googleChatMessage(fallbackMessage(error), event));
      }
    }
    default:
      return NextResponse.json({});
  }
}
