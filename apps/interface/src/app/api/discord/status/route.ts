import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { deleteAccount, getUserAccountByProvider } from '@nia/prism/core/actions/account-actions';
import { getDiscordDmLinkByUser, revokeDiscordDmLink } from '@nia/prism/core/actions/discord-dm-link-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';
import { removeDiscordOpenClawAccess } from '../dm-link/_lib/openclaw-discord-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ connected: false, reason: 'unauthenticated' }, { status: 401 });
  }

  const oauthConfigured = Boolean(
    process.env.DISCORD_CLIENT_ID?.trim() && process.env.DISCORD_CLIENT_SECRET?.trim(),
  );

  try {
    const account = (await getUserAccountByProvider(session.user.id, 'discord')) as IAccount | null;
    if (!account) {
      return NextResponse.json({
        connected: false,
        oauthConfigured,
      });
    }
    return NextResponse.json({
      connected: true,
      discordUserId: account.providerAccountId,
      scope: account.scope,
      expiresAt: account.expires_at,
      oauthConfigured,
    });
  } catch (err) {
    console.error('[discord/status] account lookup failed', err);
    return NextResponse.json(
      { connected: false, oauthConfigured, error: 'lookup_failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthenticated' }, { status: 401 });
  }

  const account = (await getUserAccountByProvider(session.user.id, 'discord')) as IAccount | null;
  const link = await getDiscordDmLinkByUser(session.user.id);
  const discordUserId =
    (typeof account?.providerAccountId === 'string' && account.providerAccountId.trim()) ||
    (typeof link?.discordUserId === 'string' && link.discordUserId.trim()) ||
    '';

  let accountDeleted = false;
  if (account?._id) {
    await deleteAccount(account._id);
    accountDeleted = true;
  }

  const dmLinkRevoked = await revokeDiscordDmLink(session.user.id);
  const openclaw = /^\d{17,20}$/.test(discordUserId)
    ? await removeDiscordOpenClawAccess(discordUserId)
    : { allowlistRemoved: false, pendingPairingRemoved: false };

  return NextResponse.json({
    success: true,
    connected: false,
    accountDeleted,
    dmLinkRevoked,
    openclaw,
  });
}
