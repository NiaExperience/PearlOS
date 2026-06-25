import { NextRequest, NextResponse } from 'next/server';
import { generateDiscordCode, hashDiscordCode } from '@interface/lib/discord-dm-code';
import { sendDiscordDm } from '../../_lib/send-discord-dm';
import {
  createDiscordDmVerification,
  listDiscordDmVerificationsForUser,
} from '@nia/prism/core/actions/discord-dm-verification-actions';
import { getAccountByProviderAccountId } from '@nia/prism/core/actions/account-actions';
import type { IAccount } from '@nia/prism/core/blocks/account.block';
import type { IDiscordDmVerification } from '@nia/prism/core/actions/discord-dm-verification-constants';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ACTIVE_PER_HOUR = 5;

function isAuthorized(req: NextRequest): boolean {
  const provided = req.headers.get('x-internal-secret')?.trim();
  const expected = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
  return Boolean(expected && provided && provided === expected);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId.trim() : '';
  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ error: 'Invalid Discord user ID.' }, { status: 400 });
  }

  const account = (await getAccountByProviderAccountId('discord', discordUserId)) as IAccount | null;
  if (!account?.userId) {
    return NextResponse.json({ error: 'discord_account_not_linked' }, { status: 404 });
  }

  const now = Date.now();
  const existing = await listDiscordDmVerificationsForUser(account.userId);
  const activeRecentCount = existing.filter((item: IDiscordDmVerification) => {
    if (item.consumedAt) return false;
    const issuedAt = item.issuedAt ? new Date(item.issuedAt).getTime() : 0;
    const expiresAt = new Date(item.expiresAt).getTime();
    return expiresAt > now && issuedAt >= now - HOUR_MS;
  }).length;
  if (activeRecentCount >= MAX_ACTIVE_PER_HOUR) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const code = generateDiscordCode();
  const codeHash = hashDiscordCode(code);
  const expiresAt = new Date(now + DAY_MS).toISOString();

  await createDiscordDmVerification({
    userId: account.userId,
    discordUserId,
    codeHash,
    expiresAt,
    attempts: 0,
    issuedAt: new Date(now).toISOString(),
  });

  const dmText =
    `You mentioned Pearl in Pearl Village, but your Pearl DMs are not verified yet.\n\n` +
    `Your PearlOS verification code is: ${code}\n\n` +
    `Where to enter it:\n` +
    `PearlOS Settings -> Connection -> Discord -> Pearl DMs\n\n` +
    `This code expires in 24 hours. If you did not request this, you can ignore this message.`;

  await sendDiscordDm(discordUserId, dmText);

  return NextResponse.json({
    success: true,
    codeSent: true,
    expiresAt,
  });
}
