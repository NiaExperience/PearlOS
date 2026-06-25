import { NextRequest, NextResponse } from 'next/server';
import {
  allowedDiscordBridgeChannelIds,
  configuredDiscordGuildId,
  getDiscordBotToken,
  requireConfiguredGuild,
  requireDiscordAccount,
  requireGuildMembership,
} from '../_lib/require-discord-account';

/**
 * /api/discord/channels — List text channels the bot can see in a guild.
 *
 * GET /api/discord/channels?guildId=<id>
 *
 * Returns JSON: { channels: [{ id, name, type, position }] }
 * Only returns text channels (type 0) and announcement channels (type 5).
 */

const DISCORD_API = 'https://discord.com/api/v10';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function canReadMessages(token: string, channelId: string): Promise<boolean> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=1`, {
    headers: { Authorization: `Bot ${token}` },
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  const auth = await requireDiscordAccount();
  if (!auth.ok) return auth.response;

  const guildError = requireConfiguredGuild();
  if (guildError) return guildError;

  const token = getDiscordBotToken();
  if (!token) {
    return NextResponse.json({ error: 'Discord bot token not configured' }, { status: 500 });
  }

  const allowedChannelIds = allowedDiscordBridgeChannelIds();
  if (allowedChannelIds.size === 0) {
    return NextResponse.json({
      channels: [],
      error: 'No Pearl Village channels are configured for the Discord bridge.',
      code: 'discord_bridge_channels_not_configured',
    });
  }

  const membershipError = await requireGuildMembership(token, auth.account);
  if (membershipError) return membershipError;

  const requestedGuildId = req.nextUrl.searchParams.get('guildId') || configuredDiscordGuildId();
  const guildId = configuredDiscordGuildId();
  if (requestedGuildId !== guildId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[discord/channels] Discord API error:', res.status, text);
      return NextResponse.json({ error: 'Discord API error', status: res.status }, { status: 502 });
    }

    const allChannels = await res.json();

    // Filter to text (0) and announcement (5) channels only, sorted by position
    const textChannels = allChannels
      .filter((ch: any) => ch.type === 0 || ch.type === 5)
      .sort((a: any, b: any) => a.position - b.position)
      .map((ch: any) => ({
        id: ch.id,
        name: ch.name,
        type: ch.type,
        position: ch.position,
        parentId: ch.parent_id || null,
      }));

    const readableChannels = [];
    const configuredChannelIds = [...allowedChannelIds];
    const missingChannelIds = configuredChannelIds.filter(
      (id) => !textChannels.some((channel: { id: string }) => channel.id === id),
    );
    const unreadableChannelIds = [];
    for (const channel of textChannels) {
      if (!allowedChannelIds.has(channel.id)) continue;
      if (await canReadMessages(token, channel.id)) {
        readableChannels.push(channel);
      } else {
        unreadableChannelIds.push(channel.id);
      }
    }

    if (readableChannels.length === 0) {
      return NextResponse.json({
        channels: [],
        error: 'Pearl Village is connected, but none of the configured bridge channels are readable by Pearl.',
        code: 'discord_no_readable_bridge_channels',
        configuredChannelIds,
        missingChannelIds,
        unreadableChannelIds,
      });
    }

    return NextResponse.json({ channels: readableChannels, configuredChannelIds });
  } catch (err: any) {
    console.error('[discord/channels] Error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 });
  }
}
