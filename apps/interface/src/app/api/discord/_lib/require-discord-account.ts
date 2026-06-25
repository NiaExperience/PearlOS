import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getUserAccountByProvider } from '@nia/prism/core/actions/account-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DISCORD_ENV_KEY = ['DISCORD', 'BOT', 'TOKEN'].join('_');
const OPENCLAW_CONFIG_PATHS = [
  '/home/deploy/.openclaw/relay-openclaw.json',
  '/home/deploy/.openclaw/openclaw.json',
  '/root/.openclaw/openclaw.json',
];

type DiscordRouteAuth =
  | { ok: true; userId: string; account: IAccount }
  | { ok: false; response: NextResponse };

type SessionWithUserId = {
  user?: {
    id?: string;
  };
} | null;

type DiscordChannel = {
  id: string;
  guild_id?: string;
  type?: number;
};

export function configuredDiscordGuildId(): string {
  return DISCORD_GUILD_ID.trim();
}

function envList(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function allowedDiscordBridgeChannelIds(): Set<string> {
  const configured = [
    ...envList('DISCORD_BRIDGE_CHANNEL_IDS'),
    ...envList('DISCORD_PUBLIC_CHANNEL_IDS'),
  ];
  return new Set(configured.filter((id) => /^\d{17,20}$/.test(id)));
}

export function requireAllowedBridgeChannel(channelId: string): NextResponse | null {
  if (!/^\d{17,20}$/.test(channelId)) {
    return NextResponse.json({ error: 'Invalid channel ID' }, { status: 400 });
  }
  if (!allowedDiscordBridgeChannelIds().has(channelId)) {
    return NextResponse.json({ error: 'Forbidden', code: 'discord_bridge_channel_forbidden' }, { status: 403 });
  }
  return null;
}

export function getDiscordBotToken(): string | null {
  if (process.env[DISCORD_ENV_KEY]) return process.env[DISCORD_ENV_KEY] as string;

  const fs = require('fs');
  for (const configPath of OPENCLAW_CONFIG_PATHS) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const token =
        config?.channels?.discord?.token ||
        config?.channels?.discord?.accounts?.default?.token ||
        config?.env?.[DISCORD_ENV_KEY];
      if (token) return token;
    } catch {
      // Try the next known OpenClaw config location.
    }
  }

  return null;
}

export async function requireDiscordAccount(): Promise<DiscordRouteAuth> {
  let session: SessionWithUserId;
  try {
    session = (await getServerSession(interfaceAuthOptions)) as SessionWithUserId;
  } catch (err) {
    console.error('[discord/auth] session lookup failed', err);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (!session?.user?.id) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  try {
    const account = (await getUserAccountByProvider(session.user.id, 'discord')) as IAccount | null;
    if (!account) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Discord account not connected', code: 'discord_not_connected' },
          { status: 403 },
        ),
      };
    }

    return { ok: true, userId: session.user.id, account };
  } catch (err) {
    console.error('[discord/auth] account lookup failed', err);
    return {
      ok: false,
      response: NextResponse.json({ error: 'Discord account lookup failed' }, { status: 500 }),
    };
  }
}

export function requireConfiguredGuild(): NextResponse | null {
  if (configuredDiscordGuildId()) return null;
  return NextResponse.json({ error: 'Discord guild not configured' }, { status: 500 });
}

export async function requireGuildMembership(
  token: string,
  account: IAccount,
): Promise<NextResponse | null> {
  const guildId = configuredDiscordGuildId();
  if (!guildId) return requireConfiguredGuild();

  const discordUserId = typeof account.providerAccountId === 'string' ? account.providerAccountId.trim() : '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ error: 'Discord account not connected', code: 'discord_not_connected' }, { status: 403 });
  }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${discordUserId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (res.ok) return null;
  if (res.status === 404 || res.status === 403) {
    return NextResponse.json(
      { error: 'Discord account is not authorized for this server', code: 'discord_guild_required' },
      { status: 403 },
    );
  }
  console.error('[discord/auth] guild membership check failed', res.status, await res.text().catch(() => ''));
  return NextResponse.json({ error: 'Discord authorization check failed' }, { status: 502 });
}

export async function requireChannelInConfiguredGuild(
  token: string,
  channelId: string,
): Promise<NextResponse | null> {
  const guildId = configuredDiscordGuildId();
  if (!guildId) return requireConfiguredGuild();
  if (!/^\d{17,20}$/.test(channelId)) {
    return NextResponse.json({ error: 'Invalid channel ID' }, { status: 400 });
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    console.error('[discord/auth] channel lookup failed', res.status, text);
    return NextResponse.json({ error: 'Discord API error', status: res.status }, { status: 502 });
  }

  const channel = (await res.json()) as DiscordChannel;
  if (channel.guild_id !== guildId || (channel.type !== 0 && channel.type !== 5)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}
