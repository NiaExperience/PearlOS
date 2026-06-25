import { NextRequest, NextResponse } from 'next/server';
import { hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  getActiveTelegramDmVerificationByCodeHash,
  updateTelegramDmVerification,
} from '@nia/prism/core/actions/telegram-dm-verification-actions';
import { getTelegramDmLinkByTelegramId, upsertTelegramDmLink } from '@nia/prism/core/actions/telegram-dm-link-actions';
import { addTelegramUserToOpenClawAllowlist } from '../../_lib/openclaw-telegram-allowlist';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const provided =
    req.headers.get('x-internal-secret')?.trim() ||
    req.headers.get('x-telegram-dm-link-secret')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  const expected = (process.env.TELEGRAM_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
  return Boolean(expected && provided && provided === expected);
}

function extractCode(input: string): string | null {
  const upper = input.trim().toUpperCase();
  if (/^[A-Z0-9]{6}$/.test(upper)) return upper;
  const match = upper.match(/\b[A-Z0-9]{6}\b/);
  return match?.[0] ?? null;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ verified: false, reason: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ verified: false, reason: 'invalid_json' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : '';
  const telegramUserId = typeof body.telegramUserId === 'string' ? body.telegramUserId.trim() : '';
  const telegramChatId = typeof body.telegramChatId === 'string' ? body.telegramChatId.trim() : '';
  const telegramUsername = typeof body.telegramUsername === 'string' && body.telegramUsername.trim()
    ? body.telegramUsername.trim()
    : null;

  if (!/^\d{5,}$/.test(telegramUserId) || !/^-?\d{5,}$/.test(telegramChatId)) {
    return NextResponse.json({ verified: false, reason: 'invalid_telegram_identity' }, { status: 400 });
  }

  const code = extractCode(text);
  if (!code) {
    return NextResponse.json({ verified: false, reason: 'no_code' });
  }

  const existingLink = await getTelegramDmLinkByTelegramId(telegramUserId);
  if (existingLink) {
    return NextResponse.json({
      verified: true,
      alreadyLinked: true,
      userId: existingLink.userId,
      telegramUserId: existingLink.telegramUserId,
      responseMessage: 'Telegram is already linked. You can talk to Pearl here.',
    });
  }

  const verification = await getActiveTelegramDmVerificationByCodeHash(hashDiscordCode(code));
  if (!verification?._id) {
    return NextResponse.json({ verified: false, reason: 'code_not_found_or_expired' });
  }

  const now = new Date().toISOString();
  await updateTelegramDmVerification(verification._id, {
    telegramUserId,
    telegramChatId,
    telegramUsername,
    claimedAt: verification.claimedAt ?? now,
    consumedAt: now,
  });

  const link = await upsertTelegramDmLink({
    userId: verification.userId,
    telegramUserId,
    telegramChatId,
    telegramUsername,
  });
  const allowlisted = await addTelegramUserToOpenClawAllowlist(telegramUserId);

  return NextResponse.json({
    verified: true,
    linked: true,
    userId: link.userId,
    telegramUserId: link.telegramUserId,
    telegramChatId: link.telegramChatId,
    telegramUsername: link.telegramUsername ?? null,
    verifiedAt: link.verifiedAt,
    allowlisted,
    responseMessage: 'Telegram linked. You can talk to Pearl here now.',
  });
}
