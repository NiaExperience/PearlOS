import { NextRequest, NextResponse } from 'next/server';
import { hashDiscordCode } from '@interface/lib/discord-dm-code';
import {
  getActiveDiscordDmVerificationByCodeHash,
  updateDiscordDmVerification,
} from '@nia/prism/core/actions/discord-dm-verification-actions';
import {
  getDiscordDmLinkByDiscordId,
  upsertDiscordDmLink,
} from '@nia/prism/core/actions/discord-dm-link-actions';
import { approveDiscordOpenClawAccess } from '../_lib/openclaw-discord-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: NextRequest): boolean {
  const provided =
    req.headers.get('x-internal-secret')?.trim() ||
    req.headers.get('x-discord-dm-link-secret')?.trim() ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ||
    '';
  const expected = (process.env.DISCORD_DM_LINK_SECRET || process.env.MESH_SHARED_SECRET || '').trim();
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
  const discordUserId = typeof body.discordUserId === 'string' ? body.discordUserId.trim() : '';

  if (!/^\d{17,20}$/.test(discordUserId)) {
    return NextResponse.json({ verified: false, reason: 'invalid_discord_identity' }, { status: 400 });
  }

  const code = extractCode(text);
  if (!code) {
    return NextResponse.json({ verified: false, reason: 'no_code' });
  }

  const existingLink = await getDiscordDmLinkByDiscordId(discordUserId);
  if (existingLink) {
    return NextResponse.json({
      verified: true,
      alreadyLinked: true,
      userId: existingLink.userId,
      discordUserId: existingLink.discordUserId,
      responseMessage: 'Discord is already linked. You can talk to Pearl here.',
    });
  }

  const verification = await getActiveDiscordDmVerificationByCodeHash(hashDiscordCode(code));
  if (!verification?._id) {
    return NextResponse.json({
      verified: false,
      reason: 'code_not_found_or_expired',
      responseMessage: 'That PearlOS Discord link code did not match an active request. Generate a fresh code in Public Pearl and send it here.',
    });
  }

  if (verification.discordUserId && verification.discordUserId !== discordUserId) {
    return NextResponse.json({
      verified: false,
      reason: 'discord_user_mismatch',
      responseMessage: 'That link code was created for a different Discord account. Generate a fresh code in Public Pearl from the account you want to connect.',
    });
  }

  const now = new Date().toISOString();
  await updateDiscordDmVerification(verification._id, {
    discordUserId,
    consumedAt: now,
  });

  const link = await upsertDiscordDmLink({
    userId: verification.userId,
    discordUserId,
  });
  const openclaw = await approveDiscordOpenClawAccess(link.discordUserId);

  return NextResponse.json({
    verified: true,
    linked: true,
    userId: link.userId,
    discordUserId: link.discordUserId,
    verifiedAt: link.verifiedAt,
    openclaw,
    responseMessage: 'Discord linked. You can talk to Pearl here now.',
  });
}
