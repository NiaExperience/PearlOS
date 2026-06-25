import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { generateDiscordCode, hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  getActiveTelegramDmVerificationByStartToken,
  markTelegramDmVerificationConsumed,
  updateTelegramDmVerification,
} from '@nia/prism/core/actions/telegram-dm-verification-actions';
import { resolveTelegramStartTokenClaim, sendTelegramMessage } from '../../_lib/telegram-bot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function hashStartToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

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

  const startToken = typeof body.startToken === 'string' ? body.startToken.trim() : '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(startToken)) {
    return NextResponse.json({ error: 'Invalid start token.' }, { status: 400 });
  }

  const now = Date.now();
  const startTokenHash = hashStartToken(startToken);
  const verification = await getActiveTelegramDmVerificationByStartToken(session.user.id, startTokenHash);
  if (!verification || !verification._id) {
    return NextResponse.json({ error: 'No active Telegram link request found.' }, { status: 404 });
  }

  if (new Date(verification.expiresAt).getTime() <= now) {
    await markTelegramDmVerificationConsumed(verification._id);
    return NextResponse.json({ error: 'Link request expired. Request a new one.' }, { status: 410 });
  }

  if (verification.claimedAt && verification.codeHash) {
    return NextResponse.json({
      success: true,
      codeSent: true,
      expiresAt: verification.expiresAt,
      claimedAt: verification.claimedAt,
    });
  }

  const startPayload = `verify_${startToken}`;
  let match;
  try {
    match = await resolveTelegramStartTokenClaim(startPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not reach Telegram.';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (!match) {
    return NextResponse.json(
      {
        error: 'Open @PearlOS_bot in Telegram, press Start from your unique link, then try again.',
        needsTelegramStart: true,
      },
      { status: 404 },
    );
  }

  const code = generateDiscordCode();
  const codeHash = hashDiscordCode(code);
  const claimedAt = new Date().toISOString();

  const updated = await updateTelegramDmVerification(verification._id, {
    telegramUserId: match.telegramUserId,
    telegramChatId: match.telegramChatId,
    telegramUsername: match.telegramUsername ?? null,
    codeHash,
    claimedAt,
    issuedAt: claimedAt,
  });

  if (!updated) {
    return NextResponse.json({ error: 'Could not update Telegram verification.' }, { status: 500 });
  }

  try {
    await sendTelegramMessage(
      match.telegramChatId,
      `Your PearlOS verification code is: ${code}\n\n` +
        `It expires in 24 hours.\n` +
        `If you did not request this, you can safely ignore this message.`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send Telegram message';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  return NextResponse.json({
    success: true,
    codeSent: true,
    expiresAt: verification.expiresAt,
    claimedAt,
  });
}
