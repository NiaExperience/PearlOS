import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomBytes } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { interfaceAuthOptions } from '@interface/lib/auth-config';
import { generateDiscordCode, hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  createTelegramDmVerification,
  listTelegramDmVerificationsForUser,
} from '@nia/prism/core/actions/telegram-dm-verification-actions';
import type { ITelegramDmVerification } from '@nia/prism/core/actions/telegram-dm-verification-constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ACTIVE_PER_HOUR = 5;
const DEFAULT_TELEGRAM_BOT_USERNAME = 'PearlOS_bot';

function hashStartToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function generateStartToken(): string {
  return randomBytes(24).toString('base64url');
}

function getBotUsername(): string {
  const raw = process.env.TELEGRAM_BOT_USERNAME?.trim();
  const normalized = raw?.replace(/^@/, '');
  return normalized || DEFAULT_TELEGRAM_BOT_USERNAME;
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(interfaceAuthOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const existing = await listTelegramDmVerificationsForUser(session.user.id);
  const activeRecentCount = existing.filter((item: ITelegramDmVerification) => {
    if (item.consumedAt) return false;
    const issuedAt = item.issuedAt ? new Date(item.issuedAt).getTime() : 0;
    const expiresAt = new Date(item.expiresAt).getTime();
    return expiresAt > now && issuedAt >= now - HOUR_MS;
  }).length;

  if (activeRecentCount >= MAX_ACTIVE_PER_HOUR) {
    return NextResponse.json({ error: 'Too many requests. Try again in about an hour.' }, { status: 429 });
  }

  const startToken = generateStartToken();
  const startTokenHash = hashStartToken(startToken);
  const code = generateDiscordCode();
  const codeHash = hashDiscordCode(code);
  const expiresAt = new Date(now + DAY_MS).toISOString();
  const startPayload = `verify_${startToken}`;
  const botUsername = getBotUsername();
  const deepLinkUrl = `https://t.me/${botUsername}?start=${encodeURIComponent(startPayload)}`;

  await createTelegramDmVerification({
    userId: session.user.id,
    startTokenHash,
    startTokenIssuedAt: new Date(now).toISOString(),
    codeHash,
    expiresAt,
    attempts: 0,
    issuedAt: new Date(now).toISOString(),
  } as ITelegramDmVerification);

  return NextResponse.json({
    success: true,
    expiresAt,
    codeSent: false,
    needsTelegramStart: false,
    verificationMode: 'telegram_code_message',
    code,
    instructions: `Send ${code} to @${botUsername} in Telegram.`,
    startToken,
    startPayload,
    deepLinkUrl,
    botUsername,
  });
}
