import { sanitizeDiscordContent } from './sanitize-discord-content';

const DISCORD_API = 'https://discord.com/api/v10';
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
      // Try next possible runtime config.
    }
  }
  return null;
}

export async function sendDiscordDm(
  userId: string,
  content: string,
): Promise<{ messageId: string; channelId: string }> {
  const cleanContent = sanitizeDiscordContent(content);
  const token = getBotToken();
  if (!token) {
    throw new Error('Discord bot token not configured');
  }
  if (!/^\d{17,20}$/.test(userId)) {
    throw new Error('Invalid Discord user ID. Please enter your numeric Discord user ID.');
  }
  if (!cleanContent.trim()) {
    throw new Error('Message content is required');
  }
  if (cleanContent.length > 2000) {
    throw new Error('Message too long (max 2000 characters)');
  }

  const dmChannelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dmChannelRes.ok) {
    const text = await dmChannelRes.text();
    throw new Error(`Could not open DM channel (${dmChannelRes.status}): ${text.slice(0, 300)}`);
  }
  const dmChannel = await dmChannelRes.json();
  const channelId = dmChannel.id as string;

  const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: cleanContent }),
  });
  if (!msgRes.ok) {
    const text = await msgRes.text();
    throw new Error(`Failed to send DM (${msgRes.status}): ${text.slice(0, 300)}`);
  }

  const msg = await msgRes.json();
  return { messageId: msg.id as string, channelId };
}
