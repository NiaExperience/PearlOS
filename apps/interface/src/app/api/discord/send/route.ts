import { NextRequest, NextResponse } from 'next/server';
import { sanitizeDiscordContent } from '../_lib/sanitize-discord-content';
import {
  getDiscordBotToken,
  requireAllowedBridgeChannel,
  requireChannelInConfiguredGuild,
  requireConfiguredGuild,
  requireDiscordAccount,
  requireGuildMembership,
} from '../_lib/require-discord-account';

/**
 * /api/discord/send — User-authored Pearl Village posting.
 *
 * POST /api/discord/send
 * Body: { channelId: string, content: string }
 *
 * PearlOS must never let an authenticated user post arbitrary content as the
 * public Pearl bot. User-authored sends go through a channel webhook with the
 * linked user's Discord profile as a display override. Discord will still show
 * this as an app/webhook-authored message, not a native human account message.
 */

const DISCORD_API = 'https://discord.com/api/v10';
const WEBHOOK_NAME = 'PearlOS Bridge';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DiscordUser = {
  id: string;
  username?: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordWebhook = {
  id?: string;
  token?: string;
  name?: string | null;
};

function envList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isDiscordWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'discord.com' || url.hostname === 'discordapp.com') &&
      /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[^/]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function configuredWebhookUrl(channelId: string): string | null {
  const jsonValue = process.env.DISCORD_CHANNEL_WEBHOOK_URLS || process.env.DISCORD_WEBHOOK_URLS || '';
  if (jsonValue.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(jsonValue) as Record<string, unknown>;
      const value = parsed[channelId];
      const url = typeof value === 'string' ? value.trim() : '';
      return url && isDiscordWebhookUrl(url) ? url : null;
    } catch {
      return null;
    }
  }

  for (const entry of [
    ...envList('DISCORD_CHANNEL_WEBHOOK_URLS'),
    ...envList('DISCORD_WEBHOOK_URLS'),
  ]) {
    const [id, ...urlParts] = entry.split('=');
    const url = urlParts.join('=').trim();
    if (id.trim() === channelId && url && isDiscordWebhookUrl(url)) return url;
  }
  return null;
}

function webhookUrlFromParts(webhook: DiscordWebhook): string | null {
  if (!webhook.id || !webhook.token) return null;
  return `${DISCORD_API}/webhooks/${webhook.id}/${webhook.token}`;
}

async function discordFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'DiscordBot (PearlOS-Interface, 1.0)',
      ...(init.headers || {}),
    },
  });
}

async function resolveChannelWebhookUrl(channelId: string, token: string): Promise<string | NextResponse> {
  const configured = configuredWebhookUrl(channelId);
  if (configured) return configured;

  const listRes = await discordFetch(`/channels/${channelId}/webhooks`, token);
  if (listRes.ok) {
    const webhooks = (await listRes.json().catch(() => [])) as DiscordWebhook[];
    const existing = Array.isArray(webhooks)
      ? webhooks.find((webhook) => webhook.name === WEBHOOK_NAME && webhook.token)
      : null;
    const existingUrl = existing ? webhookUrlFromParts(existing) : null;
    if (existingUrl) return existingUrl;
  } else if (listRes.status !== 403 && listRes.status !== 404) {
    const text = await listRes.text().catch(() => '');
    console.error('[discord/send] webhook list failed', listRes.status, text.slice(0, 300));
    return NextResponse.json({ error: 'Discord webhook lookup failed', status: listRes.status }, { status: 502 });
  }

  const createRes = await discordFetch(`/channels/${channelId}/webhooks`, token, {
    method: 'POST',
    body: JSON.stringify({ name: WEBHOOK_NAME }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    console.error('[discord/send] webhook create failed', createRes.status, text.slice(0, 300));
    return NextResponse.json(
      {
        error: 'PearlOS needs a configured Discord webhook or Manage Webhooks permission for this channel.',
        code: 'discord_webhook_unavailable',
      },
      { status: createRes.status === 403 ? 403 : 502 },
    );
  }

  const created = (await createRes.json().catch(() => ({}))) as DiscordWebhook;
  const createdUrl = webhookUrlFromParts(created);
  if (!createdUrl) {
    return NextResponse.json({ error: 'Discord did not return a usable webhook token' }, { status: 502 });
  }
  return createdUrl;
}

function avatarUrl(userId: string, avatarHash?: string | null): string {
  if (!avatarHash) {
    const index = (BigInt(userId) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
}

async function fetchDiscordUser(token: string, discordUserId: string): Promise<DiscordUser | null> {
  const res = await discordFetch(`/users/${discordUserId}`, token, { method: 'GET' });
  if (!res.ok) {
    console.error('[discord/send] user lookup failed', res.status, await res.text().catch(() => ''));
    return null;
  }
  return (await res.json().catch(() => null)) as DiscordUser | null;
}

export async function POST(req: NextRequest) {
  const auth = await requireDiscordAccount();
  if (!auth.ok) return auth.response;

  const guildError = requireConfiguredGuild();
  if (guildError) return guildError;

  const token = getDiscordBotToken();
  if (!token) {
    return NextResponse.json({ error: 'Discord bot token not configured' }, { status: 500 });
  }

  const membershipError = await requireGuildMembership(token, auth.account);
  if (membershipError) return membershipError;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const channelId = typeof body.channelId === 'string' ? body.channelId.trim() : '';
  const bridgeChannelError = requireAllowedBridgeChannel(channelId);
  if (bridgeChannelError) return bridgeChannelError;

  const channelError = await requireChannelInConfiguredGuild(token, channelId);
  if (channelError) return channelError;

  const rawContent = typeof body.content === 'string' ? body.content : '';
  const content = sanitizeDiscordContent(rawContent).trim();
  if (!content) {
    return NextResponse.json({ error: 'Message is empty after safety filtering' }, { status: 400 });
  }
  if (content.length > 2000) {
    return NextResponse.json({ error: 'Discord messages must be 2000 characters or less' }, { status: 400 });
  }

  const discordUserId = typeof auth.account.providerAccountId === 'string' ? auth.account.providerAccountId.trim() : '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ error: 'Discord account not connected', code: 'discord_not_connected' }, { status: 403 });
  }

  const discordUser = await fetchDiscordUser(token, discordUserId);
  const username = (discordUser?.global_name || discordUser?.username || `Discord user ${discordUserId.slice(-4)}`)
    .trim()
    .slice(0, 80);
  const webhookUrl = await resolveChannelWebhookUrl(channelId, token);
  if (webhookUrl instanceof NextResponse) return webhookUrl;

  const webhookRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      username,
      avatar_url: avatarUrl(discordUserId, discordUser?.avatar),
      allowed_mentions: { parse: [] },
    }),
  });

  if (!webhookRes.ok) {
    const text = await webhookRes.text().catch(() => '');
    console.error('[discord/send] webhook execute failed', webhookRes.status, text.slice(0, 300));
    return NextResponse.json({ error: 'Discord webhook send failed', status: webhookRes.status }, { status: 502 });
  }

  return NextResponse.json({ success: true, mode: 'webhook_profile_override', channelId });
}
