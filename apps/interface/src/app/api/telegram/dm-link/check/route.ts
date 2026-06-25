import { NextRequest, NextResponse } from 'next/server';
import { getTelegramDmLinkByTelegramId } from '@nia/prism/core/actions/telegram-dm-link-actions';
import { getUserById } from '@nia/prism/core/actions/user-actions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const provided = req.headers.get('x-internal-secret')?.trim();
  const expected = (process.env.TELEGRAM_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ allowed: false, reason: 'forbidden' }, { status: 403 });
  }

  const telegramUserId = req.nextUrl.searchParams.get('telegramUserId')?.trim() || '';
  if (!/^\d{5,}$/.test(telegramUserId)) {
    return NextResponse.json({ allowed: false, reason: 'invalid_telegram_user_id' }, { status: 400 });
  }

  const link = await getTelegramDmLinkByTelegramId(telegramUserId);
  if (!link) {
    return NextResponse.json({ allowed: false });
  }

  const user = await getUserById(link.userId);
  return NextResponse.json({
    allowed: true,
    userId: link.userId,
    telegramUserId: link.telegramUserId,
    telegramChatId: link.telegramChatId,
    telegramUsername: link.telegramUsername ?? null,
    user: user
      ? {
          id: user._id,
          name: user.name ?? null,
          email: user.email ?? null,
          phoneNumber: user.phone_number ?? null,
        }
      : null,
  });
}
