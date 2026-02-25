import { NextRequest, NextResponse } from 'next/server';

/**
 * /api/discord/send — Send a message to a Discord channel via the bot.
 *
 * POST /api/discord/send
 * Body: { channelId: string, content: string }
 *
 * Returns JSON: { success: true, messageId: string }
 */

const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_CHANNEL_ID = '1471441655650324533'; // #general

function getBotToken(): string | null {
  try {
    const fs = require('fs');
    const config = JSON.parse(fs.readFileSync('/root/.openclaw/openclaw.json', 'utf-8'));
    return config?.channels?.discord?.token || null;
  } catch {
    return process.env.DISCORD_BOT_TOKEN || null;
  }
}

export async function POST(req: NextRequest) {
  const token = getBotToken();
  if (!token) {
    return NextResponse.json({ error: 'Discord bot token not configured' }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const channelId = body.channelId || DEFAULT_CHANNEL_ID;
  const content = (body.content || '').trim();

  if (!content) {
    return NextResponse.json({ error: 'Message content is required' }, { status: 400 });
  }

  if (content.length > 2000) {
    return NextResponse.json({ error: 'Message too long (max 2000 characters)' }, { status: 400 });
  }

  // Basic channel ID validation (snowflake format)
  if (!/^\d{17,20}$/.test(channelId)) {
    return NextResponse.json({ error: 'Invalid channel ID' }, { status: 400 });
  }

  try {
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[discord/send] Discord API error:', res.status, text);
      return NextResponse.json({ error: 'Discord API error', status: res.status }, { status: 502 });
    }

    const msg = await res.json();
    return NextResponse.json({ success: true, messageId: msg.id });
  } catch (err: any) {
    console.error('[discord/send] Error:', err.message);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
