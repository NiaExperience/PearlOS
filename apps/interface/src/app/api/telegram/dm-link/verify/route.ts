import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  getActiveTelegramDmVerification,
  incrementTelegramDmVerificationAttempt,
  markTelegramDmVerificationConsumed,
} from '@nia/prism/core/actions/telegram-dm-verification-actions';
import { upsertTelegramDmLink } from '@nia/prism/core/actions/telegram-dm-link-actions';
import { addTelegramUserToOpenClawAllowlist } from '../../_lib/openclaw-telegram-allowlist';
import { sendTelegramMessage } from '../../_lib/telegram-bot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: 'Enter a valid 6-character code.' }, { status: 400 });
  }

  const verification = await getActiveTelegramDmVerification(session.user.id);
  if (!verification || !verification._id) {
    return NextResponse.json({ error: 'No active code found or code expired.' }, { status: 410 });
  }

  if (new Date(verification.expiresAt).getTime() <= Date.now()) {
    await markTelegramDmVerificationConsumed(verification._id);
    return NextResponse.json({ error: 'Code expired. Request a new one.' }, { status: 410 });
  }

  if (!verification.codeHash || !verification.telegramUserId || !verification.telegramChatId) {
    return NextResponse.json(
      { error: 'Complete Telegram start step first, then request verification again.' },
      { status: 409 },
    );
  }

  const providedHash = hashDiscordCode(code);
  if (providedHash !== verification.codeHash) {
    const updated = await incrementTelegramDmVerificationAttempt(verification._id);
    if ((updated?.attempts ?? 0) >= 5) {
      return NextResponse.json({ error: 'Too many attempts. Request a new code.' }, { status: 429 });
    }
    return NextResponse.json({ error: 'Incorrect code. Try again.' }, { status: 400 });
  }

  await markTelegramDmVerificationConsumed(verification._id);
  const link = await upsertTelegramDmLink({
    userId: session.user.id,
    telegramUserId: verification.telegramUserId,
    telegramChatId: verification.telegramChatId,
    telegramUsername: verification.telegramUsername ?? null,
  });
  await addTelegramUserToOpenClawAllowlist(link.telegramUserId);

  try {
    await sendTelegramMessage(
      link.telegramChatId,
      `You're verified for Pearl Telegram DMs.\n\n` +
        `You can now talk to Pearl directly here.\n\n` +
        `If this wasn't you, remove the Telegram link from PearlOS Settings.`,
    );
  } catch (err) {
    console.warn('[telegram/dm-link/verify] verification confirmation failed', err);
  }

  return NextResponse.json({
    success: true,
    linked: true,
    telegramUserId: link.telegramUserId,
    telegramUsername: link.telegramUsername,
    verifiedAt: link.verifiedAt,
  });
}
