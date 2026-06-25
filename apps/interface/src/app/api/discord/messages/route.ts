import { NextRequest, NextResponse } from 'next/server';
import {
  allowedDiscordBridgeChannelIds,
  getDiscordBotToken,
  requireAllowedBridgeChannel,
  requireChannelInConfiguredGuild,
  requireConfiguredGuild,
  requireDiscordAccount,
  requireGuildMembership,
} from '../_lib/require-discord-account';

/**
 * /api/discord/messages — Fetch recent messages from a Discord channel.
 *
 * GET /api/discord/messages?channelId=<id>&limit=<n>&before=<messageId>
 *
 * Returns JSON: { messages: [{ id, content, author, timestamp, attachments, embeds }] }
 */

const DISCORD_API = 'https://discord.com/api/v10';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function avatarUrl(userId: string, avatarHash: string | null): string {
  if (!avatarHash) {
    // Default Discord avatar
    const index = (BigInt(userId) >> BigInt(22)) % BigInt(6);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const ext = avatarHash.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=64`;
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

  const membershipError = await requireGuildMembership(token, auth.account);
  if (membershipError) return membershipError;

  const channelId = req.nextUrl.searchParams.get('channelId') || [...allowedDiscordBridgeChannelIds()][0] || '';
  const bridgeChannelError = requireAllowedBridgeChannel(channelId);
  if (bridgeChannelError) return bridgeChannelError;

  const channelError = await requireChannelInConfiguredGuild(token, channelId);
  if (channelError) return channelError;

  const limit = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get('limit') || '50', 10) || 50, 1), 100);
  const before = req.nextUrl.searchParams.get('before') || '';

  try {
    let url = `${DISCORD_API}/channels/${channelId}/messages?limit=${limit}`;
    if (before) url += `&before=${before}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bot ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[discord/messages] Discord API error:', res.status, text);
      return NextResponse.json({ error: 'Discord API error', status: res.status }, { status: 502 });
    }

    const raw = await res.json();

    const messages = raw.map((msg: any) => ({
      id: msg.id,
      content: msg.content || '',
      author: {
        id: msg.author.id,
        username: msg.author.username,
        displayName: msg.author.global_name || msg.author.username,
        avatar: avatarUrl(msg.author.id, msg.author.avatar),
        bot: msg.author.bot || false,
      },
      timestamp: msg.timestamp,
      editedTimestamp: msg.edited_timestamp,
      attachments: (msg.attachments || []).map((a: any) => ({
        id: a.id,
        filename: a.filename,
        url: a.url,
        contentType: a.content_type,
        size: a.size,
      })),
      embeds: (msg.embeds || []).length,
      reactions: (msg.reactions || []).map((r: any) => ({
        emoji: r.emoji.name,
        count: r.count,
      })),
      referencedMessage: msg.referenced_message
        ? {
            id: msg.referenced_message.id,
            content: (msg.referenced_message.content || '').slice(0, 120),
            author: msg.referenced_message.author?.username || 'Unknown',
          }
        : null,
      type: msg.type, // 0 = default, 19 = reply, etc.
    }));

    // Discord returns newest first — reverse to oldest-first for the UI
    messages.reverse();

    return NextResponse.json({ messages, channelId });
  } catch (err: any) {
    console.error('[discord/messages] Error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
