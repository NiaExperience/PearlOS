import { NextRequest, NextResponse } from 'next/server';
import { requireDiscordAccount } from '../_lib/require-discord-account';

/**
 * /api/discord/dm — Open a DM channel with a Discord user and send a message.
 *
 * POST /api/discord/dm
 * Body: { userId: string, content?: string }
 *
 * Returns JSON: { success: true, messageId: string, channelId: string }
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_req: NextRequest) {
  const auth = await requireDiscordAccount();
  if (!auth.ok) return auth.response;

  return NextResponse.json(
    { error: 'Direct Discord DM relay is not available from the browser' },
    { status: 403 },
  );
}
