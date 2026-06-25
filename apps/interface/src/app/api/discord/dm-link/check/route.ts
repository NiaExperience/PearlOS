import { NextRequest, NextResponse } from 'next/server';
import { getDiscordDmLinkedAccountScope } from '@nia/prism/core/actions/discord-dm-link-actions';
import { approveDiscordOpenClawAccess } from '../_lib/openclaw-discord-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const provided = req.headers.get('x-internal-secret')?.trim();
  const expected = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ allowed: false, reason: 'forbidden' }, { status: 403 });
  }

  const discordUserId = req.nextUrl.searchParams.get('discordUserId')?.trim() || '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ allowed: false, reason: 'invalid_discord_user_id' }, { status: 400 });
  }

  const scope = await getDiscordDmLinkedAccountScope(discordUserId);
  if (!scope) {
    return NextResponse.json({ allowed: false });
  }

  const openclaw = await approveDiscordOpenClawAccess(scope.discordUserId).catch((error) => {
    console.warn('[discord/dm-link/check] OpenClaw access sync failed', error);
    return { allowlisted: false, pairingApproved: false, pendingPairingRemoved: false, syncFailed: true };
  });

  return NextResponse.json({
    allowed: true,
    userId: scope.userId,
    email: scope.email,
    tenantId: scope.tenantId,
    discordUserId: scope.discordUserId,
    openclaw,
  });
}
