import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getUserAccountByProvider } from '@nia/prism/core/actions/account-actions';
import { getDiscordDmLinkByUser, revokeDiscordDmLink } from '@nia/prism/core/actions/discord-dm-link-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';
import { removeDiscordOpenClawAccess } from './_lib/openclaw-discord-access';
import {
  DiscordDmVerificationRequestError,
  issueDiscordDmVerificationCode,
} from './_lib/verification-request';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ linked: false, reason: 'unauthorized' }, { status: 401 });
  }

  const link = await getDiscordDmLinkByUser(session.user.id);
  if (!link) {
    return NextResponse.json({ linked: false });
  }

  return NextResponse.json({
    linked: true,
    discordUserId: link.discordUserId,
    verifiedAt: link.verifiedAt,
  });
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const account = (await getUserAccountByProvider(session.user.id, 'discord')) as IAccount | null;
  const discordUserId = typeof account?.providerAccountId === 'string' ? account.providerAccountId.trim() : '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json(
      { success: false, error: 'Connect Discord before enabling Pearl DMs.', code: 'discord_not_connected' },
      { status: 403 },
    );
  }

  try {
    const result = await issueDiscordDmVerificationCode({
      userId: session.user.id,
      discordUserId,
    });
    return NextResponse.json({
      success: true,
      linked: false,
      code: result.code,
      codeSent: false,
      discordUserId,
      expiresAt: result.expiresAt,
      verificationMode: 'discord_code_message',
      instructions: `Send ${result.code} to Pearl in a Discord DM.`,
    });
  } catch (error) {
    if (error instanceof DiscordDmVerificationRequestError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    }
    console.warn('[discord/dm-link] OAuth verification request failed', error);
    return NextResponse.json({ success: false, error: 'Failed to create verification code' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const link = await getDiscordDmLinkByUser(session.user.id);
  const revoked = await revokeDiscordDmLink(session.user.id);
  const openclaw = link?.discordUserId
    ? await removeDiscordOpenClawAccess(link.discordUserId)
    : { allowlistRemoved: false, pendingPairingRemoved: false };
  return NextResponse.json({ success: true, revoked, openclaw });
}
