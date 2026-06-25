import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { getTelegramDmLinkByUser, revokeTelegramDmLink } from '@nia/prism/core/actions/telegram-dm-link-actions';
import { removeTelegramUserFromOpenClawAllowlist } from '../_lib/openclaw-telegram-allowlist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ linked: false, reason: 'unauthorized' }, { status: 401 });
  }

  const link = await getTelegramDmLinkByUser(session.user.id);
  if (!link) {
    return NextResponse.json({ linked: false });
  }

  return NextResponse.json({
    linked: true,
    telegramUserId: link.telegramUserId,
    telegramUsername: link.telegramUsername,
    verifiedAt: link.verifiedAt,
  });
}

export async function DELETE(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 });
  }

  const current = await getTelegramDmLinkByUser(session.user.id);
  const revoked = await revokeTelegramDmLink(session.user.id);
  if (current?.telegramUserId) {
    await removeTelegramUserFromOpenClawAllowlist(current.telegramUserId);
  }
  return NextResponse.json({ success: true, revoked });
}
