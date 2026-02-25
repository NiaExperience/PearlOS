import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/discord/channels — List text channels the bot can see in a guild.
 *
 * GET /api/discord/channels?guildId=<id>
 *
 * Returns JSON: { channels: [{ id, name, type, position }] }
 * Only returns text channels (type 0) and announcement channels (type 5).
 */

const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_GUILD_ID = '1471441655126167553';

function getBotToken(): string | null {
  try {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf-8'));
    return config?.channels?.discord?.token || null;
  } catch {
    return process.env.DISCORD_BOT_TOKEN || null;
  }
}

export async function GET(req: NextRequest) {
  const token = getBotToken();
  if (!token) {
    return NextResponse.json({ error: 'Discord bot token not configured' }, { status: 500 });
  }

  const guildId = req.nextUrl.searchParams.get('guildId') || DEFAULT_GUILD_ID;

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

    return NextResponse.json({ channels: textChannels });
  } catch (err: any) {
    console.error('[discord/channels] Error:', err.message);
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 });
  }
}
